import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import * as process from '../process.js';
import { upgradeInstall } from './upgrade.js';

it.each([{ files: ['package.json'] }, { files: [] }])(
  'resolves the target and restores aliases even for unchanged manifests (%j)',
  async ({ files }) => {
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
          files,
          workspaces: ['.'],
        }),
      ).rejects.toThrow('registry unavailable');
      expect(command).toHaveBeenCalledTimes(2);
      expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(original);
    } finally {
      command.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  },
);

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

it.each([
  ['^19.0.0', '^19.0.0', 'npm:19.2.0'],
  ['>=16.8', '>=16.8', 'npm:19.2.0'],
  ['npm:react@^19', 'npm:react@^19', 'npm:react@19.2.0'],
  ['npm:@types/react@^19', 'npm:@types/react@^19', 'npm:@types/react@19.2.0'],
  ['18.2.0', '19.2.0', undefined],
  // A range the plan rewrote is as broad as one it kept: Yarn would take its newest match.
  ['^18.2.0', '^19.2.0', 'npm:19.2.0'],
  ['19.2.0', '19.2.0', undefined],
  ['npm:react@19.2.0', 'npm:react@19.2.0', undefined],
  ['^18', '^18', undefined],
  ...[
    'workspace:^19',
    'catalog:',
    'link:../react',
    'file:../react',
    'portal:../react',
    'patch:react@npm%3A19.2.0#./react.patch',
    'git+https://example.test/react.git',
    'https://example.test/react.tgz',
    'github:example/react',
    'latest',
  ].map((spec) => [spec, spec, undefined]),
])(
  'pins compatible npm descriptors to the exact target: %s → %s',
  async (_before, spec, resolution) => {
    const root = mkdtempSync(join(tmpdir(), 'uptide-berry-descriptor-'));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        packageManager: 'yarn@4.9.2',
        dependencies: { react: spec },
      }),
    );
    writeFileSync(join(root, 'yarn.lock'), '__metadata:\n  version: 8\n');
    let installs = 0;
    const command = vi.spyOn(process, 'command').mockImplementation(async (_root, _bin, args) => {
      if (args[0] === '--version') return { code: 0, output: '4.9.2', timeout: false };
      if (args[0] === 'install' && ++installs === 2) throw new Error('reconcile');
      return { code: 0, output: '', timeout: false };
    });
    try {
      await expect(
        upgradeInstall(root, { name: 'react', version: '19.2.0', files: [], workspaces: ['.'] }),
      ).rejects.toThrow('reconcile');
      const pins = command.mock.calls.map((call) => call[2]).filter((args) => args[0] === 'set');
      expect(pins).toEqual(
        resolution
          ? [
              [
                'set',
                'resolution',
                `react@${spec?.startsWith('npm:') ? spec : `npm:${spec}`}`,
                resolution,
              ],
            ]
          : [],
      );
      expect(
        JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).resolutions,
      ).toBeUndefined();
    } finally {
      command.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  },
);

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
      } else if (version.startsWith('10.'))
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
      // npm 11 drops libc at the parent commit too (UPT-79): reported, not refused.
      else
        await expect(result).resolves.toMatchObject({
          parentChurn: expect.arrayContaining([{ name: 'binary', from: '1.0.0', to: '1.0.0' }]),
        });
    } finally {
      command.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  },
);

// UPT-29: npm 11.6 drops sharp's optional `@emnapi/*` on the first lock-only install after a
// manifest change and keeps a `@emnapi/wasi-threads` that no longer satisfies, so `npm ci`
// rejects the lockfile. The next install over the same manifest writes one it accepts.
it('reconciles npm twice so ci accepts optional platform churn the parent commit has too', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uptide-emnapi-'));
  const manifest = (target: string) =>
    `${JSON.stringify({ dependencies: { sharp: '^0.34.0', target } }, null, 2)}\n`;
  const lock = (target: string, settled: boolean) =>
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { sharp: '^0.34.0', target } },
        'node_modules/target': { version: target.replace('^', '') },
        'node_modules/sharp': {
          version: '0.34.5',
          optionalDependencies: { '@emnapi/runtime': '^1.7.0' },
        },
        ...(settled && {
          'node_modules/@emnapi/runtime': {
            version: '1.11.3',
            optional: true,
            dependencies: { '@emnapi/wasi-threads': '1.2.3' },
          },
        }),
        'node_modules/@emnapi/wasi-threads': {
          version: settled ? '1.2.3' : '1.1.0',
          optional: true,
        },
      },
    });
  writeFileSync(join(root, 'package.json'), manifest('^1.0.0'));
  writeFileSync(join(root, 'package-lock.json'), lock('^1.0.0', true).replace('1.11.3', '1.7.1'));
  for (const args of [
    ['init', '-q'],
    ['add', '.'],
    ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'parent'],
  ])
    execFileSync('git', args, { cwd: root });
  writeFileSync(join(root, 'package.json'), manifest('^2.0.0'));
  let previous = '';
  let settled = true;
  const command = vi.spyOn(process, 'command').mockImplementation(async (_root, _bin, args) => {
    if (args[0] === '--version') return { code: 0, output: '11.6.2', timeout: false };
    if (args[0] === 'install') {
      const current = readFileSync(join(root, 'package.json'), 'utf8');
      settled = current === previous;
      previous = current;
      writeFileSync(
        join(root, 'package-lock.json'),
        lock(JSON.parse(current).dependencies.target, settled),
      );
    }
    if (args[0] === 'ci' && !settled)
      return {
        code: 1,
        output: "lock file's @emnapi/wasi-threads@1.1.0 does not satisfy",
        timeout: false,
      };
    return { code: 0, output: '', timeout: false };
  });
  try {
    const report = await upgradeInstall(root, {
      name: 'target',
      version: '2.0.0',
      files: ['package.json'],
      workspaces: ['.'],
    });
    expect(report.parentChurn?.map((c) => c.name)).toEqual(
      expect.arrayContaining(['sharp', '@emnapi/runtime']),
    );
    expect(report.outOfScope).toBeUndefined();
  } finally {
    command.mockRestore();
    rmSync(root, { recursive: true, force: true });
  }
});
