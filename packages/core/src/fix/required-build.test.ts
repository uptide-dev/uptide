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
    expect(build).toHaveBeenCalledWith(root, ['.']);
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

it('leaves packs without requiresBuild unchanged', async () => {
  const { root, services } = zodFixture(scratch);
  const build = vi.fn(async () => []);
  const result = await fix(
    { cwd: root, only: 'zod', pack: zodPack, fixer: null },
    { ...services, build },
  );
  expect(build).not.toHaveBeenCalled();
  expect(result.verification.build).toBeUndefined();
});
