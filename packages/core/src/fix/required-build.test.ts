import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import { zodPack } from '../packs/zod/index.js';
import { git } from './process.js';
import { publicationBlockers } from './publish.js';
import { prBody } from './report.js';
import { reverify } from './reverify.js';
import { fix } from './run.js';
import { zodFixture } from './test-fixture.js';

const scratch = mkdtempSync(join(tmpdir(), 'uptide-required-build-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const pack = { ...zodPack, requiresBuild: true };

it.each(['passed', 'failed', 'missing'] as const)(
  'requires the repo build after a packed migration: %s',
  async (status) => {
    const { root, services } = zodFixture(scratch);
    const build = vi.fn(async () => [
      { workspace: '.', status, output: status, command: 'next build' },
    ]);
    const result = await fix({ cwd: root, only: 'zod', pack, fixer: null }, { ...services, build });
    expect(build).toHaveBeenCalledWith(root, ['.'], undefined, undefined);
    expect(result.verification.passed).toBe(status === 'passed');
    expect(result.verification.build?.[0]?.status).toBe(status);
    expect(prBody(result)).toContain(
      status === 'passed' ? '✅ build' : status === 'failed' ? '❌ build' : 'no build script',
    );
    if (status !== 'passed')
      expect(publicationBlockers(result).join('; ')).toContain(
        status === 'failed' ? 'build failed' : 'build required',
      );
  },
);

it('runs the build script verify.build names, from the option or the repository’s uptide.yml', async () => {
  const named = zodFixture(scratch);
  const build = vi.fn(async () => [{ workspace: '.', status: 'passed' as const, output: '' }]);
  await fix(
    { cwd: named.root, only: 'zod', pack, fixer: null, buildScript: 'build:docker' },
    { ...named.services, build },
  );
  expect(build).toHaveBeenCalledWith(named.root, ['.'], undefined, 'build:docker');

  const configured = zodFixture(scratch);
  writeFileSync(join(configured.root, 'uptide.yml'), 'version: 1\nverify:\n  build: build-ci\n');
  git(configured.root, 'add', 'uptide.yml');
  git(configured.root, 'commit', '-m', 'uptide settings');
  const fromFile = vi.fn(async () => [{ workspace: '.', status: 'passed' as const, output: '' }]);
  await fix(
    { cwd: configured.root, only: 'zod', pack, fixer: null },
    { ...configured.services, build: fromFile },
  );
  expect(fromFile).toHaveBeenCalledWith(configured.root, ['.'], undefined, 'build-ci');
});

it('executes required builds in the test environment without inherited secrets', async () => {
  const { root, services } = zodFixture(scratch);
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  manifest.scripts = {
    build: `node -e "if (process.env.UPTIDE_TEST_SECRET || process.env.npm_config_ignore_scripts !== 'true') process.exit(1)"`,
  };
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
  git(root, 'add', 'package.json');
  git(root, 'commit', '-m', 'build fixture');
  vi.stubEnv('UPTIDE_TEST_SECRET', 'must-not-reach-build');
  try {
    const result = await fix({ cwd: root, only: 'zod', pack, fixer: null }, services);
    expect(result.verification.build?.[0]?.status).toBe('passed');
  } finally {
    vi.unstubAllEnvs();
  }
});

it('reruns the required build when re-verifying and cannot publish a stale pass', async () => {
  const { root, services } = zodFixture(scratch);
  const build = vi.fn(async () => [{ workspace: '.', status: 'passed' as const, output: '' }]);
  await fix({ cwd: root, only: 'zod', pack, fixer: null }, { ...services, build });
  const again = await reverify(
    { cwd: root, pack },
    {
      ...services,
      build: async () => [{ workspace: '.', status: 'missing', output: 'no build script' }],
    },
  );
  expect(again.verification.passed).toBe(false);
  expect(publicationBlockers(again).join('; ')).toContain('build required');
});

it('reports the repo build a pack does not require: a failure reads failed, not "not required" (UPT-110)', async () => {
  const { root, services } = zodFixture(scratch);
  const build = vi.fn(async () => [
    {
      workspace: '.',
      status: 'failed' as const,
      command: 'tsc -b',
      output: "> tsc -b\nsrc/db.ts(3,8): error TS2307: Cannot find module 'pg'.\nFound 1 error.",
    },
  ]);
  const result = await fix(
    { cwd: root, only: 'zod', pack: zodPack, fixer: null },
    { ...services, build },
  );
  expect(build).toHaveBeenCalledOnce();
  const body = prBody(result);
  expect(body).toContain(
    "❌ build: src/db.ts(3,8): error TS2307: Cannot find module 'pg'. (not required by the pack)",
  );
  expect(body).not.toContain('build not required');
  // The pack's gate is unchanged: a build it does not require is reported, not a blocker.
  expect(result.verification.passed).toBe(true);
  expect(publicationBlockers(result).filter((b) => b.startsWith('build'))).toEqual([]);
});
