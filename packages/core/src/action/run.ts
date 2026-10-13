import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckReport, PackageReport } from '../domain/report.js';
import { isMajorUpgrade, NO_PACK_YET, noPackBlockers } from '../fix/no-pack.js';
import type { FixReport } from '../fix/types.js';
import type { ListedDependency, ListReport } from '../list/list.js';
import { loadUptideConfig } from '../onboarding/node.js';
import { DEFAULT_CONFIG, UPTIDE_CONFIG_FILE, type UptideConfig } from '../onboarding/schema.js';
import {
  fromChecked,
  fromFix,
  fromListed,
  kindOf,
  version as reportVersion,
  sentence,
  skipped,
} from '../run-report/build.js';
import {
  RUN_REPORT_SCHEMA_ID,
  type RunMode,
  type RunReport,
  type Upgrade,
} from '../run-report/schema.js';
import { type EngineRun, parseJson } from './engine.js';
import { pullNumber } from './github.js';

export interface ActionInputs {
  /** The repository's checkout (`GITHUB_WORKSPACE`). */
  workspace: string;
  /** `config`: the settings file, relative to the workspace. */
  config: string;
  mode: string;
  /** `package`: one dependency; empty for every one uptide.yml allows. */
  package?: string;
  /** `anthropic-api-key`; empty when the repository has no secret. */
  apiKey?: string;
  engineVersion: string;
  /** `GITHUB_REPOSITORY`, `GITHUB_REPOSITORY_ID`, `GITHUB_SHA`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`. */
  github: {
    repository: string;
    repositoryId: string;
    sha: string;
    runId: string;
    runAttempt: string;
  };
}

export interface ActionServices {
  /** Run the CLI with these arguments; `apiKey` is passed to it only when assisted fixes may run. */
  engine(args: string[], apiKey?: string): Promise<EngineRun>;
  /** The installation token (exchanged on first use). Throws `ActionAuthError`. */
  token(): Promise<string>;
  openUptideBranches(token: string): Promise<string[]>;
  /** `uptide pr --branch <branch> --yes --json` with the token; the PR URL. */
  publish(branch: string, token: string): Promise<string>;
  now(): number;
  log(line: string): void;
}

/** How many packages `check` analyzes in a run without `package`: the rest stay listed. */
export const CHECK_LIMIT = 10;
const MODES: readonly RunMode[] = ['list', 'check', 'fix'];

const iso = (ms: number): string => new Date(ms).toISOString();

/** `owner/name` and the numbers GitHub gives every run, for the report. */
function identity(github: ActionInputs['github']) {
  const [owner = 'unknown', name = 'unknown'] = github.repository.split('/');
  const int = (text: string, min: number) => {
    const n = Number(text);
    return Number.isInteger(n) && n >= min ? n : min;
  };
  return {
    repo: { id: int(github.repositoryId, 0), owner, name },
    sha: /^[0-9a-f]{40}$/.test(github.sha) ? github.sha : '0'.repeat(40),
    runId: int(github.runId, 0),
    runAttempt: int(github.runAttempt, 1),
  };
}

/** The installed version of a direct dependency at the workspace root, when it is installed. */
function installedVersion(workspace: string, name: string): string | undefined {
  const manifest = join(workspace, 'node_modules', name, 'package.json');
  if (!existsSync(manifest)) return undefined;
  try {
    const version = JSON.parse(readFileSync(manifest, 'utf8')).version;
    return typeof version === 'string' ? version : undefined;
  } catch {
    return undefined;
  }
}

/** One row per package: workspaces that report the same package are merged, sites joined. */
function byPackage(packages: PackageReport[]): Upgrade[] {
  const rows = new Map<string, Upgrade>();
  for (const pkg of packages) {
    const row = fromChecked(pkg);
    const seen = rows.get(row.package);
    if (!seen) rows.set(row.package, row);
    else {
      const keys = new Set(seen.breaking.map((s) => `${s.symbol}\0${s.file}\0${s.line}`));
      seen.breaking.push(
        ...row.breaking.filter((s) => !keys.has(`${s.symbol}\0${s.file}\0${s.line}`)),
      );
      if (!seen.analysis && row.analysis) seen.analysis = row.analysis;
      // A workspace that could not be analyzed makes the package's answer incomplete.
      if (row.status === 'failed' && seen.status !== 'failed') {
        seen.status = 'failed';
        seen.error = row.error as string;
      } else if (seen.status === 'up_to_date' && row.status === 'available') {
        seen.status = 'available';
        seen.from = row.from;
        seen.to = row.to;
        seen.kind = row.kind;
      }
    }
  }
  movingWithLeads(packages, rows);
  return [...rows.values()];
}

/**
 * A companion (`react-dom`, `@types/react`) that `check` also reports on its own, at the
 * version installed: it is not up to date, it moves with its lead's upgrade. Its row takes the
 * versions the lead's plan gives it and names the lead.
 */
