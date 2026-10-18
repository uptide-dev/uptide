import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { maxSatisfying, satisfies } from '../../fetch/range.js';
import * as process from '../process.js';
import { InstallBlockedError, upgradeInstall } from './upgrade.js';

// UPT-107: npm's lock-only install ERESOLVEs from the old lockfile although the same manifest
// resolves fresh. A stand-in npm: it resolves from a small registry, keeps what the lockfile
// already locks, and fails with npm's own ERESOLVE report while `conflict` holds.
const eresolve = readFileSync(
  resolve(import.meta.dirname, '../../../../../fixtures/lockfiles/eresolve/npm-11.txt'),
  'utf8',
);
type Entry = { version: string; peerDependencies?: Record<string, string> };
type Lock = { packages: Record<string, Entry> };
const registry: Record<string, Entry[]> = {
  ui: [{ version: '1.0.0' }, { version: '2.0.0' }],
  'ui-dom': [
    { version: '1.0.0', peerDependencies: { ui: '^1.0.0' } },
    { version: '2.0.0', peerDependencies: { ui: '^2.0.0' } },
  ],
  toggle: [
    { version: '1.0.0', peerDependencies: { ui: '^1.0.0' } },
    { version: '1.1.0', peerDependencies: { ui: '^1.0.0 || ^2.0.0' } },
  ],
  unrelated: [{ version: '1.0.0' }, { version: '1.2.0' }],
};
const lockOf = (deps: Record<string, string>, entries: Record<string, Entry>) => ({
  name: 'app',
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': { name: 'app', dependencies: deps },
    ...Object.fromEntries(Object.entries(entries).map(([n, e]) => [`node_modules/${n}`, e])),
  },
});
const ranges = { ui: '^1.0.0', 'ui-dom': '^1.0.0', toggle: '^1.0.0', unrelated: '^1.0.0' };
const first = (name: string) => registry[name]?.[0] as Entry;

let root = '';
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

function repo(conflict: (lock: Lock) => boolean) {
  root = mkdtempSync(join(tmpdir(), 'uptide-eresolve-'));
  const manifest = (deps: Record<string, string>) =>
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'app', dependencies: deps }));
  manifest(ranges);
  const before = Object.fromEntries(Object.keys(ranges).map((n) => [n, first(n)]));
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lockOf(ranges, before)));
  for (const args of [
    ['init', '-q'],
    ['add', '.'],
    ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'parent'],
  ])
    execFileSync('git', args, { cwd: root });
  // What the plan writes: the lead and its companion bumped.
  manifest({ ...ranges, ui: '^2.0.0', 'ui-dom': '^2.0.0' });
  const installs: { args: string[]; lock: Lock }[] = [];
  vi.spyOn(process, 'command').mockImplementation(async (_root, _bin, args) => {
    if (args[0] === '--version') return { code: 0, output: '11.6.2', timeout: false };
    if (args[0] !== 'install') return { code: 0, output: '', timeout: false };
    const lock: Lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
    installs.push({ args, lock });
    if (conflict(lock)) return { code: 1, output: eresolve, timeout: false };
    const deps: Record<string, string> = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    ).dependencies;
    const entries: Record<string, Entry> = {};
    for (const [name, range] of Object.entries(deps)) {
      const locked = lock.packages[`node_modules/${name}`];
      const versions = (registry[name] ?? []).map((e) => e.version);
      const version =
        locked && satisfies(locked.version, range)
          ? locked.version
          : (maxSatisfying(versions, range) as string);
      entries[name] = registry[name]?.find((e) => e.version === version) as Entry;
    }
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lockOf(deps, entries)));
    return { code: 0, output: '', timeout: false };
  });
  return installs;
}
const upgrade = {
  name: 'ui',
  version: '2.0.0',
  also: [{ name: 'ui-dom', version: '2.0.0' }],
  files: ['package.json'],
  workspaces: ['.'],
  acceptOutOfScope: true,
};
const locked = (lock: Lock | undefined) =>
  Object.keys(lock?.packages ?? {})
    .filter(Boolean)
    .map((k) => k.replace('node_modules/', ''));
const neverForced = (installs: { args: string[] }[]) => {
  for (const { args } of installs) {
    expect(args).not.toContain('--legacy-peer-deps');
    expect(args).not.toContain('--force');
  }
};

it('retries without the moved packages and the packages whose peers they satisfy', async () => {
  // toggle 1.0.0 locks a peer the upgrade leaves: only dropping it lets npm resolve 1.1.0.
  const installs = repo((lock) => lock.packages['node_modules/toggle']?.version === '1.0.0');
  const report = await upgradeInstall(root, upgrade);
  expect(report.eresolveRetry).toMatchObject({
    step: 'moved entries',
    dropped: ['toggle', 'ui', 'ui-dom'],
  });
  expect(report.eresolveRetry?.conflicts).toContain('Conflicting peer dependency: ui@2.0.0');
  // The retry started from the old lockfile less those entries: unrelated stayed locked.
  expect(locked(installs[1]?.lock)).toEqual(['unrelated']);
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  expect(lock.packages['node_modules/toggle'].version).toBe('1.1.0');
  expect(lock.packages['node_modules/unrelated'].version).toBe('1.0.0');
  neverForced(installs);
});

it('re-resolves the whole lockfile only when dropping the moved entries is not enough', async () => {
  // A conflict outside the upgrade's names: the old unrelated entry keeps npm from resolving.
  const installs = repo((lock) => lock.packages['node_modules/unrelated']?.version === '1.0.0');
  const report = await upgradeInstall(root, upgrade);
  expect(report.eresolveRetry?.step).toBe('whole lockfile');
  expect(locked(installs[1]?.lock)).toEqual(['unrelated']);
  expect(locked(installs[2]?.lock)).toEqual([]);
  // A fresh resolve's churn (unrelated 1.0.0 → 1.2.0) is the same at the parent commit:
  // reported as such by the lock guard, not refused and not blamed on the upgrade.
  expect(report.parentChurn).toEqual(
    expect.arrayContaining([
      { name: 'unrelated', from: '1.0.0', to: '1.2.0' },
      { name: 'toggle', from: '1.0.0', to: '1.1.0' },
    ]),
  );
  expect(report.outOfScope).toBeUndefined();
  neverForced(installs);
});

it('ends blocked, naming the packages npm reported, when every step fails', async () => {
  const installs = repo(() => true);
  const error = await upgradeInstall(root, upgrade).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(InstallBlockedError);
  const blocked = error as InstallBlockedError;
  expect(blocked.code).toBe('INSTALL_BLOCKED');
  expect(blocked.blocked.attempts).toEqual(['lock-only', 'moved entries', 'whole lockfile']);
  expect(blocked.blocked.conflicts).toEqual([
    'While resolving: app@1.0.0',
    'Found: toggle@1.0.0',
    'Could not resolve dependency: toggle@"^1.0.0" from the root project',
    'Conflicting peer dependency: ui@2.0.0',
    'peer ui@"^1.0.0" from toggle@1.0.0',
  ]);
  expect(blocked.message).toContain('Conflicting peer dependency: ui@2.0.0');
  expect(blocked.message).toContain('--legacy-peer-deps');
  expect(installs).toHaveLength(3);
  neverForced(installs);
});
