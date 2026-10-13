import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { compareVersions, parseVersion } from '../check/version.js';
import { UptideError } from '../errors.js';
import { globRegExp } from '../glob.js';
import { minVersion, satisfies, subset, validRange } from './range.js';

/**
 * A repository's rule that a release must be this old before it is installed: npm's
 * `min-release-age`, pnpm's `minimumReleaseAge`, Yarn's `npmMinimalAgeGate`, or uptide.yml's
 * `minReleaseAgeDays` when the repository has none. Uptide never targets a version the
 * repository's own install would refuse.
 */
export interface ReleaseAgePolicy {
  minutes: number;
  /** Where it is set, for the reader: `min-release-age in .npmrc`. */
  source: string;
  /** Names, globs (`@org/*`) and `name@version || version` the policy does not apply to. */
  exclude: string[];
  /** The package manager's own default, the repository setting nothing. */
  builtIn?: true;
}

const DAY = 24 * 60;
const UNITS: Record<string, number> = {
  ms: 1 / 60_000,
  s: 1 / 60,
  m: 1,
  h: 60,
  d: DAY,
  w: 7 * DAY,
};

/** Yarn's durations: a bare number is minutes, else a number and `ms`, `s`, `m`, `h`, `d`, `w`. */
export function yarnMinutes(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  const match = typeof value === 'string' && /^(\d*\.?\d+)(ms|s|m|h|d|w)?$/.exec(value.trim());
  return match ? Number(match[1]) * (UNITS[match[2] ?? 'm'] as number) : undefined;
}

