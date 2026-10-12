import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ONBOARDING_INPUTS, type RepoSnapshot } from './facts.js';

/** Lockfiles can be megabytes; the facts need only their head. */
const HEAD_BYTES = 64 * 1024;

function head(path: string): string {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(HEAD_BYTES, statSync(path).size));
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, read).toString('utf8');
  } catch {
    return '';
  } finally {
    closeSync(fd);
  }
}

/** The snapshot `repoFacts` reads, from a checkout on disk: what `uptide init` passes. */
export function snapshotFromDisk(
  root: string,
  repo: { slug?: string; defaultBranch: string },
): RepoSnapshot {
  const files: RepoSnapshot['files'] = {};
  for (const path of ONBOARDING_INPUTS) {
    const file = join(root, path);
    if (existsSync(file) && statSync(file).isFile())
      files[path] = path === 'bun.lockb' ? '' : head(file);
  }
  return { ...(repo.slug ? { slug: repo.slug } : {}), defaultBranch: repo.defaultBranch, files };
}
