import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { workspacePackagesOf } from '../adapters/typescript/repo.js';
import type { CheckReport, Finding } from '../domain/report.js';
import { installedManifest } from '../list/evidence.js';
import { nanos } from '../llm/pricing.js';
import { applySitePatch } from './patch.js';
import { git } from './process.js';
import { protectedFile, type TaskRunner } from './sdk-agent.js';
import { safeFile } from './settle.js';
import { isTestFile } from './test-edits.js';
import type { BuildResult, FixDiagnostic, Fixer, FixRequest, TestResult } from './types.js';

/** Tests may only receive explained expected-value edits; verification settings stay read-only. */
export function feedbackFiles(root: string): string[] {
  return git(root, 'ls-files', '-z')
    .split('\0')
    .filter(
      (file) =>
        /\.[cm]?[jt]sx?$/.test(file) &&
        (!protectedFile(file) || isTestFile(file)) &&
        !file.split('/').includes('node_modules'),
    );
}
export function verificationFeedback(
  errors: FixDiagnostic[],
  tests: TestResult[],
  baseline: TestResult[],
  build: BuildResult[],
  baselineBuild: BuildResult[],
): string {
  return [
    ...errors.map((d) => `${d.file}:${d.line}:${d.column} TS${d.code}: ${d.message}`),
    ...tests
      .filter(
        (t) =>
          (t.status === 'failed' || t.status === 'timeout') &&
          baseline.some(
            (b) => b.workspace === t.workspace && b.command === t.command && b.status === 'passed',
          ),
      )
      .map((t) => `Tests ${t.workspace} (${t.command ?? 'test'}):\n${trimOutput(t.output)}`),
    ...build
      .filter(
        (b) =>
          (b.status === 'failed' || b.status === 'timeout') &&
          baselineBuild.some(
            (p) => p.workspace === b.workspace && p.command === b.command && p.status === 'passed',
          ),
      )
      .map((b) => `Build ${b.workspace} (${b.command ?? 'build'}):\n${trimOutput(b.output)}`),
  ].join('\n\n');
}
export function trimOutput(text: string): string {
  return text.length <= 8000
    ? text
    : `${text.slice(0, 4000)}\n… output trimmed …\n${text.slice(-4000)}`;
}

/** Use the same edit gate for patch providers; their reservation covers even malformed responses. */
export function feedbackPatchRunner(fixer: Fixer, finding: Finding): TaskRunner {
  let halted = false;
  return async ({ root, task, prompt, maxBudgetUsd }) => {
    const files = new Map(
      task.files.map((file) => [file, { source: readFileSync(safeFile(root, file), 'utf8') }]),
    );
    const first = task.files[0];
    const empty = {
      turns: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMs: 0,
      toolCalls: {},
    };
    if (!first || halted) return { ...empty, stop: 'provider accounting unavailable' };
    const request: FixRequest = {
      finding: { ...finding, usage: { ...finding.usage, file: first, line: 1, column: 1 } },
      guide: prompt,
      source: files.get(first)?.source ?? '',
      enclosingFunction: files.get(first)?.source ?? '',
      compilerError: prompt,
      relatedDeclarations: task.files.slice(1).map((file) => ({
        file,
        message: 'Repository source available for the repair',
        line: 1,
        endLine: (files.get(file)?.source ?? '').split('\n').length,
        source: files.get(file)?.source ?? '',
      })),
    };
    const reservation = fixer.estimate?.(request);
    if (
      reservation === undefined ||
      !Number.isFinite(reservation) ||
      reservation < 0 ||
      nanos(reservation) > nanos(maxBudgetUsd)
    )
      return { ...empty, stop: 'next patch exceeds remaining budget or has no estimate' };
    // Reserve before calling: a thrown response must not enable free retries.
    let costUsd = 0;
    let unreportedCostUsd = reservation;
    try {
      const answer = await fixer.fix(request, maxBudgetUsd);
      costUsd = answer.costUsd ?? 0;
      unreportedCostUsd =
        answer.unreportedCostUsd ?? (answer.costUsd === undefined ? reservation : 0);
      halted = answer.halt === true;
      if (answer.failure) return { ...empty, costUsd, unreportedCostUsd, stop: answer.failure };
      const edits = applySitePatch(files, answer.diff);
      for (const [file, source] of edits) writeFileSync(safeFile(root, file), source);
      return {
        ...empty,
        turns: 1,
        costUsd,
        unreportedCostUsd,
        inputTokens: answer.inputTokens,
        outputTokens: answer.outputTokens,
        summary: {
          changed: [...edits.keys()].map((file) => ({
            file,
            what:
              answer.explanation ??
              (isTestFile(file) ? '' : 'Repaired after verification feedback'),
          })),
          newFiles: [],
          decisions: [],
          assumptions: [],
          couldNotDo: [],
        },
      };
    } catch (error) {
      return {
        ...empty,
        costUsd,
        unreportedCostUsd,
        stop: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

/** A failed planner supplies no findings; retain only the installed lead and the refusal. */
export function fallbackReport(
  root: string,
  name: string,
  target: string,
  reason: string,
): CheckReport {
  const workspaces = workspacePackagesOf(root);
  const packages: CheckReport['packages'] = [];
  for (const workspace of workspaces) {
    const manifest = JSON.parse(readFileSync(join(root, workspace, 'package.json'), 'utf8'));
    if (
      !['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].some(
        (s) => typeof manifest[s]?.[name] === 'string',
      )
    )
      continue;
    packages.push({
      name,
      workspace,
      installed: installedManifest(root, workspace, name)?.version ?? 'unknown',
      latest: target,
      target,
      majorsBehind: 0,
      findings: [],
      callSitesChecked: 0,
      unanalyzed: [],
      status: 'unknown',
      notes: [reason],
      timing: { fetchMs: 0, diffMs: 0, usagesMs: 0, compileMs: 0 },
    });
  }
  return {
    repo: root,
    workspaces,
    packages,
    summary: {
      packagesNeedingAttention: packages.length,
      breaking: 0,
      deprecated: 0,
      unverified: packages.length,
      unaffected: 0,
      notImported: 0,
      partiallyAnalyzed: packages.length,
      autoFixable: 0,
      skippedForTime: 0,
      failed: 1,
    },
  };
}
