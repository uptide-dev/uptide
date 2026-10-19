import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Node, Project, SyntaxKind } from 'ts-morph';
import type { ProgressListener } from '../domain/progress.js';
import { ACCEPTED_KEYS } from '../llm/config.js';
import { CostLimitError, DEFAULT_MAX_COST_USD } from '../llm/fixer.js';
import { nanos } from '../llm/pricing.js';
import type { MigrationPack, PackContext } from '../packs/types.js';
import { resetSharedState } from '../shared-state.js';
import { applySitePatch } from './patch.js';
import { git } from './process.js';
import { siteKey } from './report.js';
import { safeFile } from './settle.js';
import { missingProperties, testEditObjection } from './test-edits.js';
import type { AssistedAttempt, FixDiagnostic, Fixer, FixReport, FixSite } from './types.js';
import { diagnosticKey, lineMoves, moved, newDiagnostics } from './verify.js';

/** Lines of using statements shown with an import site. */
const IMPORT_USE_LINES = 160;

export function enclosingContext(
  source: string,
  line: number,
  column: number,
  /** Modules whose import lines the patch may need to touch, beyond the dependency's own. */
  modules: string[] = [],
  /** More sites of the same change in this file: their enclosing functions are shown too. */
  more: { line: number; column: number }[] = [],
): string {
  const file = new Project({ useInMemoryFileSystem: true }).createSourceFile('context.ts', source);
  const containerAt = (line: number, column: number) => {
    const offset =
      source
        .split('\n')
        .slice(0, line - 1)
        .reduce((n, s) => n + s.length + 1, 0) +
      column -
      1;
    const node = file.getDescendantAtPos(Math.min(offset, source.length - 1));
    return (
      node?.getFirstAncestor(
        (n) =>
          Node.isFunctionDeclaration(n) ||
          Node.isMethodDeclaration(n) ||
          Node.isConstructorDeclaration(n) ||
          Node.isArrowFunction(n) ||
          Node.isFunctionExpression(n),
      ) ??
      node?.getFirstAncestor(
        (n) =>
          Node.isImportDeclaration(n) ||
          Node.isTypeAliasDeclaration(n) ||
          Node.isInterfaceDeclaration(n) ||
          Node.isVariableStatement(n),
      ) ??
      node
    );
  };
  const container = containerAt(line, column);
  const pieces = new Map<number, string>();
  const add = (n: Node) => {
    const start = n.getStartLineNumber(),
      end = n.getEndLineNumber();
    pieces.set(
      start,
      `Lines ${start}-${end}:\n${source
        .split('\n')
        .slice(start - 1, end)
        .join('\n')}`,
    );
  };
  if (container) add(container);
  for (const at of more) {
    const other = containerAt(at.line, at.column);
    if (other) add(other);
  }
  // An import that no longer exists is fixed where the name is used, not on the import
  // line: the statements that use what this import brings in are part of the site.
  if (container && Node.isImportDeclaration(container)) {
    const names = new Set(
      [
        container.getDefaultImport(),
        container.getNamespaceImport(),
        ...container.getNamedImports().map((n) => n.getAliasNode() ?? n.getNameNode()),
      ]
        .filter((n) => n !== undefined)
        .map((n) => n.getText()),
    );
    let lines = 0;
    for (const statement of file.getStatements()) {
      if (Node.isImportDeclaration(statement)) continue;
      const uses = statement
        .getDescendantsOfKind(SyntaxKind.Identifier)
        .some((id) => names.has(id.getText()));
      if (!uses) continue;
      lines += statement.getEndLineNumber() - statement.getStartLineNumber() + 1;
      // Enough to see how the name is used; a whole large module is not the site.
      if (lines > IMPORT_USE_LINES) break;
      add(statement);
    }
  }
  // Imported dependency types and their declaration sites explain downstream generic errors.
  for (const imp of file.getImportDeclarations())
    if (['zod', 'stripe', ...modules].includes(imp.getModuleSpecifierValue())) add(imp);
  for (const ctor of file.getDescendantsOfKind(SyntaxKind.Constructor))
    if (/ZodType/.test(ctor.getText())) add(ctor);
  for (const fn of file.getFunctions())
    if (['subscriptionPeriod', 'subscriptionPeriodEnd'].includes(fn.getName() ?? '')) add(fn);
  return [...pieces]
    .sort((a, b) => a[0] - b[0])
    .map(([, text]) => text)
    .join('\n\n');
}
function diagnosticFor(site: FixSite, before: FixDiagnostic[], source: string) {
  return before
    .filter(
      (d) =>
        d.file === site.finding.usage.file &&
        (site.finding.usage.compileCode === undefined ||
          d.code === site.finding.usage.compileCode) &&
        (d.line === site.finding.usage.line ||
          d.message === site.finding.usage.compileError ||
          (site.finding.usage.snippet.trim() !== '' &&
            source.split('\n')[d.line - 1]?.trim() === site.finding.usage.snippet.trim())),
    )
    .sort(
      (a, b) =>
        Math.abs(a.line - site.finding.usage.line) - Math.abs(b.line - site.finding.usage.line) ||
        // Two errors on one line (`current_period_start` and `_end`): the site's own message.
        Number(b.message === site.finding.usage.compileError) -
          Number(a.message === site.finding.usage.compileError),
    )[0];
}
const declarationKey = (d: { file: string; line: number; endLine: number }) =>
  `${d.file}:${d.line}:${d.endLine}`;

