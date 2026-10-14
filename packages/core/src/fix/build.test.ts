import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildFailureCause, buildWorkspaces, configuredBuildScript } from './build.js';

const scratch = mkdtempSync(join(tmpdir(), 'uptide-build-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function repo(manifests: Record<string, object>): string {
  const root = mkdtempSync(join(scratch, 'repo-'));
  for (const [dir, manifest] of Object.entries(manifests)) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, 'package.json'), JSON.stringify(manifest));
  }
  return root;
}

describe('buildWorkspaces', () => {
  it("runs each workspace's build script, the root's once for those without one", async () => {
    const root = repo({
      '.': { scripts: { build: 'echo root > root.txt' } },
      'apps/web': { scripts: { build: 'echo web' } },
      'packages/a': {},
      'packages/b': {},
    });
    const results = await buildWorkspaces(root, ['apps/web', 'packages/a', 'packages/b']);
    expect(
      results.map(({ workspace, status, command }) => ({ workspace, status, command })),
    ).toEqual([
      { workspace: 'apps/web', status: 'passed', command: 'echo web' },
      { workspace: '.', status: 'passed', command: 'echo root > root.txt' },
    ]);
  });

  it('says when there is no build script, and when the build fails', async () => {
    expect(await buildWorkspaces(repo({ '.': { scripts: { test: 'vitest' } } }), ['.'])).toEqual([
      { workspace: '.', status: 'missing', output: 'no build script' },
    ]);
    const [failed] = await buildWorkspaces(
      repo({ '.': { scripts: { build: 'echo "next lint was removed" && exit 1' } } }),
      ['.'],
    );
    expect(failed).toMatchObject({ status: 'failed', output: 'next lint was removed' });
  });
});

describe('which script a required build runs', () => {
  const scripts = {
    build: 'echo build',
    'build-ci': 'echo build-ci',
    'build:ci': 'echo build:ci',
    'build:docker': 'echo docker',
  };
  const ran = async (manifest: object, script?: string) =>
    (await buildWorkspaces(repo({ '.': manifest }), ['.'], undefined, script)).map((r) => r.script);

  it('prefers verify.build, then build:ci, build-ci and build', async () => {
    expect(await ran({ scripts }, 'build:docker')).toEqual(['build:docker']);
    expect(await ran({ scripts })).toEqual(['build:ci']);
    const { 'build:ci': _ci, ...noColon } = scripts;
    expect(await ran({ scripts: noColon })).toEqual(['build-ci']);
    expect(await ran({ scripts: { build: 'echo build' } })).toEqual(['build']);
  });

  it('reports a verify.build the repository does not have as missing, never another script', async () => {
    expect(
      await buildWorkspaces(repo({ '.': { scripts } }), ['.'], undefined, 'build:prod'),
    ).toEqual([
      {
        workspace: '.',
        status: 'missing',
        output: 'no "build:prod" script (verify.build in uptide.yml)',
      },
    ]);
  });

  it('reads verify.build from the uptide.yml at the root, and ignores an invalid one', () => {
    const root = repo({ '.': { scripts } });
    expect(configuredBuildScript(root)).toBeUndefined();
    writeFileSync(join(root, 'uptide.yml'), 'version: 1\nverify:\n  build: build-ci\n');
    expect(configuredBuildScript(root)).toBe('build-ci');
    writeFileSync(join(root, 'uptide.yml'), 'version: 1\nverify:\n  build: "rm -rf /"\n');
    expect(configuredBuildScript(root)).toBeUndefined();
  });
});

describe('why a build failed before the framework built', () => {
  // saas-starter-kit's build: `prisma generate && prisma db push && next build`, in a clone with
  // no DATABASE_URL.
  const prisma = [
    '✔ Generated Prisma Client (v6.10.0) to ./node_modules/@prisma/client in 114ms',
    'Prisma schema loaded from prisma/schema.prisma',
    'Error: Prisma schema validation - (get-config wasm)',
    'Error code: P1012',
    'error: Environment variable not found: DATABASE_URL.',
  ].join('\n');

  it('names the variable or the database it needed', async () => {
    expect(buildFailureCause(prisma)).toBe('needs DATABASE_URL');
    expect(buildFailureCause("Error: P1001: Can't reach database server at `localhost:5432`")).toBe(
      'needs a database',
    );
    expect(buildFailureCause('Error: STRIPE_SECRET_KEY is not set')).toBe(
      'needs STRIPE_SECRET_KEY',
    );
    const [failed] = await buildWorkspaces(
      repo({ '.': { scripts: { build: `printf '%s\\n' '${prisma}' >&2; exit 1` } } }),
      ['.'],
    );
    expect(failed).toMatchObject({
      status: 'failed',
      script: 'build',
      cause: 'needs DATABASE_URL',
    });
  });

  it('gives no cause once the framework build started, or when nothing says', () => {
    expect(
      buildFailureCause(
        `   ▲ Next.js 15.5.14\n   Creating an optimized production build ...\n${prisma}`,
      ),
    ).toBeUndefined();
    expect(buildFailureCause('Type error: Property x does not exist')).toBeUndefined();
  });
});
