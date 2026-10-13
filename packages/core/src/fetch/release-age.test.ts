import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorCode } from '../errors.js';
import { resolveTarget } from '../fix/target.js';
import { listDependencies } from '../list/list.js';
import { createDiscoveryFetcher } from '../list/registry.js';
import { fromChecked } from '../run-report/build.js';
import { createNpmFetcher } from './npm-fetcher.js';
import { loadRegistryConfig, type RegistryConfig } from './npmrc.js';
import { heldBackText, newestAllowed, type ReleaseAgePolicy, yarnMinutes } from './release-age.js';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const daysAgo = (days: number): string => new Date(NOW - days * 24 * 3600_000).toISOString();
const fixture = (name: string): string =>
  fileURLToPath(new URL(`../../../../fixtures/repos/release-age/${name}/`, import.meta.url));
/** No user or global npmrc, no uptide.yml fallback: only the fixture's own files. */
const policyOf = (name: string, env: NodeJS.ProcessEnv = {}): ReleaseAgePolicy[] =>
  loadRegistryConfig({
    cwd: fixture(name),
    env: {
      HOME: mkdtempSync(join(tmpdir(), 'uptide-home-')),
      npm_config_globalconfig: '/nonexistent',
      ...env,
    },
  }).releaseAge ?? [];

/** Synthetic packages: `widget` has a young latest, `gadget` a young major, `@acme/tool` only a young release, `steady` nothing recent. */
const PACKAGES: Record<string, { time: Record<string, string>; latest: string }> = {
  widget: {
    latest: '4.6.7',
    time: {
      '4.6.0': daysAgo(40),
      '4.6.5': daysAgo(10),
      '4.6.6': daysAgo(5),
      '4.6.7': daysAgo(2),
      '5.0.0-beta.1': daysAgo(1),
    },
  },
  gadget: { latest: '5.0.0', time: { '4.0.0': daysAgo(100), '5.0.0': daysAgo(1) } },
  '@acme/tool': { latest: '1.0.0', time: { '1.0.0': daysAgo(1) } },
  steady: { latest: '2.0.0', time: { '1.0.0': daysAgo(800), '2.0.0': daysAgo(400) } },
};

/** The abbreviated document (`modified`, no `time`) unless the full one is asked for. */
function registry() {
  const full: string[] = [];
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const [name = '', tag] = decodeURIComponent(url.pathname.slice(1)).split(/\/(?=[^/]*$)/);
    const scoped = name.startsWith('@') && !name.includes('/');
    const pkg = PACKAGES[scoped ? `${name}/${tag}` : name];
    const requested = scoped ? undefined : tag;
    if (!pkg) return new Response('{}', { status: 404 });
    const versions = Object.fromEntries(
      Object.keys(pkg.time).map((v) => [
        v,
        { version: v, dist: { tarball: `https://reg.test/${v}.tgz` } },
      ]),
    );
    if (requested) {
      const version = requested === 'latest' ? pkg.latest : requested;
      return new Response(JSON.stringify(versions[version]), { status: 200 });
    }
    const wantsFull = new Headers(init?.headers).get('accept') === 'application/json';
    if (wantsFull) full.push(scoped ? `${name}/${tag}` : name);
    const modified = Object.values(pkg.time).sort().at(-1);
    return new Response(
      JSON.stringify({
        'dist-tags': { latest: pkg.latest },
        versions,
        modified,
        ...(wantsFull ? { time: pkg.time } : {}),
      }),
      { status: 200 },
    );
  });
  return { fetchFn, full };
}