function yamlFile(path: string): Record<string, unknown> {
  try {
    const value = parse(readFileSync(path, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

const names = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/**
 * The package manager version the repository pins: `packageManager` (`pnpm@11.2.0+sha512…`),
 * `devEngines.packageManager` (a version or a range), or for Yarn the release `yarnPath`
 * runs. Lockfiles cannot tell: pnpm 9 to 12 write `lockfileVersion: '9.0'`, every Yarn 4
 * writes `__metadata.version: 8`. Undefined when nothing pins one.
 */
function pinnedManager(
  root: string,
  yarnPath: unknown,
): { name: string; range: string } | undefined {
  let manifest: { packageManager?: unknown; devEngines?: { packageManager?: unknown } } = {};
  try {
    manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch {
    // no manifest: nothing pinned there
  }
  const field = /^(pnpm|yarn)@(\d+\.\d+\.\d+[^+]*)/.exec(String(manifest.packageManager ?? ''));
  if (field) return { name: field[1] as string, range: field[2] as string };
  const engines = [manifest.devEngines?.packageManager].flat() as {
    name?: unknown;
    version?: unknown;
  }[];
  for (const engine of engines)
    if (
      (engine?.name === 'pnpm' || engine?.name === 'yarn') &&
      typeof engine.version === 'string' &&
      validRange(engine.version)
    )
      return { name: engine.name, range: engine.version };
  const release = /yarn-(\d+\.\d+\.\d+[^/]*?)\.c?js$/.exec(String(yarnPath ?? ''));
  return release ? { name: 'yarn', range: release[1] as string } : undefined;
}

/**
 * Release-age gates a package manager applies when the repository sets none, by the versions
 * that do (each checked against the manager's own source and release notes):
 * - pnpm 11 and 12: `minimumReleaseAge` 1440 minutes (pnpm/pnpm#11158, v11.0.0;
 *   `config/reader/src/index.ts`; the v12 settings reference keeps it). Not strict: pnpm can
 *   still install a younger release when nothing else satisfies the range.
 * - Yarn 4.15.0 and later 4.x: `npmMinimalAgeGate` `1d` (yarnpkg/berry#7135, in 4.15.0).
 * A pinned range every version of which has the default counts; anything else, or a version
 * not listed here, is not guessed at.
 */
const DEFAULTS: { name: string; range: string; minutes: number; label: (v: string) => string }[] = [
  {
    name: 'pnpm',
    range: '>=11.0.0 <13.0.0',
    minutes: DAY,
    label: (v) => `pnpm ${major(v)} default`,
  },
  { name: 'yarn', range: '>=4.15.0 <5.0.0', minutes: DAY, label: () => 'Yarn 4.15+ default' },
];
const major = (range: string): string => String(minVersion(range)?.split('.')[0] ?? '');

function builtInDefault(
  pinned: { name: string; range: string } | undefined,
  name: string,
): { minutes: number; source: string } | undefined {
  if (pinned?.name !== name) return undefined;
  const known = DEFAULTS.find((d) => d.name === name && subset(pinned.range, d.range));
  // pnpm's label names its major, so the range must stay within one.
  if (!known || (name === 'pnpm' && !subset(pinned.range, `^${major(pinned.range)}.0.0`)))
    return undefined;
  return { minutes: known.minutes, source: known.label(pinned.range) };
}

/**
 * pnpm (`pnpm-workspace.yaml`) and Yarn (`.yarnrc.yml`) at the project root. Zero turns a
 * policy off; unset, the default of the pinned package manager version applies, if it has one.
 */
export function managerPolicies(root: string): ReleaseAgePolicy[] {
  const policies: ReleaseAgePolicy[] = [];
  const pnpm = yamlFile(join(root, 'pnpm-workspace.yaml'));
  const yarn = yamlFile(join(root, '.yarnrc.yml'));
  const pinned = pinnedManager(root, yarn.yarnPath);
  const pnpmDefault =
    pnpm.minimumReleaseAge === undefined ? builtInDefault(pinned, 'pnpm') : undefined;
  if (typeof pnpm.minimumReleaseAge === 'number' && pnpm.minimumReleaseAge > 0)
    policies.push({
      minutes: pnpm.minimumReleaseAge,
      source: 'minimumReleaseAge in pnpm-workspace.yaml',
      exclude: names(pnpm.minimumReleaseAgeExclude),
    });
  else if (pnpmDefault)
    policies.push({ ...pnpmDefault, exclude: names(pnpm.minimumReleaseAgeExclude), builtIn: true });
  const yarnDefault =
    yarn.npmMinimalAgeGate === undefined ? builtInDefault(pinned, 'yarn') : undefined;
  const gate = yarnMinutes(yarn.npmMinimalAgeGate);
  if (gate)
    policies.push({
      minutes: gate,
      source: 'npmMinimalAgeGate in .yarnrc.yml',
      exclude: names(yarn.npmPreapprovedPackages),
    });
  else if (yarnDefault)
    policies.push({ ...yarnDefault, exclude: names(yarn.npmPreapprovedPackages), builtIn: true });
  return policies;
}

/** `react`, `@org/*`, `nx@21.6.5`, `webpack@4.47.0 || 5.102.1`, `lodash@npm:^4`. */
function excluded(patterns: string[], name: string, version: string): boolean {
  return patterns.some((pattern) => {
    const at = pattern.lastIndexOf('@');
    const glob = at > 0 ? pattern.slice(0, at) : pattern;
    if (!globRegExp(glob).test(name)) return false;
    if (at <= 0) return true;
    const range = pattern.slice(at + 1).replace(/^npm:/, '');
    return validRange(range) && satisfies(version, range);
  });
}

/** `7 days`, `1 day`, `12 hours`, `90 minutes`. */
export function duration(minutes: number): string {
  const [n, unit] =
    minutes >= DAY && minutes % DAY === 0
      ? [minutes / DAY, 'day']
      : minutes >= 60 && minutes % 60 === 0
        ? [minutes / 60, 'hour']
        : [minutes, 'minute'];
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/** How old a release is, rounded down to what a person reads: `2 days`, `5 hours`. */
function age(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes >= DAY) return duration(Math.floor(minutes / DAY) * DAY);
  if (minutes >= 60) return duration(Math.floor(minutes / 60) * 60);
  return duration(minutes);
}

/** Why the newest version was not the target. */
export interface HeldBack {
  latest: string;
  /** The newest version every policy allows; absent when none does. */
  allowed?: string;
  age: string;
  policy: string;
  source: string;
}

/**
 * `4.6.7 is 2 days old; your policy is 7 days (min-release-age in .npmrc); targeting 4.6.5`.
 * With `installed` at or above what is allowed, nothing qualifies and the sentence says so.
 */
export function heldBackText(held: HeldBack, installed?: string): string {
  const why = `${held.latest} is ${held.age} old; your policy is ${held.policy} (${held.source})`;
  if (!held.allowed) return `${why}; no published version is old enough`;
  if (installed && compareVersions(held.allowed, installed) <= 0)
    return `${why}; nothing newer than ${installed} qualifies`;
  return `${why}; targeting ${held.allowed}`;
}

/** The policy that refuses `name@version`, the strictest first; undefined when all allow it. */
function refusing(
  policies: readonly ReleaseAgePolicy[],
  name: string,
  version: string,
  time: Record<string, string>,
  now: number,
): ReleaseAgePolicy | undefined {
  // Without a publish date the age cannot be judged; pnpm installs those too.
  const published = Date.parse(time[version] ?? '');
  if (Number.isNaN(published)) return undefined;
  return [...policies]
    .sort((a, b) => b.minutes - a.minutes)
    .find((p) => !excluded(p.exclude, name, version) && now - published < p.minutes * 60_000);
}

/** The oldest moment a release may be published and still need its date checked. */
export const windowStart = (policies: readonly ReleaseAgePolicy[], now = Date.now()): number =>
  now - Math.max(0, ...policies.map((p) => p.minutes)) * 60_000;

/** Versions every policy allows, in the order given. */
export function allowedVersions(
  policies: readonly ReleaseAgePolicy[],
  name: string,
  versions: readonly string[],
  time: Record<string, string>,
  now = Date.now(),
): string[] {
  return versions.filter((v) => !refusing(policies, name, v, time, now));
}

/**
 * The newest version at or below `latest` that every policy allows. A stable `latest` is
 * never replaced by a prerelease. `held` says why `latest` itself was not taken.
 */
export function newestAllowed(
  policies: readonly ReleaseAgePolicy[],
  name: string,
  latest: string,
  versions: readonly string[],
  time: Record<string, string>,
  now = Date.now(),
): { version?: string; held?: HeldBack } {
  const policy = refusing(policies, name, latest, time, now);
  if (!policy) return { version: latest };
  const stable = !parseVersion(latest)?.pre;
  const allowed = versions
    .filter((v) => compareVersions(v, latest) < 0 && (!stable || !parseVersion(v)?.pre))
    .sort(compareVersions)
    .reverse()
    .find((v) => !refusing(policies, name, v, time, now));
  return {
    ...(allowed ? { version: allowed } : {}),
    held: {
      latest,
      ...(allowed ? { allowed } : {}),
      age: age(now - Date.parse(time[latest] as string)),
      policy: duration(policy.minutes),
      source: policy.source,
    },
  };
}

/** What a fetcher throws when no published version of a package is old enough. */
export function releaseAgeError(name: string, held: HeldBack): UptideError {
  return new UptideError('RELEASE_AGE', `${name}: ${heldBackText(held)}`);
}
