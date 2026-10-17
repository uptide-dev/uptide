import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { createTypescriptAdapter } from '../../adapters/typescript/index.js';
import { check } from '../../check/check.js';
import type { PackageFetcher } from '../../domain/io.js';
import { typescriptPack } from './index.js';

process.env.UPTIDE_CACHE_DIR = mkdtempSync(join(tmpdir(), 'uptide-ts-pack-cache-'));

it('reports tsconfig option sites outside every tsconfig include, where the project scope (UPT-49) never drops them', async () => {
  const compiler = dirname(createRequire(import.meta.url).resolve('typescript/package.json'));
  const cwd = mkdtempSync(join(tmpdir(), 'uptide-ts-pack-'));
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), text);
  };
  const dependencies = { typescript: '5.9.3' };
  write('package.json', JSON.stringify({ name: 'consumer', devDependencies: dependencies }));
  write(
    'package-lock.json',
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { devDependencies: dependencies },
        'node_modules/typescript': { version: '5.9.3' },
      },
    }),
  );
  mkdirSync(join(cwd, 'node_modules'));
  symlinkSync(compiler, join(cwd, 'node_modules', 'typescript'), 'dir');
  // No tsconfig file is inside any project's `include`: the compiler reads them, never compiles
  // them, and the project scope covers none of them. `config/tsconfig.base.json` is not even a
  // project (it is only extended), and its directory is excluded.
  write(
    'tsconfig.json',
    '{\n  "extends": "./config/tsconfig.base.json",\n  "compilerOptions": {\n    "baseUrl": ".",\n    "noEmit": true\n  },\n  "include": ["src/**/*.ts"],\n  "exclude": ["config"]\n}\n',
  );
  write(
    'config/tsconfig.base.json',
    '{\n  "compilerOptions": {\n    "target": "es2019",\n    "downlevelIteration": true\n  }\n}\n',
  );
  write(
    'tools/tsconfig.json',
    '{\n  "compilerOptions": {\n    "moduleResolution": "node",\n    "noEmit": true\n  },\n  "include": ["*.ts"]\n}\n',
  );
  write('src/index.ts', 'export const answer = 42;\n');
  write('tools/run.ts', 'export {};\n');
  // The target stands in for 6.0.3 with the same compiler: no compiler diagnostic, only the pack's.
  const fetcher: PackageFetcher = {
    resolve: async () => '6.0.3',
    fetch: async () => ({ name: 'typescript', version: '6.0.3', dir: compiler }),
    versions: async () => ['5.9.3', '6.0.3'],
    manifests: async () => ({ '5.9.3': {}, '6.0.3': {} }),
  };
  const result = await check({
    cwd,
    only: ['typescript'],
    targets: { typescript: '6.0.3' },
    packs: [typescriptPack],
    adapter: createTypescriptAdapter(),
    fetcher,
    runtime: false,
  });
  const sites = result.packages
    .flatMap((p) => p.findings)
    .filter((f) => /(^|\/)tsconfig[^/]*\.json$/.test(f.usage.file))
    .map((f) => [f.usage.file, f.usage.line, f.rule, f.severity]);
  expect(sites).toEqual([
    ['config/tsconfig.base.json', 4, 'downlevel-iteration', 'breaking'],
    ['tools/tsconfig.json', 3, 'module-resolution-node10', 'breaking'],
    ['tsconfig.json', 4, 'base-url', 'breaking'],
  ]);
  // The compile ran under the project scope (a tsconfig was found), not the no-tsconfig fallback.
  expect(result.packages[0]?.compile?.coverage?.noTsconfig).toBeUndefined();
}, 60_000);