const config = (releaseAge: ReleaseAgePolicy[]): RegistryConfig => ({
  registry: 'https://reg.test',
  scoped: {},
  tokens: {},
  releaseAge,
});
const npmPolicy = [{ minutes: 7 * 1440, source: 'min-release-age in .npmrc', exclude: [] }];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('the policy of each package manager, with its units', () => {
  it('npm: min-release-age in days, the project .npmrc over the user one, the environment over both', () => {
    expect(policyOf('npm')).toEqual(npmPolicy);
    const home = mkdtempSync(join(tmpdir(), 'uptide-home-'));
    writeFileSync(join(home, '.npmrc'), 'min-release-age=3\n');
    const user = { npm_config_userconfig: join(home, '.npmrc') };
    expect(policyOf('none', user)).toEqual([
      { minutes: 3 * 1440, source: 'min-release-age in ~/.npmrc', exclude: [] },
    ]);
    expect(policyOf('npm', user)[0]?.minutes).toBe(7 * 1440);
    expect(policyOf('npm', { npm_config_min_release_age: '1' })[0]).toMatchObject({
      minutes: 1440,
      source: 'min-release-age in npm_config_min_release_age',
    });
    expect(policyOf('npm', { npm_config_min_release_age: '0' })).toEqual([]);
  });

  it('pnpm: minimumReleaseAge in minutes, with minimumReleaseAgeExclude', () => {
    expect(policyOf('pnpm')).toEqual([
      {
        minutes: 10080,
        source: 'minimumReleaseAge in pnpm-workspace.yaml',
        exclude: ['@acme/*', 'gadget@5.0.0'],
      },
    ]);
  });

  it("yarn: npmMinimalAgeGate as Yarn's durations (a bare number is minutes), with npmPreapprovedPackages", () => {
    expect(policyOf('yarn')).toEqual([
      { minutes: 3 * 1440, source: 'npmMinimalAgeGate in .yarnrc.yml', exclude: ['gadget'] },
    ]);
    expect([yarnMinutes('1w'), yarnMinutes('12h'), yarnMinutes(90), yarnMinutes('90')]).toEqual([
      10080, 720, 90, 90,
    ]);
    expect(yarnMinutes('soon')).toBeUndefined();
  });

  it("uptide.yml's minReleaseAgeDays applies only to a repository that sets no policy itself", () => {
    const fallback = { UPTIDE_MIN_RELEASE_AGE_DAYS: '2' };
    const uptide = { minutes: 2 * 1440, source: 'minReleaseAgeDays in uptide.yml', exclude: [] };
    expect(policyOf('none')).toEqual([]);
    expect(policyOf('none', fallback)).toEqual([uptide]);
    expect(policyOf('npm', fallback)).toEqual(npmPolicy);
    // A package manager's default is not the repository's policy: both apply.
    expect(policyOf('pnpm-11-default', fallback)).toEqual([
      expect.objectContaining({ source: 'pnpm 11 default' }),
      uptide,
    ]);
  });
});

describe("a package manager's built-in default, when the pinned version has one", () => {
  const repo = (files: Record<string, string>): string => {
    const dir = mkdtempSync(join(tmpdir(), 'uptide-pm-'));
    for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
    return dir;
  };
  const policies = (files: Record<string, string>): ReleaseAgePolicy[] =>
    loadRegistryConfig({
      cwd: repo(files),
      env: {
        HOME: mkdtempSync(join(tmpdir(), 'uptide-home-')),
        npm_config_globalconfig: '/nonexistent',
      },
    }).releaseAge ?? [];
  const manifest = (fields: object) => JSON.stringify({ name: 'x', private: true, ...fields });

  it('pnpm 11 and 12: 1440 minutes, labelled, with minimumReleaseAgeExclude', () => {
    expect(policyOf('pnpm-11-default')).toEqual([
      { minutes: 1440, source: 'pnpm 11 default', exclude: ['@acme/*'], builtIn: true },
    ]);
    expect(
      policies({ 'package.json': manifest({ packageManager: 'pnpm@12.11.2+sha512.abc' }) }),
    ).toEqual([{ minutes: 1440, source: 'pnpm 12 default', exclude: [], builtIn: true }]);
    const engines = { devEngines: { packageManager: { name: 'pnpm', version: '^11.1.0' } } };
    expect(policies({ 'package.json': manifest(engines) })[0]?.source).toBe('pnpm 11 default');
  });

  it('Yarn 4.15 and later 4.x: 1d, from packageManager or yarnPath, with npmPreapprovedPackages', () => {
    expect(policyOf('yarn-default')).toEqual([
      { minutes: 1440, source: 'Yarn 4.15+ default', exclude: [], builtIn: true },
    ]);
    expect(
      policies({
        'package.json': manifest({ packageManager: 'yarn@4.18.1' }),
        '.yarnrc.yml': 'npmPreapprovedPackages:\n  - gadget\n',
      }),
    ).toEqual([
      { minutes: 1440, source: 'Yarn 4.15+ default', exclude: ['gadget'], builtIn: true },
    ]);
  });

  it('no default for versions without one, an explicit 0, or a version it cannot tell', () => {
    const none: Record<string, string>[] = [
      { 'package.json': manifest({ packageManager: 'pnpm@10.34.6' }) },
      { 'package.json': manifest({ packageManager: 'yarn@4.14.1' }) },
      { 'package.json': manifest({ packageManager: 'yarn@1.22.22' }) },
      { 'package.json': manifest({ packageManager: 'npm@11.6.0' }) },
      // Explicitly off.
      {
        'package.json': manifest({ packageManager: 'pnpm@11.2.0' }),
        'pnpm-workspace.yaml': 'minimumReleaseAge: 0\n',
      },
      {
        'package.json': manifest({ packageManager: 'yarn@4.18.1' }),
        '.yarnrc.yml': 'npmMinimalAgeGate: 0\n',
      },
      // Not pinned, or pinned to a range that spans versions with and without one.
      { 'package.json': manifest({}), 'pnpm-workspace.yaml': 'packages: [.]\n' },
      {
        'package.json': manifest({
          devEngines: { packageManager: { name: 'pnpm', version: '>=10' } },
        }),
      },
      {
        'package.json': manifest({
          devEngines: { packageManager: { name: 'pnpm', version: '>=11' } },
        }),
      },
      { 'package.json': manifest({ packageManager: 'pnpm@13.0.0' }) },
      { 'package.json': manifest({ packageManager: 'yarn@5.0.0' }) },
    ];
    for (const files of none) expect(policies(files), JSON.stringify(files)).toEqual([]);
  });

  it('the reason names the default', () => {
    const time = { '4.0.0': daysAgo(100), '5.0.0': new Date(NOW - 5 * 3600_000).toISOString() };
    const result = newestAllowed(
      policyOf('pnpm-11-default'),
      'gadget',
      '5.0.0',
      Object.keys(time),
      time,
      NOW,
    );
    expect(heldBackText(result.held as never, '4.0.0')).toBe(
      '5.0.0 is 5 hours old; your policy is 1 day (pnpm 11 default); nothing newer than 4.0.0 qualifies',
    );
  });
});

