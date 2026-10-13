import semver from 'semver';
import type { Finding, PackageReport, Tier } from '../domain/report.js';
import { baselineHealthOf } from '../fix/baseline.js';
import type { FixReport } from '../fix/types.js';
import type { ListedDependency } from '../list/list.js';
import type {
  Analysis,
  BreakingChange,
  BreakingSite,
  Upgrade,
  UpgradeKind,
  Verification,
} from './schema.js';
import { RUN_REPORT_SCHEMA } from './schema.js';

/**
 * Builders from the engine's own JSON (`list`, `check` and `fix` with `--json`) to
 * `uptide.run/v1`. Each copies named fields only: never a message, a snippet, a diff, a
 * command or its output. What does not fit the schema's patterns is dropped, not trimmed.
 */

const CHANGES = new Set<string>(
  RUN_REPORT_SCHEMA.properties.upgrades.items.properties.breaking.items.properties.change.enum,
);
const SYMBOL = new RegExp(
  RUN_REPORT_SCHEMA.properties.upgrades.items.properties.breaking.items.properties.symbol.pattern,
);
const FILE = new RegExp(
  RUN_REPORT_SCHEMA.properties.upgrades.items.properties.breaking.items.properties.file.pattern,
);
const VERSION = /^[0-9A-Za-z.+-]{1,64}$/;

/** A version the report can carry; `unknown` otherwise. */
export const version = (v: string | undefined): string => (v && VERSION.test(v) ? v : 'unknown');

/** major, minor or patch between two versions; major when either cannot be read. */
export function kindOf(from: string | undefined, to: string | undefined): UpgradeKind {
  const a = from && semver.valid(semver.coerce(from)?.version ?? '');
  const b = to && semver.valid(semver.coerce(to)?.version ?? '');
  if (!a || !b) return 'major';
  if (semver.major(a) !== semver.major(b)) return 'major';
  return semver.minor(a) !== semver.minor(b) ? 'minor' : 'patch';
}

/**
 * One line of Uptide's own words: control characters and backticks out, at most 300
 * characters. For sentences Uptide composes from counts and names, never for engine output.
 */