function movingWithLeads(packages: PackageReport[], rows: Map<string, Upgrade>): void {
  const moves = (u: Upgrade): boolean => u.from !== u.to && u.status !== 'up_to_date';
  for (const pkg of packages) {
    const lead = rows.get(pkg.name);
    if (!lead || !moves(lead)) continue;
    const together = [
      ...(pkg.companions ?? []),
      ...(pkg.members ?? []).map((m) => ({ name: m.name, from: m.installed, to: m.target })),
    ];
    for (const c of together) {
      const row = rows.get(c.name);
      if (!row || c.name === lead.package || moves(row)) continue;
      if (row.status !== 'up_to_date' && row.status !== 'available') continue;
      if (c.from === c.to || reportVersion(c.from) !== c.from || reportVersion(c.to) !== c.to)
        continue;
      row.from = c.from;
      row.to = c.to;
      row.kind = kindOf(c.from, c.to);
      row.status = 'available';
      row.movesWith = lead.package;
      row.breaking = [];
      delete row.analysis;
    }
  }
}

/**
 * One run of the Uptide Action: discovery, then `check` or `fix` per the mode, as the CLI of
 * the Action's own commit does it. Returns the `uptide.run/v1` report; `error` is set when the
 * run as a whole could not do its job (the job then fails). A migration that does not verify
 * is a result, not a failed job.
 */
