import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import * as process from '../process.js';
import { install } from '../versions.js';
import { assertManagerAvailable } from './availability.js';
import { upgradeInstall } from './upgrade.js';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture(file = 'package-lock.json', format = 3) {
  const root = mkdtempSync(join(tmpdir(), 'uptide-npm-pin-'));
  roots.push(root);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ packageManager: 'npm@10.9.0', dependencies: { leader: '^2' } }),
  );
  const lock = {
    lockfileVersion: format,
    packages: {
      '': { dependencies: { leader: '^1' } },
      'node_modules/leader': { version: '1.0.0' },
    },
  };
  writeFileSync(join(root, file), JSON.stringify(lock));
  return { root, lock, file };
}
function mockNpm(run: (args: string[]) => void, pinned = false) {
  return vi.spyOn(process, 'command').mockImplementation(async (_root, bin, args) => {
    if (bin === 'corepack' && !pinned) return { code: 1, output: 'not found', timeout: false };
    if (args.at(-1) === '--version')
      return {
        code: 0,
        output: bin === 'npm' ? '11.21.0' : args[0] === 'npm' ? '10.9.0' : '0.34.0',
        timeout: false,
      };
    if (pinned) {
      expect(bin).toBe('corepack');
      expect(args[0]).toBe('npm');
    }
    run(pinned ? args.slice(1) : args);
    return { code: 0, output: '', timeout: false };
  });
}
it.each(['package-lock.json', 'npm-shrinkwrap.json'])(
  'allows an unchanged frozen %s and restores a rewritten one',
  async (file) => {
    const { root } = fixture(file);
    const original = readFileSync(join(root, file), 'utf8');
    const cmd = mockNpm((args) => expect(args).toContain('--ignore-scripts'));
    await expect(install(root)).resolves.toBeUndefined();
    expect(readFileSync(join(root, file), 'utf8')).toBe(original);
    cmd.mockRestore();
    mockNpm(() => writeFileSync(join(root, file), `${original}\n`));
    await expect(install(root)).rejects.toMatchObject({ code: 'LOCKFILE_OUT_OF_SCOPE' });
    expect(readFileSync(join(root, file), 'utf8')).toBe(original);
  },
);
it.each([false, true])(
  'upgrades with the selected npm and reports fallback only when used (Corepack: %s)',
  async (pinned) => {
    const { root, lock, file } = fixture();
    mockNpm((args) => {
      if (args[0] === 'install') {
        expect(args).toContain('--lockfile-version=3');
        lock.packages[''].dependencies.leader = JSON.parse(
          readFileSync(join(root, 'package.json'), 'utf8'),
        ).dependencies.leader;
        lock.packages['node_modules/leader'].version = '2.0.0';
        writeFileSync(join(root, file), JSON.stringify(lock));
      }
    }, pinned);
    const report = await upgradeInstall(root, {
      name: 'leader',
      version: '2.0.0',
      files: ['package.json'],
      workspaces: ['.'],
    });
    expect(report.changed).toContain('node_modules/leader');
    if (pinned) expect(report.notes).toBeUndefined();
    else expect(report.notes).toEqual([expect.stringContaining('local npm@11.21.0')]);
  },
);
it('does not fall back across lockfile formats', async () => {
  const { root } = fixture('package-lock.json', 2);
  mockNpm(() => {
    throw new Error('must not install');
  });
  await expect(assertManagerAvailable(root)).rejects.toMatchObject({
    code: 'PACKAGE_MANAGER_VERSION',
  });
});
it('falls back when Corepack exists but cannot fetch the pin', async () => {
  const { root } = fixture();
  const probe = vi.fn<typeof process.command>(async (_root, bin, args) => ({
    code: args[0] === 'npm' ? 1 : 0,
    output: bin === 'npm' ? '11.21.0' : '0.34.0',
    timeout: false,
  }));
  await expect(assertManagerAvailable(root, probe)).resolves.toMatchObject({
    bin: 'npm',
    note: expect.stringContaining('Corepack could not run the pin'),
  });
});