describe('newestAllowed', () => {
  const pick = (policies: ReleaseAgePolicy[], name: string) => {
    const { time, latest } = PACKAGES[name] as (typeof PACKAGES)[string];
    return newestAllowed(policies, name, latest, Object.keys(time), time, NOW);
  };

  it('targets the newest stable release old enough and says why', () => {
    const result = pick(npmPolicy, 'widget');
    expect(result.version).toBe('4.6.5');
    expect(heldBackText(result.held as never)).toBe(
      '4.6.7 is 2 days old; your policy is 7 days (min-release-age in .npmrc); targeting 4.6.5',
    );
  });

  it('says when nothing newer than the installed version qualifies, or nothing at all', () => {
    const gadget = pick(npmPolicy, 'gadget');
    expect(gadget.version).toBe('4.0.0');
    expect(heldBackText(gadget.held as never, '4.0.0')).toBe(
      '5.0.0 is 1 day old; your policy is 7 days (min-release-age in .npmrc); nothing newer than 4.0.0 qualifies',
    );
    const tool = pick(npmPolicy, '@acme/tool');
    expect(tool.version).toBeUndefined();
    expect(heldBackText(tool.held as never)).toMatch(/no published version is old enough$/);
  });

  it("honours each manager's exclude list: name globs, single versions, whole packages", () => {
    const pnpm = policyOf('pnpm');
    expect(pick(pnpm, '@acme/tool')).toEqual({ version: '1.0.0' });
    expect(pick(pnpm, 'gadget')).toEqual({ version: '5.0.0' });
    expect(pick(pnpm, 'widget').version).toBe('4.6.5');
    const yarn = policyOf('yarn');
    expect(pick(yarn, 'gadget')).toEqual({ version: '5.0.0' });
    expect(pick(yarn, 'widget').version).toBe('4.6.6');
    expect(pick(yarn, '@acme/tool').version).toBeUndefined();
  });

  it('allows a version with no publish date, as pnpm does', () => {
    expect(newestAllowed(npmPolicy, 'widget', '4.6.7', ['4.6.7'], {}, NOW)).toEqual({
      version: '4.6.7',
    });
  });
});