// A yarn Berry repository whose package links itself (`"consumer": "link:."`, so
// `node_modules/consumer -> ..`), uses typescript only through its tsconfig files, and resolves
// it through Yarn's builtin `patch:` entry (UPT-84).
function berrySelfLinked(): string {
  const compiler = dirname(createRequire(import.meta.url).resolve('typescript/package.json'));
  const cwd = mkdtempSync(join(tmpdir(), 'uptide-ts-berry-'));
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), text);
  };
  write(
    'package.json',
    JSON.stringify({
      name: 'consumer',
      packageManager: 'yarn@4.9.1',
      devDependencies: { consumer: 'link:.', typescript: '^5.9.3' },
    }),
  );
  write(
    'yarn.lock',
    [
      '__metadata:\n  version: 8\n',
      '"consumer@link:., consumer@workspace:.":\n  version: 0.0.0-use.local\n  resolution: "consumer@workspace:."\n  languageName: unknown\n  linkType: soft\n',
      '"typescript@npm:^5.9.3":\n  version: 5.9.3\n  resolution: "typescript@npm:5.9.3"\n  languageName: node\n  linkType: hard\n',
      '"typescript@patch:typescript@npm%3A^5.9.3#optional!builtin<compat/typescript>":\n  version: 5.9.3\n  resolution: "typescript@patch:typescript@npm%3A5.9.3#optional!builtin<compat/typescript>::version=5.9.3&hash=5786d5"\n  languageName: node\n  linkType: hard\n',
    ].join('\n'),
  );
  mkdirSync(join(cwd, 'node_modules'));
  symlinkSync(compiler, join(cwd, 'node_modules', 'typescript'), 'dir');
  symlinkSync('..', join(cwd, 'node_modules', 'consumer'), 'dir');
  // No `include`: every file is in, and the ambient `shim.d.ts` sits at the root.
  write('tsconfig.json', '{\n  "compilerOptions": {\n    "noEmit": true\n  }\n}\n');
  write('shim.d.ts', 'declare module "untyped";\n');
  write('src/index.ts', 'export const answer = 42;\n');
  return cwd;
}

const sevenFetcher = (delayMs = 0): PackageFetcher => {
  const compiler = dirname(createRequire(import.meta.url).resolve('typescript/package.json'));
  return {
    resolve: async () => {
      await new Promise((r) => setTimeout(r, delayMs));
      return '7.0.2';
    },
    fetch: async () => ({ name: 'typescript', version: '7.0.2', dir: compiler }),
    versions: async () => ['5.9.3', '7.0.2'],
    manifests: async () => ({ '5.9.3': {}, '7.0.2': {} }),
  };
};

it('reports a tooling-only typescript on a self-linked yarn Berry repo, with the reason (UPT-84)', async () => {
  const result = await check({
    cwd: berrySelfLinked(),
    only: ['typescript'],
    packs: [typescriptPack],
    adapter: createTypescriptAdapter(),
    fetcher: sevenFetcher(),
    runtime: false,
  });
  expect(result.packages.map((p) => [p.name, p.installed, p.target, p.status])).toEqual([
    ['typescript', '5.9.3', '7.0.2', 'not-imported'],
  ]);
  expect(result.packages[0]?.notes).toContain(
    "no usages found in code; 5.9.3 → 7.0.2 is outside the typescript pack's range, so the 1 file it reads was not analyzed",
  );
}, 60_000);

// Guard: whatever stops the analysis, `check <pkg>` on an outdated installed package returns it.
it.each([
  [
    'the workspace analysis throws',
    {
      adapter: {
        ...createTypescriptAdapter(),
        importedPackages: () => {
          throw new Error('boom');
        },
      },
    },
  ],
  ['the time budget ran out first', { maxTimeMs: 1 }],
])(
  'check typescript still returns typescript when %s',
  async (_, extra) => {
    const result = await check({
      cwd: berrySelfLinked(),
      only: ['typescript'],
      packs: [typescriptPack],
      adapter: createTypescriptAdapter(),
      fetcher: sevenFetcher(5),
      runtime: false,
      ...extra,
    });
    expect(result.packages.map((p) => [p.name, p.status])).toEqual([['typescript', 'skipped']]);
    expect(result.packages[0]?.notes.length).toBeGreaterThan(0);
  },
  60_000,
);