export function sentence(text: string): string {
  const line = text
    // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point.
    .replace(/[\u0000-\u001f`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (line.length > 300 ? `${line.slice(0, 299)}…` : line) || 'unknown error';
}

/** What stands behind the breaking list: a pack, or none. Undefined when nothing was analyzed. */
export const analysisOf = (tier: Tier | undefined): Analysis | undefined =>
  tier === 'verified' ? 'pack' : tier === 'generic' ? 'none' : undefined;

/** Statuses `check` gives a package it analyzed. */
const ANALYZED = new Set<PackageReport['status']>(['breaking', 'deprecated', 'safe', 'partial']);

/** Breaking findings as symbol, file, line and change kind; deduplicated, in report order. */
export function breakingSites(findings: readonly Finding[]): BreakingSite[] {
  const seen = new Set<string>();
  const sites: BreakingSite[] = [];
  for (const f of findings) {
    if (f.severity !== 'breaking') continue;
    const site = {
      symbol: f.change.path,
      file: f.usage.file,
      line: Math.max(1, Math.trunc(f.usage.line)),
      change: f.change.kind as BreakingChange,
    };
    if (!SYMBOL.test(site.symbol) || !FILE.test(site.file) || !CHANGES.has(site.change)) continue;
    const key = `${site.symbol}\0${site.file}\0${site.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sites.push(site);
  }
  return sites;
}

/**
 * The baseline's health in counts only: which specifiers or aliases are missing stays in the
 * fix report. A group of the repository's own paths (relative, or an alias such as `@/ee/`) is
 * local; any other is a package.
 */
function baselineCounts(report: FixReport): NonNullable<Verification['baselineHealth']> {
  const health = baselineHealthOf({
    ...report,
    verification: {
      ...report.verification,
      baseline: report.verification.baseline ?? [],
      baselineTests: report.verification.baselineTests ?? [],
    },
  });
  const local = (under: string) => /^[./]/.test(under) || under.endsWith('/');
  const errors = (keep: boolean) =>
    health.missingModules.filter((g) => local(g.under) === keep).reduce((n, g) => n + g.errors, 0);
  return {
    typeErrors: health.typeErrors,
    failingTests: health.failingTests,
    missingModules: { local: errors(true), packages: errors(false) },
  };
}

/** Counts from a fix run's verification: errors, failing lint tools, test runs. */
export function verificationOf(report: FixReport): Verification {
  const v = report.verification;
  const lint = v.lint ?? [];
  const ran = (v.tests ?? []).filter((t) => t.status !== 'missing');
  return {
    typecheck: {
      before: v.baseline?.length ?? 0,
      ...(v.target ? { afterUpgrade: v.target.length } : {}),
      after: v.after?.length ?? 0,
    },
    baselineHealth: baselineCounts(report),
    lint: {
      before: lint.filter((l) => l.status === 'pre-existing').length,
      after: lint.filter((l) => l.status !== 'passed').length,
    },
    tests: ran.length
      ? {
          passed: ran.filter((t) => t.status === 'passed').length,
          failed: ran.filter((t) => t.status === 'failed' || t.status === 'timeout').length,
        }
      : null,
  };
}

/** Why a verified-or-not fix run is not publishable, in counts and workspace paths. */
export function verificationFailure(report: FixReport): string | undefined {
  const v = report.verification;
  if (v.passed && !report.exportError) return undefined;
  if (report.exportError) return 'the verified migration could not be exported to the checkout';
  const reasons = [
    ...(v.typesUnverified ? ['types could not be verified'] : []),
    ...(v.newErrors?.length ? [`${v.newErrors.length} new type error(s)`] : []),
    ...(v.lint ?? []).filter((l) => l.status === 'failed').map(() => 'lint fails on edited files'),
    ...(v.tests ?? [])
      .filter((t) => t.status === 'failed' || t.status === 'timeout')
      .map(
        (t) =>
          `tests ${t.status === 'timeout' ? 'timed out' : 'failed'} in ${FILE.test(t.workspace) ? t.workspace : 'a workspace'}`,
      ),
  ];
  const manual = report.sites.filter((s) => s.outcome === 'manual').length;
  if (manual) reasons.push(`${manual} site(s) left for manual work`);
  return sentence(
    `verification failed${reasons.length ? `: ${[...new Set(reasons)].join(', ')}` : ''}`,
  );
}

const blank = (
  durationMs = 0,
): Pick<Upgrade, 'breaking' | 'verification' | 'pr' | 'costUsd' | 'durationMs'> => ({
  breaking: [],
  verification: null,
  pr: null,
  costUsd: 0,
  durationMs: Math.max(0, Math.round(durationMs)),
});

/** A row of `uptide list`: an upgrade that is available. */
export function fromListed(dep: ListedDependency): Upgrade {
  return {
    package: dep.name,
    from: version(dep.current),
    to: version(dep.latest),
    kind: dep.change,
    status: 'available',
    ...blank(),
  };
}

/**
 * A package of `uptide check`: available, with the sites the upgrade breaks; failed, with the
 * engine's error code (an identifier, never its message), when it could not be analyzed.
 */
export function fromChecked(pkg: PackageReport, durationMs = 0): Upgrade {
  // Nothing newer is old enough for the repository's policy: skipped, and why, in Uptide's words.
  if (pkg.skipReason === 'RELEASE_AGE' && pkg.releaseAge)
    return skipped(
      { package: pkg.name, from: pkg.installed },
      'skipped',
      `${pkg.name} ${pkg.releaseAge}`,
      durationMs,
    );
  const upToDate = pkg.installed === pkg.target;
  const failed = !!pkg.skipReason || pkg.status === 'skipped' || pkg.status === 'unknown';
  const code =
    pkg.skipReason && /^[A-Z_]{1,64}$/.test(pkg.skipReason) ? ` (${pkg.skipReason})` : '';
  return {
    package: pkg.name,
    from: version(pkg.installed),
    to: version(pkg.target),
    kind: kindOf(pkg.installed, pkg.target),
    status: failed ? 'failed' : upToDate ? 'up_to_date' : 'available',
    ...blank(durationMs),
    breaking: breakingSites(pkg.findings ?? []),
    ...(!failed && !upToDate && ANALYZED.has(pkg.status) && analysisOf(pkg.tier)
      ? { analysis: analysisOf(pkg.tier) }
      : {}),
    ...(failed
      ? {
          error: `could not be analyzed${pkg.workspace && pkg.workspace !== '.' && FILE.test(pkg.workspace) ? ` in ${pkg.workspace}` : ''}${code}; the job log has the reason`,
        }
      : {}),
  };
}

/** A `uptide fix` run, with the pull request it led to. */
export function fromFix(
  report: FixReport,
  outcome: { pr: { number: number; url: string } | null; durationMs: number; error?: string },
): Upgrade {
  const failure = outcome.error ?? verificationFailure(report);
  return {
    package: report.package,
    from: version(report.from),
    to: version(report.target),
    kind: kindOf(report.from, report.target),
    status: failure ? 'failed' : outcome.pr ? 'fixed' : 'failed',
    ...blank(outcome.durationMs),
    breaking: breakingSites(report.sites.map((s) => s.finding)),
    ...(analysisOf(report.tier) ? { analysis: analysisOf(report.tier) } : {}),
    verification: verificationOf(report),
    pr: outcome.pr,
    costUsd: Math.max(0, report.llm?.costUsd ?? 0),
    ...(failure
      ? { error: failure }
      : outcome.pr
        ? {}
        : { error: 'verified, but no pull request was opened' }),
  };
}

/** A package Uptide did not run on, or could not: why, in Uptide's words. */
export function skipped(
  pkg: { package: string; from?: string; to?: string },
  status: 'skipped' | 'failed' | 'up_to_date' | 'available',
  error?: string,
  durationMs = 0,
): Upgrade {
  return {
    package: pkg.package,
    from: version(pkg.from),
    to: version(pkg.to ?? pkg.from),
    kind: kindOf(pkg.from, pkg.to ?? pkg.from),
    status,
    ...blank(durationMs),
    ...(error ? { error: sentence(error) } : {}),
  };
}