describe('the fetchers apply the policy', () => {
  it('npm fetcher: latest, versions and manifests leave out releases that are too young', async () => {
    const { fetchFn, full } = registry();
    const fetcher = createNpmFetcher({
      config: config(npmPolicy),
      fetch: fetchFn,
      cacheDir: mkdtempSync(join(tmpdir(), 'uptide-cache-')),
    });
    expect(await fetcher.resolve('widget', 'latest')).toBe('4.6.5');
    expect(fetcher.heldBack?.('widget')).toMatchObject({ latest: '4.6.7', allowed: '4.6.5' });
    expect(await fetcher.versions?.('widget')).toEqual(['4.6.0', '4.6.5']);
    expect(Object.keys((await fetcher.manifests?.('widget')) ?? {})).toEqual(['4.6.0', '4.6.5']);
    // An exact version is what it is; a request for one is judged by releaseAge.
    expect(await fetcher.resolve('widget', '4.6.7')).toBe('4.6.7');
    expect(await fetcher.releaseAge?.('widget', '4.6.7')).toMatchObject({ allowed: '4.6.5' });
    const error = await fetcher.resolve('@acme/tool', 'latest').catch((e: unknown) => e);
    expect(errorCode(error)).toBe('RELEASE_AGE');
    // Nothing changed inside the window: no full document is downloaded.
    expect(await fetcher.resolve('steady', 'latest')).toBe('2.0.0');
    expect(full).not.toContain('steady');
  });

  it('npm fetcher without a policy: latest as the registry says, no publish dates fetched', async () => {
    const { fetchFn, full } = registry();
    const fetcher = createNpmFetcher({
      config: config([]),
      fetch: fetchFn,
      cacheDir: mkdtempSync(join(tmpdir(), 'uptide-cache-')),
    });
    expect(await fetcher.resolve('widget', 'latest')).toBe('4.6.7');
    expect(full).toEqual([]);
  });

  it('list: targets per policy, and says why under releaseAge', async () => {
    const { fetchFn } = registry();
    const cwd = fixture('npm');
    const report = await listDependencies({
      cwd,
      fetcher: createDiscoveryFetcher({ cwd, config: config(npmPolicy), fetch: fetchFn }),
      advisories: false,
    });
    expect(report.packages.map((p) => [p.name, p.current, p.latest])).toEqual([
      ['widget', '4.6.0', '4.6.5'],
    ]);
    expect(report.releaseAge).toEqual([
      {
        name: '@acme/tool',
        current: '1.0.0',
        reason:
          '1.0.0 is 1 day old; your policy is 7 days (min-release-age in .npmrc); no published version is old enough',
      },
      {
        name: 'gadget',
        current: '4.0.0',
        reason:
          '5.0.0 is 1 day old; your policy is 7 days (min-release-age in .npmrc); nothing newer than 4.0.0 qualifies',
      },
      {
        name: 'widget',
        current: '4.6.0',
        reason:
          '4.6.7 is 2 days old; your policy is 7 days (min-release-age in .npmrc); targeting 4.6.5',
      },
    ]);
    expect(report.failures).toEqual([]);
    expect(report.unknown).toEqual([]);
  });
});

describe('fix and the run report', () => {
  it('fix: the policy chooses the target, and an explicit target too young is refused', async () => {
    const { fetchFn } = registry();
    const fetcher = createNpmFetcher({
      config: config(npmPolicy),
      fetch: fetchFn,
      cacheDir: mkdtempSync(join(tmpdir(), 'uptide-cache-')),
    });
    const pack = { name: 'widget', defaultTarget: '4.6.7' };
    expect(await resolveTarget(pack, undefined, fetcher.resolve, fetcher)).toEqual({
      version: '4.6.5',
      source: 'release-age policy',
      releaseAge:
        '4.6.7 is 2 days old; your policy is 7 days (min-release-age in .npmrc); targeting 4.6.5',
    });
    await expect(resolveTarget(pack, 'widget@4.6.7', fetcher.resolve, fetcher)).rejects.toThrow(
      'widget@4.6.7 is 2 days old; your policy is 7 days (min-release-age in .npmrc), so the install would refuse it. The newest release old enough is 4.6.5.',
    );
    // Nothing old enough never falls back to the pack's tested target.
    const tool = { name: '@acme/tool', defaultTarget: '1.0.0' };
    const error = await resolveTarget(tool, undefined, fetcher.resolve, fetcher).catch((e) => e);
    expect(errorCode(error)).toBe('RELEASE_AGE');
  });

  it('check: a package with nothing old enough is skipped in uptide.run/v1, with the reason', () => {
    const row = fromChecked({
      workspace: '.',
      name: 'gadget',
      installed: '4.0.0',
      latest: '4.0.0',
      target: '4.0.0',
      majorsBehind: 0,
      findings: [],
      callSitesChecked: 0,
      unanalyzed: [],
      status: 'skipped',
      skipReason: 'RELEASE_AGE',
      releaseAge:
        '5.0.0 is 1 day old; your policy is 7 days (min-release-age in .npmrc); nothing newer than 4.0.0 qualifies',
      notes: [],
      timing: { fetchMs: 0, diffMs: 0, usagesMs: 0, compileMs: 0 },
    });
    expect(row).toMatchObject({
      package: 'gadget',
      from: '4.0.0',
      status: 'skipped',
      error:
        'gadget 5.0.0 is 1 day old; your policy is 7 days (min-release-age in .npmrc); nothing newer than 4.0.0 qualifies',
    });
  });
});