export async function runAction(
  inputs: ActionInputs,
  services: ActionServices,
): Promise<RunReport> {
  const startedAt = services.now();
  const mode = (MODES.includes(inputs.mode as RunMode) ? inputs.mode : 'check') as RunMode;
  const upgrades: Upgrade[] = [];
  const report = (error?: string): RunReport => ({
    schema: RUN_REPORT_SCHEMA_ID,
    engineVersion: /^[0-9A-Za-z.+-]{1,64}$/.test(inputs.engineVersion)
      ? inputs.engineVersion
      : 'unknown',
    ...identity(inputs.github),
    mode,
    startedAt: iso(startedAt),
    finishedAt: iso(services.now()),
    upgrades,
    ...(error ? { error: sentence(error) } : {}),
  });
  if (!MODES.includes(inputs.mode as RunMode))
    return report(`mode must be list, check or fix, not "${inputs.mode.slice(0, 20)}"`);

  // Settings first: a file that does not validate stops the run before anything is spent.
  let config: UptideConfig = { ...DEFAULT_CONFIG };
  try {
    const loaded = loadUptideConfig(inputs.workspace, inputs.config || UPTIDE_CONFIG_FILE);
    if (loaded) config = loaded.config;
  } catch (err) {
    const missing = /no such file/.test(err instanceof Error ? err.message : '');
    if (!missing || (inputs.config && inputs.config !== UPTIDE_CONFIG_FILE))
      return report(
        missing
          ? `the config file ${inputs.config} does not exist`
          : `${inputs.config || UPTIDE_CONFIG_FILE} is not valid; the job log names each problem`,
      );
    services.log(
      `::notice::No ${UPTIDE_CONFIG_FILE} in the repository: running with the defaults.`,
    );
  }
  const common = ['--json', '--ci', '--cwd', inputs.workspace];
  const configArgs = existsSync(join(inputs.workspace, inputs.config || UPTIDE_CONFIG_FILE))
    ? ['--config', inputs.config || UPTIDE_CONFIG_FILE]
    : [];
  // Assisted fixes need the key, the setting, and the one provider the workflow passes a key for.
  const llm = !!inputs.apiKey && config.llm.enabled && config.llm.provider === 'anthropic';
  const only = inputs.package?.trim() || undefined;

  // Discovery: what is behind, already narrowed by uptide.yml `packages`.
  const listed = await services.engine(['list', ...common, ...configArgs]);
  const list = parseJson<ListReport>(listed);
  if (!list) return report('uptide list did not answer; the job log has the reason');
  const behind = (name: string): ListedDependency | undefined =>
    list.packages.find((p) => p.name === name);
  // Nothing newer than what is installed is old enough for the repository's policy.
  const tooYoung = (list.releaseAge ?? [])
    .filter((r) => !behind(r.name) && (!only || r.name === only))
    .map((r) => skipped({ package: r.name, from: r.current }, 'skipped', `${r.name} ${r.reason}`));
  if (only && tooYoung.length) {
    upgrades.push(...tooYoung);
    return report();
  }
  if (only && !behind(only)) {
    const known =
      list.unknown?.some((u) => u.name === only) || list.failures.some((f) => f.name === only);
    const installed = installedVersion(inputs.workspace, only);
    upgrades.push(
      known
        ? skipped(
            { package: only, from: installed },
            'failed',
            'its latest version could not be looked up',
          )
        : installed
          ? skipped({ package: only, from: installed, to: installed }, 'up_to_date')
          : skipped(
              { package: only },
              'skipped',
              'not a dependency uptide.yml lets Uptide look at, or not installed',
            ),
    );
    return report();
  }
  upgrades.push(...tooYoung);
  // What Uptide acts on without a name: dependencies the code uses, most urgent first.
  const candidates = only
    ? [behind(only) as ListedDependency]
    : list.packages.filter((p) => p.classification === 'used');

  if (mode === 'list') {
    upgrades.push(...(only ? candidates : list.packages).map(fromListed));
    return report();
  }

  if (mode === 'check') {
    const names = candidates.slice(0, CHECK_LIMIT).map((p) => p.name);
    if (names.length) {
      const started = services.now();
      const checked = parseJson<CheckReport>(
        await services.engine(['check', ...names, ...common, ...configArgs]),
      );
      if (!checked) return report('uptide check did not answer; the job log has the reason');
      const rows = byPackage(checked.packages);
      const each = Math.round((services.now() - started) / Math.max(1, rows.length));
      for (const row of rows) upgrades.push({ ...row, durationMs: each });
    }
    upgrades.push(...candidates.slice(CHECK_LIMIT).map(fromListed));
    return report();
  }

  // fix: the token first. A run that cannot publish spends nothing on migrations.
  let open: string[];
  try {
    open = await services.openUptideBranches(await services.token());
  } catch (err) {
    upgrades.push(...candidates.map(fromListed));
    return report(
      `cannot open pull requests: ${err instanceof Error && err.name === 'ActionAuthError' ? err.message : 'GitHub could not be reached'}`,
    );
  }
  let slots = config.maxOpenPrs - open.length;
  let attempts = Math.max(0, slots);
  let budget = config.maxCost;
  for (const dep of candidates) {
    const row = { package: dep.name, from: dep.current, to: dep.latest };
    if (open.some((b) => b.startsWith(`uptide/${dep.name}-`))) {
      upgrades.push(skipped(row, 'skipped', 'an Uptide pull request for it is already open'));
      continue;
    }
    // A major upgrade no verified pack covers is never opened (fix/no-pack.ts). It is reported
    // whatever the slots and budget say: each one is demand for a pack.
    if (dep.tier !== 'verified' && isMajorUpgrade(dep.current, dep.latest)) {
      upgrades.push({ ...skipped(row, 'skipped', NO_PACK_YET), analysis: 'none' });
      continue;
    }
    if (slots <= 0 || attempts <= 0) {
      upgrades.push(
        skipped(
          row,
          'available',
          slots <= 0
            ? `${config.maxOpenPrs} Uptide pull request(s) open (maxOpenPrs in uptide.yml)`
            : 'not attempted this run',
        ),
      );
      continue;
    }
    if (llm && budget < 0.01) {
      upgrades.push(skipped(row, 'skipped', `maxCost of $${config.maxCost} reached this run`));
      continue;
    }
    attempts--;
    const started = services.now();
    const args = [
      'fix',
      dep.name,
      ...common,
      ...configArgs,
      ...(llm
        ? [
            '--llm',
            '--max-cost',
            budget.toFixed(2),
            ...(config.executor === 'patch' ? [] : ['--agent', 'sdk']),
          ]
        : ['--no-llm']),
    ];
    services.log(`::group::uptide fix ${dep.name}`);
    const run = await services.engine(args, llm ? inputs.apiKey : undefined);
    services.log('::endgroup::');
    const fixed = parseJson<FixReport>(run);
    if (!fixed || run.code === 2) {
      upgrades.push(
        skipped(
          row,
          'failed',
          `uptide fix did not finish (exit ${run.code}); the job log has the reason`,
          services.now() - started,
        ),
      );
      continue;
    }
    budget -= (fixed.llm?.costUsd ?? 0) + (fixed.llm?.unreportedCostUsd ?? 0);
    let pr: { number: number; url: string } | null = null;
    let error: string | undefined;
    // `uptide pr` refuses these too; asking it would only turn the reason into a failure.
    if (fixed.verification.passed && !fixed.exportError && !noPackBlockers(fixed).length) {
      try {
        const url = await services.publish(fixed.branch, await services.token());
        const number = pullNumber(url);
        if (number) {
          pr = { number, url };
          slots--;
        } else error = 'publishing did not return a pull request';
      } catch (err) {
        error = `verified, but the pull request could not be opened${
          err instanceof Error && err.name === 'ActionAuthError'
            ? `: ${err.message}`
            : '; the job log has the reason'
        }`;
      }
    }
    upgrades.push(
      fromFix(fixed, { pr, durationMs: services.now() - started, ...(error ? { error } : {}) }),
    );
  }
  return report();
}