export async function assist(
  root: string,
  sites: FixSite[],
  pack: MigrationPack,
  fixer: Fixer | undefined,
  verify: () => FixDiagnostic[],
  context?: PackContext,
  disabled = false,
  onProgress?: ProgressListener,
  limits: { maxCostUsd?: number | undefined } = {},
): Promise<FixReport['llm']> {
  const llm: FixReport['llm'] = {
    available: !!fixer,
    ...(disabled ? { disabled: true } : {}),
    ...(fixer ? { model: fixer.id, ...(fixer.provider ? { provider: fixer.provider } : {}) } : {}),
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  };
  const limit = limits.maxCostUsd ?? DEFAULT_MAX_COST_USD;
  let halted = false;
  const processed = new Set<FixSite>();
  // A rate limit applies across sites, including when the final attempt at a site failed.
  let retryAfterMs = 0;
  const stopForBudget = (site: FixSite, reason: string) => {
    llm.costLimit ??= { limitUsd: limit, notAttempted: 0 };
    llm.costLimit.notAttempted++;
    site.reason += `; stopped before calling: ${reason} (--max-cost $${limit.toFixed(2)})`;
  };
  for (const site of [...sites].sort(
    (a, b) =>
      a.finding.usage.file.localeCompare(b.finding.usage.file) ||
      a.finding.usage.line - b.finding.usage.line,
  )) {
    if (site.outcome !== 'manual' || processed.has(site)) continue;
    if (!fixer) {
      site.reason += disabled
        ? '; assisted fixes disabled (--no-llm), left manual'
        : `; no LLM API key (${ACCEPTED_KEYS}), left manual`;
      continue;
    }
    const file = safeFile(root, site.finding.usage.file);
    const original = readFileSync(file, 'utf8');
    const before = verify();
    const diagnostic = diagnosticFor(site, before, original);
    if (!diagnostic) {
      const parent = sites.find(
        (other) =>
          other.outcome === 'agent' &&
          !other.resolvedBy &&
          other.attempts?.some((a) => a.outcome === 'accepted') &&
          other.finding.usage.file === site.finding.usage.file,
      );
      if (parent) {
        site.outcome = 'agent';
        site.reason = 'diagnostic resolved by an earlier accepted edit in this file';
        site.resolvedBy = siteKey(parent);
        site.rule = parent.rule;
      } else site.reason += '; no remaining compiler diagnostic to validate an assisted edit';
      continue;
    }
    const owned = (d: FixDiagnostic) =>
      (d.relatedDeclarations ?? []).filter((r) => {
        if (r.file.split('/').includes('node_modules')) return false;
        try {
          return !realpathSync(safeFile(root, r.file)).split('/').includes('node_modules');
        } catch {
          return false;
        }
      });
    const declarations = owned(diagnostic);
    const keys = new Set(declarations.map(declarationKey));
    const group = [{ site, diagnostic }];
    for (const other of sites) {
      if (other === site || other.outcome !== 'manual' || processed.has(other) || !keys.size)
        continue;
      const d = diagnosticFor(
        other,
        before,
        readFileSync(join(root, other.finding.usage.file), 'utf8'),
      );
      if (d?.relatedDeclarations?.some((r) => keys.has(declarationKey(r))))
        group.push({ site: other, diagnostic: d });
    }
    // Sites of the same change in this file (the period fields read in two handlers) are one
    // task: the agent sees every enclosing function and the edit is accepted only when all
    // of their diagnostics are gone. Each site keeps its own entry in the report. Only when
    // the fix is in the same place, though: the same repository declarations behind each
    // error, or none. Two `RefObject<T | null>` errors in one file whose prop types live in
    // two presenters are two fixes, and one task could edit only the first one's file.
    const fixedAt = (d: FixDiagnostic) => owned(d).map(declarationKey).sort().join('|');
    const location = fixedAt(diagnostic);
    const sameChange = new Set<FixSite>();
    for (const other of sites) {
      if (
        other === site ||
        other.outcome !== 'manual' ||
        processed.has(other) ||
        group.some((g) => g.site === other) ||
        other.finding.usage.file !== site.finding.usage.file ||
        (site.rule
          ? other.rule !== site.rule
          : other.finding.change.path !== site.finding.change.path)
      )
        continue;
      const d = diagnosticFor(other, before, original);
      if (
        !d ||
        fixedAt(d) !== location ||
        group.some((g) => diagnosticKey(g.diagnostic) === diagnosticKey(d))
      )
        continue;
      group.push({ site: other, diagnostic: d });
      sameChange.add(other);
    }
    for (const member of group) processed.add(member.site);
    const files = new Map<
      string,
      { source: string; regions?: { line: number; endLine: number }[] }
    >([[site.finding.usage.file, { source: original }]]);
    for (const d of declarations) {
      if (d.file === site.finding.usage.file) continue;
      const allowed = files.get(d.file) ?? {
        source: readFileSync(join(root, d.file), 'utf8'),
        regions: [],
      };
      allowed.regions?.push(d);
      files.set(d.file, allowed);
    }
    let retry: string | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      const request = {
        finding: site.finding,
        guide: pack.guide(site.finding, context),
        // The import the site must extend is shown exactly: a shared helper's module.
        enclosingFunction: enclosingContext(
          original,
          diagnostic.line,
          diagnostic.column,
          [
            pack.name,
            ...(context?.helpers ?? []).flatMap((h) => [
              ...Object.values(h.specifiers),
              ...Object.values(h.imports ?? {}),
            ]),
          ],
          group
            .filter(({ site: s }) => sameChange.has(s))
            .map(({ diagnostic: d }) => ({ line: d.line, column: d.column })),
        ),
        source: original,
        ...(declarations.length
          ? {
              relatedDeclarations: declarations.map((d) => ({
                ...d,
                source: enclosingContext(files.get(d.file)?.source ?? '', d.line, 1, [pack.name]),
              })),
            }
          : {}),
        ...(group.length > 1
          ? {
              sharedDiagnostics: group.map(({ diagnostic: d }) => ({
                file: d.file,
                line: d.line,
                code: d.code,
                message: d.message,
              })),
            }
          : {}),
        compilerError: `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} TS${diagnostic.code}: ${diagnostic.message}${diagnostic.expected ? `\nExpected type: ${diagnostic.expected}` : ''}`,
        ...(retry ? { retry } : {}),
      };
      const remaining =
        (Math.floor(limit * 1e9) - nanos(llm.costUsd) - nanos(llm.unreportedCostUsd ?? 0)) / 1e9;
      const reservation = fixer.estimate?.(request);
      if (
        halted ||
        reservation === undefined ||
        !Number.isFinite(reservation) ||
        reservation < 0 ||
        nanos(reservation) > Math.floor(remaining * 1e9)
      ) {
        stopForBudget(
          site,
          halted
            ? 'provider accounting cannot be trusted'
            : reservation === undefined
              ? 'fixer supplied no worst-case estimate'
              : `next call needs $${reservation.toFixed(6)}, remaining $${Math.max(0, remaining).toFixed(6)}`,
        );
        break;
      }
      if (retryAfterMs > 0) {
        onProgress?.({
          phase: 'assist',
          package: pack.name,
          detail: `rate limited; waiting ${Math.ceil(retryAfterMs / 1000)}s before retry`,
          state: 'start',
        });
        // Do not retry early, and allow cancellation/event processing during long waits.
        while (retryAfterMs > 0) {
          const wait = Math.min(60_000, retryAfterMs);
          await delay(wait);
          retryAfterMs -= wait;
        }
      }
      const where = `${site.finding.usage.file}:${site.finding.usage.line}${attempt ? ` (attempt ${attempt + 1})` : ''}`;
      const started = performance.now();
      onProgress?.({ phase: 'assist', package: pack.name, detail: where, state: 'start' });
      const log: AssistedAttempt = {
        attempt: attempt + 1,
        outcome: 'reverted',
        before,
        after: before,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        explanation: '',
      };
      site.attempts ??= [];
      site.attempts.push(log);
      try {
        const response = await fixer.fix(request, remaining);
        log.responseModel = response.responseModel;
        log.reservationUsd = response.reservationUsd ?? reservation;
        log.unreportedCostUsd = response.unreportedCostUsd;
        log.failureKind = response.failureKind;
        retryAfterMs = response.retryAfterMs ?? 0;
        log.inputTokens = response.inputTokens;
        log.outputTokens = response.outputTokens;
        log.costUsd = response.costUsd ?? 0;
        log.explanation = response.explanation ?? '';
        log.diff = response.diff;
        llm.inputTokens += response.inputTokens;
        llm.outputTokens += response.outputTokens;
        llm.costUsd = (nanos(llm.costUsd) + nanos(response.costUsd ?? 0)) / 1e9;
        if (response.unreportedCostUsd)
          llm.unreportedCostUsd =
            (nanos(llm.unreportedCostUsd ?? 0) + nanos(response.unreportedCostUsd)) / 1e9;
        if (response.halt) halted = true;
        if (response.failure) throw new Error(response.failure);
        const edits = applySitePatch(files, response.diff);
        for (const [path, patched] of edits) {
          const testObjection = testEditObjection(
            path,
            files.get(path)?.source ?? '',
            patched,
            response.explanation,
            missingProperties(before, path),
          );
          if (testObjection) throw new Error(testObjection);
          const objection = pack.validateAssisted?.(
            patched,
            site.finding,
            response.explanation ?? '',
            files.get(path)?.source ?? '',
            context,
          );
          if (objection) throw new Error(objection);
        }
        for (const [path, patched] of edits) writeFileSync(join(root, path), patched);
        const after = verify();
        log.after = after;
        // An edit that adds lines (an import) moves the errors below it: compared at the line
        // they are on now, a pre-existing error is not new and a site's error is not gone.
        const moves = lineMoves(
          [...edits].map(([path, patched]) => [path, files.get(path)?.source ?? '', patched]),
        );
        const newErrors = newDiagnostics(before, after, moves);
        const remainingKeys = new Set(after.map(diagnosticKey));
        const removed = group.every(
          ({ diagnostic: d }) => !remainingKeys.has(diagnosticKey(moved(d, moves))),
        );
        if (removed && newErrors.length === 0) {
          log.outcome = 'accepted';
          site.outcome = 'agent';
          site.diff = response.diff;
          site.reason = `${fixer.id}: removed TS${diagnostic.code}; no new diagnostics. ${log.explanation}`;
          site.editedFiles = [...edits.keys()];
          git(root, 'add', '--', ...site.editedFiles);
          git(
            root,
            'commit',
            '-m',
            `fix(${pack.name}): migrate ${site.finding.usage.file}:${site.finding.usage.line}`,
          );
          break;
        }
        retry = JSON.stringify({
          removed,
          newErrors: newErrors.map((d) => `${d.file}:${d.line} TS${d.code} ${d.message}`),
        });
      } catch (e) {
        if (e instanceof CostLimitError) {
          stopForBudget(site, e.message);
          break;
        }
        // The attempt may have failed inside TypeScript (a transform, a verification
        // program): the next attempt and the next site start from fresh shared state.
        resetSharedState();
        retry = e instanceof Error ? e.message : String(e);
      } finally {
        log.durationMs = performance.now() - started;
        if (site.outcome !== 'agent') {
          for (const [path, allowed] of files) writeFileSync(join(root, path), allowed.source);
          log.explanation = [log.explanation, retry].filter(Boolean).join('; ');
        }
        onProgress?.({
          phase: 'assist',
          package: pack.name,
          detail: where,
          state: 'done',
          ms: performance.now() - started,
        });
      }
      site.reason = `assisted attempt ${attempt + 1}/3 rejected: ${log.explanation}`;
    }
    for (const member of group.slice(1)) {
      member.site.outcome = site.outcome;
      member.site.reason = `${sameChange.has(member.site) ? 'same change in this file as' : 'shared related declaration with'} ${siteKey(site)}: ${site.reason}`;
      if (site.outcome === 'agent') member.site.resolvedBy = siteKey(site);
    }
  }
  return llm;
}
