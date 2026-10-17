import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { check } from '../check/check.js';
import { buildWorkspaces } from '../fix/build.js';
import { diagnostics } from '../fix/verify.js';
import { prepareWorkspace as prepare, unbuiltWorkspaces } from './prepare-workspace.js';

const prepareWorkspace = async (root: string, workspaces: string[], options = {}) =>
  (await prepare(root, workspaces, { build: buildWorkspaces, ...options })).builds;

const scratch = mkdtempSync(join(tmpdir(), 'uptide-prepare-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
function fixture() {
  const root = mkdtempSync(join(scratch, 'repo-'));
  cpSync(resolve(import.meta.dirname, '../../../../fixtures/workspaces/build-types'), root, {
    recursive: true,
  });
  mkdirSync(join(root, 'node_modules'));
  symlinkSync('../packages/internal', join(root, 'node_modules/internal'));
  return root;
}
function manifest(root: string, patch: object) {
  const file = join(root, 'packages/internal/package.json');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), ...patch }));
}
it('builds missing workspace declarations before measuring types, and skips existing output', async () => {
  const root = fixture();
  expect(diagnostics(root, ['packages/app']).some((d) => d.code === 2307)).toBe(true);
  expect(await prepareWorkspace(root, ['packages/app'])).toMatchObject([
    { status: 'passed', workspace: 'packages/internal' },
  ]);
  expect(diagnostics(root, ['packages/app'])).toEqual([]);
  expect(await prepareWorkspace(root, ['packages/app'])).toEqual([]);
});
it('honors verify.build and reports a missing configured script', async () => {
  const root = fixture();
  writeFileSync(join(root, 'uptide.yml'), 'version: 1\nverify:\n  build: build:custom\n');
  expect(await prepareWorkspace(root, ['packages/app'])).toMatchObject([
    { workspace: 'packages/internal', status: 'missing' },
  ]);
  manifest(root, { scripts: { 'build:custom': 'node build.cjs' } });
  expect(await prepareWorkspace(root, ['packages/app'])).toMatchObject([
    { script: 'build:custom' },
  ]);
});
it.each([
  ['missing', {}],
  ['failed', { build: 'exit 1' }],
  ['output still missing', { build: 'true' }],
])('reports %s builds instead of throwing', async (_reason, scripts) => {
  const root = fixture();
  manifest(root, { scripts });
  const results = await prepareWorkspace(root, ['packages/app']);
  expect(results.some((r) => r.workspace === 'packages/internal' && r.status !== 'passed')).toBe(
    true,
  );
  expect(unbuiltWorkspaces(root, ['packages/app'])).toEqual({
    'packages/app': [{ dir: 'packages/internal', name: 'internal' }],
  });
});
it('reports a runner that cannot run instead of throwing', async () => {
  const root = fixture();
  expect(
    (
      await prepare(root, ['packages/app'], {
        build: async () => {
          throw new Error('spawn ENOENT');
        },
      })
    ).builds,
  ).toMatchObject([{ status: 'failed', output: expect.stringMatching(/could not run.*ENOENT/) }]);
});
it('does not build an unrelated workspace', async () => {
  const root = fixture();
  writeFileSync(join(root, 'packages/app/package.json'), '{"name":"app"}');
  expect(await prepareWorkspace(root, ['packages/app'])).toEqual([]);
  expect(existsSync(join(root, 'packages/internal/dist'))).toBe(false);
});
it('finds nested exports without a top-level types field', async () => {
  const root = fixture();
  manifest(root, {
    types: undefined,
    exports: { '.': { import: { types: './dist/index.d.ts' } } },
  });
  expect(await prepareWorkspace(root, ['packages/app'])).toMatchObject([{ status: 'passed' }]);
});

