import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GroundTruthRepo } from '../contract.js';
import { cachedRepoDir, ensureRepo, generatorFailures, pinnedRepo } from './truth.js';

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
    mkdirSync(join(dir, 'app'), { recursive: true });
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

describe('generators (UPT-95)', () => {
  let cacheDir: string | undefined;
  afterEach(() => cacheDir && rmSync(cacheDir, { recursive: true, force: true }));

  it('runs them once on a cached install, and reports one that fails', async () => {
    const pinned = { repo: 'example/prisma', commit: 'b'.repeat(40) };
    cacheDir = mkdtempSync(join(tmpdir(), 'uptide-truth-'));
    const dir = cachedRepoDir(pinned, cacheDir);
    mkdirSync(join(dir, 'prisma'), { recursive: true });
    mkdirSync(join(dir, 'node_modules/.bin'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"app"}');
    writeFileSync(join(dir, 'prisma/schema.prisma'), 'generator client { provider = "x" }');
    // A stand-in binary: counts its runs, then fails the way a broken schema does.
    const bin = join(dir, 'node_modules/.bin/prisma');
    writeFileSync(bin, `#!/bin/sh\necho run >> "${dir}/runs"\necho "schema invalid" >&2\nexit 1\n`);
    chmodSync(bin, 0o755);
    // Installed before generators were part of the preparation: no fetch, no install.
    writeFileSync(
      join(dir, '.uptide-ground-truth.json'),
      JSON.stringify({ ...pinned, installed: ['.'] }),
    );

    await expect(ensureRepo(pinned, { cacheDir, offline: true })).resolves.toBe(dir);
    await ensureRepo(pinned, { cacheDir, offline: true });
    expect(readFileSync(join(dir, 'runs'), 'utf8')).toBe('run\n');
    expect(generatorFailures(pinned, cacheDir)).toEqual([
      'generator failed: prisma generate --schema prisma/schema.prisma (schema invalid)',
    ]);
  });
});
