import { lowTypeCoverage } from '../check/verdict.js';
import type { TypeCoverage } from '../domain/report.js';
import type { BuildResult, FixDiagnostic, FixReport, TestResult } from './types.js';

/**
 * Where the repository type-checks too few of the affected files (UPT-12), no new type errors
 * proves nothing: the verdict needs a test run or a build that passed. Elsewhere, true.
 */
export function testsOrBuildVouch(
  coverage: TypeCoverage | undefined,
  tests: TestResult[],
  build: BuildResult[] | undefined,
): boolean {
  if (!lowTypeCoverage(coverage)) return true;
  return (
    tests.some((t) => t.status === 'passed') || (build ?? []).some((b) => b.status === 'passed')
  );
}

/**
 * The repository before the upgrade: does it type-check, do its tests pass. When it does
 * not, verification can only compare before and after, never prove the tree is sound.
 */
export interface BaselineHealth {
  healthy: boolean;
  /** Type errors before anything changed (after generated clients, as verification sees them). */
  typeErrors: number;
  /** Test runs that failed or timed out before anything changed. */
  failingTests: number;
  /** TS2307 errors grouped by where the specifier points: a path alias prefix or a package. */
  missingModules: { under: string; errors: number; modules: number }[];
}

/** `@/ee/features/x` → `@/ee/`; `@scope/pkg/sub` → `@scope/pkg`; `pkg/sub` → `pkg`; relative as is. */
function moduleGroup(specifier: string): string {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return specifier;
  const parts = specifier.split('/');
  // A path alias (`@/`, `~/`, `#lib/`) is a directory of the repository: grouped by its first folder.
  if (/^(?:@|~|#[^/]*)$/.test(parts[0] ?? '') && parts.length > 2)
    return `${parts[0]}/${parts[1]}/`;
  return parts.slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
}

export function baselineHealth(baseline: FixDiagnostic[], tests: TestResult[]): BaselineHealth {
  const groups = new Map<string, { errors: number; modules: Set<string> }>();
  for (const d of baseline) {
    if (d.code !== 2307) continue;
    const specifier = /'([^']+)'/.exec(d.message)?.[1];
    if (!specifier) continue;
    const key = moduleGroup(specifier);
    const g = groups.get(key) ?? { errors: 0, modules: new Set<string>() };
    g.errors++;
    g.modules.add(specifier);
    groups.set(key, g);
  }
  const failingTests = tests.filter((t) => t.status === 'failed' || t.status === 'timeout').length;
  return {
    healthy: baseline.length === 0 && failingTests === 0,
    typeErrors: baseline.length,
    failingTests,
    missingModules: [...groups]
      .map(([under, g]) => ({ under, errors: g.errors, modules: g.modules.size }))
      .sort((a, b) => b.errors - a.errors || a.under.localeCompare(b.under)),
  };
}

/** A stored run from before the field existed is measured from what it kept. */
export const baselineHealthOf = (report: FixReport): BaselineHealth =>
  report.verification.baselineHealth ??
  baselineHealth(report.verification.baseline, report.verification.baselineTests);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The first thing a reader of an unhealthy run needs: the repository was broken before
 * Uptide touched it. `this repository does not type-check before the upgrade (205 errors,
 * 129 from missing modules: 121 under @/ee/, 8 in @react-email/components); verification
 * can only compare, not prove`.
 */
export function baselineHeadline(health: BaselineHealth): string | undefined {
  if (health.healthy) return undefined;
  const missing = health.missingModules.reduce((n, g) => n + g.errors, 0);
  const shown = health.missingModules
    .slice(0, 2)
    .map((g) => `${g.errors} ${g.under.endsWith('/') ? 'under' : 'in'} ${g.under}`);
  if (health.missingModules.length > 2) shown.push('…');
  const types = health.typeErrors
    ? `does not type-check before the upgrade (${plural(health.typeErrors, 'error')}${missing ? `, ${missing} from missing modules: ${shown.join(', ')}` : ''})`
    : '';
  const tests = health.failingTests
    ? `${types ? 'and its tests fail' : 'has failing tests'} before the upgrade (${plural(health.failingTests, 'run')})`
    : '';
  return `this repository ${[types, tests].filter(Boolean).join(' ')}; verification can only compare, not prove`;
}

/**
 * The final-head build failed and nothing failed at the parent commit: the upgrade broke it
 * (UPT-110). Without a parent build there is nothing to compare.
 */
export function upgradeBrokeBuild(parentBuild: BuildResult[] | undefined): boolean {
  return !!parentBuild && !parentBuild.some((b) => b.status === 'failed' || b.status === 'timeout');
}

/**
 * The verdict of a run. A healthy baseline keeps the strict gate's words; an unhealthy one
 * that gained nothing says `no new errors`, since that is all a comparison can show; a
 * failure separates what the upgrade introduced from what was already there.
 */
export function fixVerdict(report: FixReport): {
  text: string;
  tone: 'passed' | 'compared' | 'failed';
} {
  const v = report.verification;
  const health = baselineHealthOf(report);
  const low = lowTypeCoverage(report.typeCoverage);
  if (v.passed)
    return health.healthy
      ? {
          text: low ? `verification passed on tests and build (${low})` : 'verification passed',
          tone: 'passed',
        }
      : { text: 'no new errors', tone: 'compared' };
  if (v.buildBroken)
    return {
      text: v.parentUnchecked
        ? 'verification failed: build fails on this upgrade; the parent build could not be checked'
        : 'verification failed: build broken by this upgrade',
      tone: 'failed',
    };
  if (low && !v.typesUnverified && !v.newErrors.length)
    return { text: `verification failed: ${low} and no test or build passed`, tone: 'failed' };
  if (v.typesUnverified || !v.newErrors.length)
    return { text: 'verification failed', tone: 'failed' };
  return {
    text: `verification failed: ${plural(v.newErrors.length, 'type error')} introduced by the upgrade${health.typeErrors ? `, ${health.typeErrors} pre-existing` : ''}`,
    tone: 'failed',
  };
}
