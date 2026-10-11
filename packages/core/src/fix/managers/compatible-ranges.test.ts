import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { parseNpm, parsePnpm, parseYarn } from '../../adapters/typescript/lockfile.js';
import { installedManifest } from '../../list/evidence.js';
import { command, git } from '../process.js';
import { bumpVersions } from '../versions.js';
import { assertManagerAvailable } from './availability.js';
import { isolatedUpgrade } from './isolated-install.js';
import { updateArgs } from './manager.js';

const names = ['react', '@types/react'];
const old = '19.1.0';
const target = '19.2.0';

it.runIf(process.env.UPTIDE_NETWORK === '1').each(
  [
    { manager: 'npm', pin: undefined },
    { manager: 'pnpm', pin: 'pnpm@10.17.1' },
    { manager: 'yarn', pin: 'yarn@3.2.1' },
    { manager: 'yarn', pin: 'yarn@4.7.0' },
  ].flatMap((manager) => ['^19.0.0', '>=16.8'].map((range) => ({ ...manager, range }))),
)(
  '$manager ($pin) installs the exact target while preserving compatible $range',
  async ({ manager, pin, range }) => {
    const root = mkdtempSync(join(tmpdir(), 'uptide-compatible-install-'));
    const read = (file: string) => readFileSync(join(root, file), 'utf8');
    const put = (file: string, text: string) => writeFileSync(join(root, file), text);
    const run = async (bin: string, args: string[]) => {
      const result = await command(root, bin, args, 120_000, {
        YARN_ENABLE_IMMUTABLE_INSTALLS: 'false',
        COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
        COREPACK_ENABLE_AUTO_PIN: '0',
      });
      expect(result.code, result.output).toBe(0);
    };
    try {
      mkdirSync(join(root, 'packages/app'), { recursive: true });
      const manifest = {
        name: 'compatible-root',
        private: true,
        workspaces: ['packages/*'],
        ...(pin ? { packageManager: pin } : {}),
        dependencies: { react: old },
        devDependencies: { '@types/react': old },
      };
      put('package.json', JSON.stringify(manifest));
      put(
        'packages/app/package.json',
        JSON.stringify({ name: 'compatible-app', dependencies: { react: old } }),
      );
      put('.gitignore', 'node_modules\n.yarn\n');
      if (manager === 'pnpm') put('pnpm-workspace.yaml', 'packages: [packages/*]\n');
      if (manager === 'yarn')
        put('.yarnrc.yml', 'nodeLinker: node-modules\nenableGlobalCache: true\n');
      await run(
        manager === 'yarn' ? 'corepack' : manager,
        manager === 'yarn' ? ['yarn', 'install'] : ['install', '--ignore-scripts'],
      );
      const pm = await assertManagerAvailable(root);
      // Seed a historical compatible lock entry, then require the real manager to accept it frozen.
      manifest.dependencies.react = range;
      manifest.devDependencies['@types/react'] = range;
      put('package.json', JSON.stringify(manifest));
      put(
        'packages/app/package.json',
        JSON.stringify({ name: 'compatible-app', dependencies: { react: range } }),
      );
      const lock = manager === 'npm' ? JSON.parse(read(pm.lockfile)) : parse(read(pm.lockfile));
      if (manager === 'yarn') {
        for (const key of Object.keys(lock)) {
          const renamed = key
            .split(', ')
            .map((descriptor) =>
              names.reduce(
                (value, name) => (value === `${name}@npm:${old}` ? `${name}@npm:${range}` : value),
                descriptor,
              ),
            )
            .join(', ');
          if (renamed !== key) {
            lock[renamed] = lock[key];
            delete lock[key];
          }
        }
      } else {
        for (const importer of manager === 'npm'
          ? [lock.packages[''], lock.packages['packages/app']]
          : Object.values(lock.importers)) {
          for (const section of ['dependencies', 'devDependencies'])
            for (const name of names) {
              if (!importer[section]?.[name]) continue;
              if (manager === 'npm') importer[section][name] = range;
              else importer[section][name].specifier = range;
            }
        }
      }
      put(pm.lockfile, manager === 'npm' ? JSON.stringify(lock) : stringify(lock));
      if (manager === 'yarn') await run(pm.bin, updateArgs(pm, root, ['.', 'packages/app']));
      await run(pm.bin, pm.args);
      const originals = new Map(
        ['package.json', 'packages/app/package.json'].map((file) => [file, read(file)]),
      );
      const parseLock = manager === 'npm' ? parseNpm : manager === 'pnpm' ? parsePnpm : parseYarn;
      const assertVersions = (version: string) => {
        for (const workspace of ['.', 'packages/app']) {
          const declared = new Map(
            (workspace === '.' ? names : ['react']).map((name) => [name, range]),
          );
          const resolved = parseLock(read(pm.lockfile), { importer: workspace, declared });
          for (const name of declared.keys()) {
            expect(resolved.get(name), `${workspace} lockfile ${name}`).toBe(version);
            expect(
              installedManifest(root, workspace, name)?.version,
              `${workspace} node_modules ${name}`,
            ).toBe(version);
          }
        }
      };
      assertVersions(old);
      git(root, 'init');
      git(root, 'add', '.');
      git(
        root,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.test',
        'commit',
        '-m',
        'baseline',
      );
      for (const name of names) expect(bumpVersions(root, name, target).files).toEqual([]);
      await isolatedUpgrade(root, {
        name: 'react',
        version: target,
        also: [{ name: '@types/react', version: target }],
        files: [],
        workspaces: ['.', 'packages/app'],
      });
      assertVersions(target);
      for (const [file, original] of originals) expect(read(file)).toBe(original);
      const upgradedLock = read(pm.lockfile);
      await run(pm.bin, pm.args);
      expect(read(pm.lockfile)).toBe(upgradedLock);
      assertVersions(target);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  180_000,
);
