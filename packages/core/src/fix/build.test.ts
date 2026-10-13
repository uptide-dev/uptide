import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildWorkspaces } from './build.js';

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
