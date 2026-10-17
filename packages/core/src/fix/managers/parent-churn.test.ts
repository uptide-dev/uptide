import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import * as process from '../process.js';
import { upgradeInstall } from './upgrade.js';

// UPT-79: whenever pnpm rewrites this lockfile, upgrade or not, it re-resolves `picomatch`
// (same version, new integrity). It leaves an up-to-date lockfile alone, as pnpm does, so the
// parent commit has to be rewritten too. That churn is the parent's and never blocks the upgrade.
const lock = (spec: string, other: string, churn: string) => {
  const target = spec.replace('^', '');
  return `lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      other:
        specifier: ^1.0.0
        version: ${other}
      picomatch:
        specifier: ^4.0.0
        version: 4.0.2
      target:
        specifier: ${spec}
        version: ${target}
packages:
  other@${other}:
    resolution: {integrity: sha512-other-${other}}
  picomatch@4.0.2:
    resolution: {integrity: sha512-picomatch-${churn}}
  target@${target}:
    resolution: {integrity: sha512-target-${target}}
snapshots:
  other@${other}: {}
  picomatch@4.0.2: {}
  target@${target}: {}
`;
};
let root = '';
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

/** A committed repo on target 1.0.0; every rewrite churns picomatch, and moves `other` if asked. */
function repo(moves: boolean) {
  root = mkdtempSync(join(tmpdir(), 'uptide-parent-churn-'));
  const manifest = (target: string) =>
    JSON.stringify({
      packageManager: 'pnpm@9.15.0',
      dependencies: { other: '^1.0.0', picomatch: '^4.0.0', target: `^${target}` },
    });
  writeFileSync(join(root, 'package.json'), manifest('1.0.0'));
  writeFileSync(join(root, 'pnpm-lock.yaml'), lock('^1.0.0', '1.0.0', 'old'));
  for (const args of [
    ['init', '-q'],
    ['add', '.'],
    ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'parent'],
  ])
    execFileSync('git', args, { cwd: root });
  // What the plan writes before the install.
  writeFileSync(join(root, 'package.json'), manifest('2.0.0'));
  const installs: string[] = [];
  const calls: { target: string; bin: string; args: string[]; env: unknown }[] = [];
  vi.spyOn(process, 'command').mockImplementation(async (_root, bin, args, _timeout, env) => {
    if (args.includes('--version')) return { code: 0, output: '9.15.0', timeout: false };
    if (args.includes('--no-frozen-lockfile')) {
      const spec = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies.target;
      const target = spec.replace('^', '');
      calls.push({ target, bin, args, env });
      const locked = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');
      if (locked.includes(`target:\n        specifier: ${spec}\n`))
        return { code: 0, output: '', timeout: false };
      installs.push(target);
      const other = moves && target === '2.0.0' ? '1.1.0' : '1.0.0';
      writeFileSync(join(root, 'pnpm-lock.yaml'), lock(spec, other, 'new'));
    }
    return { code: 0, output: '', timeout: false };
  });
  const upgrade = { name: 'target', version: '2.0.0', files: ['package.json'], workspaces: ['.'] };
  return { installs, calls, upgrade };
}

it('reports churn the parent commit already has instead of refusing', async () => {
  const { installs, upgrade } = repo(false);
  const report = await upgradeInstall(root, upgrade);
  expect(report.parentChurn).toEqual([{ name: 'picomatch', from: '4.0.2', to: '4.0.2' }]);
  expect(report.outOfScope).toBeUndefined();
  // Lockfile rewrites: upgrade pinned, reconciled, then the same two steps at the parent.
  expect(installs).toEqual(['2.0.0', '2.0.0', '1.0.0', '1.0.0']);
  expect(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')).toContain('target@2.0.0');
  expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies.target).toBe(
    '^2.0.0',
  );
});

it('still refuses what only the upgrade changes, naming none of the parent churn', async () => {
  const { upgrade } = repo(true);
  const error = await upgradeInstall(root, upgrade).catch((e: Error) => e);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/outside target's dependency subtree: .*other@1\.1\.0/);
  expect((error as Error).message).not.toContain('picomatch');
});

it('agent-led runs list only the upgrade-caused resolutions for review', async () => {
  const { upgrade } = repo(true);
  const report = await upgradeInstall(root, { ...upgrade, acceptOutOfScope: true });
  const names = report.outOfScope?.map((c) => c.name) ?? [];
  expect(names).toContain('other');
  expect(names).not.toContain('picomatch');
  expect(report.parentChurn?.map((c) => c.name)).toEqual(['picomatch']);
});

it('runs the parent install exactly as the upgrade install: same binary, flags and env, scripts off', async () => {
  const { calls, upgrade } = repo(false);
  await upgradeInstall(root, upgrade);
  const parent = calls.filter((c) => c.target === '1.0.0');
  const upgraded = calls.filter((c) => c.target === '2.0.0');
  expect(parent).toHaveLength(2);
  for (const step of parent)
    for (const call of upgraded) {
      expect(step.bin).toBe(call.bin);
      expect(step.args).toEqual(call.args);
      expect(step.env).toEqual(call.env);
    }
  // Lifecycle scripts never run: the flag is on the parent installs themselves, not only the upgrade.
  for (const step of parent) expect(step.args).toContain('--ignore-scripts');
});
