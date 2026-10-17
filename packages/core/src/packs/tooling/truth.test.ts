import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GroundTruthRepo } from '../contract.js';
import { cachedRepoDir, ensureRepo, pinnedRepo } from './truth.js';

// Synthetic: a project in `app/` of a monorepo, the shape that made packs:fetch install at
// the root (UPT-61).
const entry: GroundTruthRepo = {
  repo: 'example/monorepo',
  commit: 'a'.repeat(40),
  directory: 'app',
  from: '1.0.0',
  to: '2.0.0',
  why: 'synthetic',
  findings: [],
};

describe('pinnedRepo', () => {
  let cacheDir: string | undefined;
  afterEach(() => cacheDir && rmSync(cacheDir, { recursive: true, force: true }));

  it('keeps directory, so ensureRepo installs the project and not the repository root', async () => {
    const pinned = pinnedRepo(entry);
    expect(pinned).toEqual({ repo: entry.repo, commit: entry.commit, directory: 'app' });

    cacheDir = mkdtempSync(join(tmpdir(), 'uptide-truth-'));
    const dir = cachedRepoDir(pinned, cacheDir);
    mkdirSync(dir, { recursive: true });
    const marker = (installed: string[]) =>
      writeFileSync(
        join(dir, '.uptide-ground-truth.json'),
        JSON.stringify({ repo: entry.repo, commit: entry.commit, installed }),
      );

    // Only the root installed: the entry is not ready, offline refuses instead of skipping it.
    marker(['.']);
    await expect(ensureRepo(pinned, { cacheDir, offline: true })).rejects.toThrow(
      /not in the ground-truth cache/,
    );
    marker(['app']);
    await expect(ensureRepo(pinned, { cacheDir, offline: true })).resolves.toBe(dir);
  });

  it('leaves directory out for a root project', () => {
    expect(pinnedRepo({ ...entry, directory: undefined })).toEqual({
      repo: entry.repo,
      commit: entry.commit,
    });
  });
});
