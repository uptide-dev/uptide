import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
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
    { manager: 'yarn', pin: 'yarn@4.9.2' },
  ].flatMap((manager) =>
    ['^19.0.0', '>=16.8', ...(manager.manager === 'yarn' ? [old] : [])].map((range) => ({
      ...manager,
      range,
    })),
  ),
)(
  '$manager ($pin) installs the exact target from $range',
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
          const manifest = JSON.parse(read(join(workspace, 'package.json')));
          const declared = new Map(
            (workspace === '.' ? names : ['react']).map((name) => [
              name,
              manifest.dependencies?.[name] ?? manifest.devDependencies?.[name],
            ]),
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
      const files = names.flatMap((name) => bumpVersions(root, name, target).files);
      if (range !== old) expect(files).toEqual([]);
      else for (const file of originals.keys()) originals.set(file, read(file));
      await isolatedUpgrade(root, {
        name: 'react',
        version: target,
        also: [{ name: '@types/react', version: target }],
        files: files.map((file) => relative(root, file)),
        workspaces: ['.', 'packages/app'],
      });
      assertVersions(target);
      for (const [file, original] of originals) expect(read(file)).toBe(original);
      const upgradedLock = read(pm.lockfile);
      await run(pm.bin, pm.args);
      expect(read(pm.lockfile)).toBe(upgradedLock);
      assertVersions(target);
      if (manager === 'yarn') {
        const lock = parse(upgradedLock);
        for (const name of names) {
          const descriptors = Object.keys(lock).filter((key) => key.startsWith(`${name}@`));
          expect(descriptors).toEqual([`${name}@npm:${range === old ? target : range}`]);
        }
        expect(JSON.parse(read('package.json')).resolutions).toBeUndefined();
        await run(pm.bin, [
          ...(pm.via === 'corepack' ? ['yarn'] : []),
          'up',
          ...names.map((name) => `${name}@${target}`),
          '--exact',
          '--mode=skip-build',
        ]);
        const packages = (text: string) =>
          Object.entries(parse(text))
            .filter(([key]) => key !== '__metadata' && !key.includes('@workspace:'))
            .map(([, record]) => record);
        // Only the manifest range and descriptor differ from native `yarn up --exact`.
        expect(packages(upgradedLock)).toEqual(packages(read(pm.lockfile)));
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  180_000,
);

it.runIf(process.env.UPTIDE_NETWORK === '1').each(['2.4.3', '3.2.1', '4.9.2'])(
  'Yarn %s accepts the selected build-suppression flag',
  async (version) => {
    const root = mkdtempSync(join(tmpdir(), 'uptide-yarn-flag-'));
    try {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: 'build-flag', private: true, packageManager: `yarn@${version}` }),
      );
      writeFileSync(join(root, 'yarn.lock'), '');
      writeFileSync(join(root, '.yarnrc.yml'), 'nodeLinker: node-modules\n');
      const pm = await assertManagerAvailable(root);
      for (const args of [updateArgs(pm, root, ['.']), pm.args]) {
        const result = await command(root, pm.bin, args, 120_000, {
          ...pm.env,
          YARN_ENABLE_IMMUTABLE_INSTALLS: 'false',
        });
        expect(result.code, result.output).toBe(0);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  180_000,
);

// UPT-124: Yarn classic ignores `resolutions` for a direct dependency, so a restored range
// resolved its newest match instead of the target.
it.runIf(process.env.UPTIDE_NETWORK === '1')(
  'yarn classic installs the exact target from ^19.0.0',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'uptide-classic-install-'));
    const read = (file: string) => readFileSync(join(root, file), 'utf8');
    const put = (file: string, text: string) => writeFileSync(join(root, file), text);
    try {
      put(
        'package.json',
        JSON.stringify({ name: 'classic', private: true, dependencies: { react: old } }),
      );
      put('.gitignore', 'node_modules\n');
      expect((await command(root, 'yarn', ['install', '--ignore-scripts'], 120_000)).code).toBe(0);
      // A lockfile that has the old version under the range, as an older install left it.
      put(
        'package.json',
        JSON.stringify({ name: 'classic', private: true, dependencies: { react: '^19.0.0' } }),
      );
      put('yarn.lock', read('yarn.lock').replace(`react@${old}:`, 'react@^19.0.0:'));
      const pm = await assertManagerAvailable(root);
      expect(pm.kind).toBe('yarn-classic');
      expect((await command(root, pm.bin, pm.args, 120_000)).code).toBe(0);
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
      const report = await isolatedUpgrade(root, {
        name: 'react',
        version: target,
        files: [],
        workspaces: ['.'],
      });
      expect(report.resolved).toBeUndefined();
      expect(
        parseYarn(read('yarn.lock'), {
          importer: '.',
          declared: new Map([['react', '^19.0.0']]),
        }).get('react'),
      ).toBe(target);
      expect(installedManifest(root, '.', 'react')?.version).toBe(target);
      expect(JSON.parse(read('package.json')).dependencies.react).toBe('^19.0.0');
      const upgradedLock = read('yarn.lock');
      expect((await command(root, pm.bin, pm.args, 120_000)).code).toBe(0);
      expect(read('yarn.lock')).toBe(upgradedLock);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  180_000,
);
