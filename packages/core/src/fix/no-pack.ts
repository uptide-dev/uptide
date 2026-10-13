import { parseVersion } from '../check/version.js';
import type { FixReport } from './types.js';

/**
 * What an upgrade without a verified pack needs before it may become a pull request. Without a
 * pack nothing analyzed what the upgrade changes: a clean type-check only says the code still
 * compiles against the new declarations, not that the build, the configuration or the runtime
 * still work (Next 15 → 16 type-checks and breaks all three).
 */

/** The reason a major upgrade without a pack gets, wherever it is reported. */
export const NO_PACK_YET = 'no pack yet';

/**
 * A breaking upgrade by semver: a new major, or a new minor below 1.0.0 (0.4 → 0.5). A version
 * that cannot be read counts as major.
 */
export function isMajorUpgrade(from: string | undefined, to: string | undefined): boolean {
  const a = from ? parseVersion(from) : undefined;
  const b = to ? parseVersion(to) : undefined;
  if (!a || !b) return true;
  return a.major !== b.major || (a.major === 0 && a.minor !== b.minor);
}

/**
 * Why a run without a pack may not be published; empty when it may, or when a pack covered it.
 * A major upgrade never; a minor or patch only when the repository's own build and tests ran
 * after the bump and passed. Failures that verification already reports are not repeated.
 */
export function noPackBlockers(report: FixReport): string[] {
  if (report.tier !== 'generic' || report.mode === 'pin') return [];
  if (isMajorUpgrade(report.from, report.target))
    return [
      `${NO_PACK_YET}: ${report.package} ${report.from ?? 'unknown'} → ${report.target} is a major upgrade, and Uptide opens one only with a verified migration pack`,
    ];
  const v = report.verification;
  const missing = [
    ...((v.build ?? []).every((b) => b.status === 'missing') ? ['no build script'] : []),
    ...(v.tests.every((t) => t.status === 'missing') ? ['no tests'] : []),
  ];
  if (missing.length)
    return [
      `${NO_PACK_YET}: the repository has ${missing.join(' and ')} to verify the bump with, and the type-check alone does not`,
    ];
  if (v.tests.some((t) => t.status === 'failed' && t.preexisting))
    return [`${NO_PACK_YET}: tests fail, already before the upgrade, so they cannot verify it`];
  return [];
}
