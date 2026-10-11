import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import * as process from '../process.js';
import { upgradeInstall } from './upgrade.js';

it('keeps simple npm aliases during exact resolution and restores partial ranges on failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uptide-alias-upgrade-'));
  const original = JSON.stringify({
    dependencies: { runtime: 'npm:react@^19', types: 'npm:@types/react@~19.3' },
  });
  writeFileSync(join(root, 'package.json'), original);
  writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}');
  const command = vi.spyOn(process, 'command').mockImplementation(async (_root, _bin, args) => {
    if (args[0] === '--version') return { code: 0, output: '11.0.0', timeout: false };
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies).toEqual({
      runtime: 'npm:react@19.3.0',
      types: 'npm:@types/react@19.3.1',
    });
    throw new Error('registry unavailable');
  });
  try {
    await expect(
      upgradeInstall(root, {
        name: 'runtime',
        version: '19.3.0',
        also: [{ name: 'types', version: '19.3.1' }],
        files: ['package.json'],
        workspaces: ['.'],
      }),
    ).rejects.toThrow('registry unavailable');
    expect(command).toHaveBeenCalledTimes(2);
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(original);
  } finally {
    command.mockRestore();
    rmSync(root, { recursive: true, force: true });
  }
});

it('passes allowed-peer roots to the guard while keeping their manifest declarations protected', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uptide-allowed-scope-'));
  const manifest = {
    dependencies: { leader: '^2', plugin: '^1', unrelated: '^1' },
    overrides: { plugin: { leader: '$leader' } },
  };
  const lock = {
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { leader: '^1', plugin: '^1', unrelated: '^1' } },
      'node_modules/leader': { version: '1.0.0' },
      'node_modules/plugin': { version: '1.0.0', dependencies: { child: '^1' } },
      'node_modules/child': { version: '1.0.0' },
      'node_modules/unrelated': { version: '1.0.0' },
    },
  };
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock));
  const command = vi.spyOn(process, 'command').mockImplementation(async (_root, _bin, args) => {
    if (args[0] === '--version') return { code: 0, output: '11.0.0', timeout: false };
    if (args[0] === 'install') {
      lock.packages[''].dependencies = JSON.parse(
        readFileSync(join(root, 'package.json'), 'utf8'),
      ).dependencies;
      lock.packages['node_modules/leader'].version = '2.0.0';
      lock.packages['node_modules/child'].version = '1.1.0';
      writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock));
    }
    return { code: 0, output: '', timeout: false };
  });
  try {
    const report = await upgradeInstall(root, {
      name: 'leader',
      version: '2.0.0',
      allowedPeers: ['plugin'],
      files: ['package.json'],
      workspaces: ['.'],
    });
    expect(report.changed).toContain('node_modules/child');
    expect(report.allowed).not.toContain('node_modules/unrelated');
    expect(command.mock.calls.flatMap((c) => c[2])).not.toContain('--force');
    expect(command.mock.calls.flatMap((c) => c[2])).not.toContain('--legacy-peer-deps');
  } finally {
    command.mockRestore();
    rmSync(root, { recursive: true, force: true });
  }
});

it.each(['10.9.3', '11.19.0'])(
  'preserves npm %s libc only for the legacy serializer, before ci',
  async (version) => {
    const root = mkdtempSync(join(tmpdir(), 'uptide-libc-'));
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { binary: '1' } },
        'node_modules/binary': {
          version: '1.0.0',
          integrity: 'sha512-identical',
          libc: ['musl'],
        } as Record<string, unknown>,
      },
    };
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { binary: '1' } }));
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock));
    const command = vi.spyOn(process, 'command').mockImplementation(async (_root, _bin, args) => {
      if (args[0] === '--version') return { code: 0, output: version, timeout: false };
      if (args[0] === 'install') {
        delete lock.packages['node_modules/binary'].libc;
        writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock));
      } else
        expect(
          JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')).packages[
            'node_modules/binary'
          ].libc,
        ).toEqual(['musl']);
      return { code: 0, output: '', timeout: false };
    });
    try {
      const result = upgradeInstall(root, {
        name: 'target',
        version: '2.0.0',
        files: [],
        workspaces: [],
      });
      if (version.startsWith('10.')) await expect(result).resolves.toMatchObject({ changed: [] });
      else {
        await expect(result).rejects.toThrow('npm 11.19.0: Install changed resolutions');
        expect(command.mock.calls.some((c) => c[2][0] === 'ci')).toBe(false);
      }
    } finally {
      command.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