it('check runs no scripts: consumers of missing output are not verified, never breaking', async () => {
  const root = fixture();
  const options = {
    cwd: root,
    only: [],
    runtime: false,
    plan: false,
    fetcher: {
      resolve: async () => {
        throw new Error('unexpected registry request');
      },
      fetch: async () => {
        throw new Error('unexpected registry request');
      },
    },
  };
  await check({ ...options, compile: false });
  await check(options);
  expect(existsSync(join(root, 'packages/internal/dist/index.d.ts'))).toBe(false);
  await prepareWorkspace(root, ['packages/app']);
  await check(options);
  expect(diagnostics(root, ['packages/app'])).toEqual([]);
  expect(unbuiltWorkspaces(root, ['packages/app'])).toEqual({});
});
it('supports wildcard exports and root build fallback', async () => {
  const root = fixture();
  manifest(root, { types: undefined, exports: { './*': { types: './dist/*.d.ts' } }, scripts: {} });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'root',
      workspaces: ['packages/*'],
      scripts: { 'build:ci': 'cd packages/internal && node build.cjs' },
    }),
  );
  expect(await prepareWorkspace(root, ['packages/app'])).toMatchObject([
    { workspace: '.', script: 'build:ci' },
  ]);
  expect(await prepareWorkspace(root, ['packages/app'])).toEqual([]);
});
it('builds transitive workspace dependencies first', async () => {
  const root = fixture();
  mkdirSync(join(root, 'packages/base'));
  writeFileSync(
    join(root, 'packages/base/package.json'),
    JSON.stringify({
      name: 'base',
      types: 'dist/index.d.ts',
      scripts: { build: 'node ../internal/build.cjs' },
    }),
  );
  manifest(root, {
    dependencies: { base: 'workspace:*' },
    scripts: { build: 'test -f ../base/dist/index.d.ts && node build.cjs' },
  });
  expect((await prepareWorkspace(root, ['packages/app'])).map((r) => r.workspace)).toEqual([
    'packages/base',
    'packages/internal',
  ]);
});

it.each([false, true])(
  'rebuilds existing declarations affected by a moved dependency (transitive: %s)',
  async (transitive) => {
    const root = fixture();
    const upstream = join(root, 'node_modules/moved');
    mkdirSync(upstream);
    writeFileSync(
      join(upstream, 'package.json'),
      JSON.stringify({ name: 'moved', types: 'index.d.ts' }),
    );
    writeFileSync(join(upstream, 'index.d.ts'), 'export interface Payload { value: number }');
    writeFileSync(
      join(root, 'packages/internal/index.ts'),
      "export type { Payload } from 'moved';",
    );
    writeFileSync(
      join(root, 'packages/app/index.ts'),
      "import type { Payload } from 'internal';\ndeclare const payload: Payload;\nexport const result: number = payload.value;\n",
    );
    manifest(root, {
      dependencies: { [transitive ? 'bridge' : 'moved']: '*' },
      scripts: { build: 'node reexport.cjs' },
    });
    if (transitive) {
      mkdirSync(join(root, 'packages/bridge'));
      writeFileSync(
        join(root, 'packages/bridge/package.json'),
        JSON.stringify({ name: 'bridge', dependencies: { moved: '*' } }),
      );
    }
    await prepareWorkspace(root, ['packages/app']);
    expect(diagnostics(root, ['packages/app'])).toEqual([]);
    writeFileSync(join(upstream, 'index.d.ts'), 'export interface Payload { value: string }');
    // The old bundled declaration masks the breaking type change until the workspace rebuilds.
    expect(diagnostics(root, ['packages/app'])).toEqual([]);
    expect(await prepareWorkspace(root, ['packages/app'])).toEqual([]);
    expect(await prepareWorkspace(root, ['packages/app'], { moved: ['unrelated'] })).toEqual([]);
    expect(await prepareWorkspace(root, ['packages/internal'], { moved: ['moved'] })).toMatchObject(
      [{ workspace: 'packages/internal', status: 'passed' }],
    );
    expect(diagnostics(root, ['packages/app']).map((d) => d.code)).toContain(2322);
  },
);

it('does not rebuild packages that expose TypeScript source directly', async () => {
  const root = fixture();
  writeFileSync(join(root, 'packages/internal/index.ts'), 'export const value = 1;');
  manifest(root, {
    types: './index.ts',
    exports: './index.ts',
    dependencies: { moved: '*' },
    scripts: {},
  });
  expect(await prepareWorkspace(root, ['packages/app'], { moved: ['moved'] })).toEqual([]);
});
