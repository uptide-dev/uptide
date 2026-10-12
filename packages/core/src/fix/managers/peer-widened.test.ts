import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { parseNpm, parsePnpm, parseYarn } from '../../adapters/typescript/lockfile.js';
import * as process from '../process.js';
import { upgradeInstall } from './upgrade.js';

// A 0.7.4 regression (#79): `packages/ui` declares `lib` twice, `devDependencies` bumped to the
// target's range and `peerDependencies` widened to keep the old major (`^1.0.0 || ^2.0.0`).
// The peer range overwrote the dev range in the post-install check; it is no lockfile
// descriptor, so Yarn read the old copy another package keeps (medusa: react 17.0.2 for 19.3.0).
const fixtures = resolve(import.meta.dirname, '../../../../../fixtures/lockfiles/peer-widened');
const scratch = mkdtempSync(join(tmpdir(), 'uptide-peer-widened-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const managers = [
  ['npm', 'npm@11.0.0', '11.0.0', 'npm', 'package-lock.json', parseNpm],
  ['pnpm', 'pnpm@9.15.0', '9.15.0', 'pnpm', 'pnpm-lock.yaml', parsePnpm],
  ['Yarn 3 (lockfile v6)', 'yarn@3.2.1', '3.2.1', 'yarn3', 'yarn.lock', parseYarn],
  ['Yarn 4 (lockfile v8)', 'yarn@4.9.2', '4.9.2', 'yarn4', 'yarn.lock', parseYarn],
] as const;

describe.each(managers)('%s: a peer widened next to a bumped devDependency', (...row) => {
  const [, packageManager, version, prefix, lockfile, parse] = row;
  const lock = (state: string) =>
    readFileSync(join(fixtures, `${prefix}.${state}.${lockfile}`), 'utf8');

  it('installs the target, read by the devDependency range, never the peer range', async () => {
    const root = mkdtempSync(join(scratch, `${prefix}-`));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'app',
        private: true,
        packageManager,
        workspaces: ['packages/*'],
        dependencies: { 'old-tool': '^1.0.0' },
      }),
    );
    if (prefix === 'pnpm')
      writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
    mkdirSync(join(root, 'packages/ui'), { recursive: true });
    const ui = join(root, 'packages/ui/package.json');
    copyFileSync(join(fixtures, 'ui.before.package.json'), ui);
    writeFileSync(join(root, lockfile), lock('before'));
    for (const args of [
      ['init', '-q'],
      ['add', '.'],
      ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'before'],
    ])
      execFileSync('git', args, { cwd: root });
    // What the plan writes before the install: the dev range bumped, the peer range widened.
    copyFileSync(join(fixtures, 'ui.after.package.json'), ui);
    // The workspace's peer declarations at each install: never an install descriptor.
    const peersAtInstall: unknown[] = [];
    const command = vi.spyOn(process, 'command').mockImplementation(async (_root, _bin, args) => {
      if (args.includes('--version')) return { code: 0, output: version, timeout: false };
      if (args[0] !== 'set')
        peersAtInstall.push(JSON.parse(readFileSync(ui, 'utf8')).peerDependencies);
      // Every install (and Yarn's `set resolution`) leaves what the manager would write.
      if (args[0] !== 'set') writeFileSync(join(root, lockfile), lock('after'));
      return { code: 0, output: '', timeout: false };
    });
    try {
      await upgradeInstall(root, {
        name: 'lib',
        version: '2.0.0',
        files: ['packages/ui/package.json'],
        workspaces: ['packages/ui'],
      });
      const written = readFileSync(join(root, lockfile), 'utf8');
      expect(
        parse(written, {
          importer: 'packages/ui',
          declared: new Map([['lib', '^2.0.0']]),
        }).get('lib'),
      ).toBe('2.0.0');
      // The peer range stays what the plan widened it to, and was never installed by.
      expect(JSON.parse(readFileSync(ui, 'utf8')).peerDependencies).toEqual({
        lib: '^1.0.0 || ^2.0.0',
      });
      expect(peersAtInstall.length).toBeGreaterThan(0);
      for (const peers of peersAtInstall) expect(peers).toEqual({ lib: '^1.0.0 || ^2.0.0' });
    } finally {
      command.mockRestore();
    }
  });
});
