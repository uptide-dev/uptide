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
import { diagnostics } from '../fix/verify.js';
import { prepareWorkspace } from './prepare-workspace.js';

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
  await expect(prepareWorkspace(root, ['packages/app'])).rejects.toThrow(
    /build.*needed.*internal.*build:custom/i,
  );
  manifest(root, { scripts: { 'build:custom': 'node build.cjs' } });
  expect(await prepareWorkspace(root, ['packages/app'])).toMatchObject([
    { script: 'build:custom' },
  ]);
});
it.each([
  ['missing', {}],
  ['failed', { build: 'exit 1' }],
  ['output still missing', { build: 'true' }],
])('reports %s builds instead of accepting an invalid baseline', async (_reason, scripts) => {
  const root = fixture();
  manifest(root, { scripts });
  await expect(prepareWorkspace(root, ['packages/app'])).rejects.toThrow(
    /workspace build needed.*internal/i,
  );
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

it('check prepares the baseline before adapter analysis, unless compile is disabled', async () => {
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
  expect(existsSync(join(root, 'packages/internal/dist/index.d.ts'))).toBe(false);
  await check(options);
  expect(diagnostics(root, ['packages/app'])).toEqual([]);
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
