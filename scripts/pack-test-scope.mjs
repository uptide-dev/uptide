// Which packs a pull request needs `uptide pack test` for. When every changed file is inside a
// registered pack's directory, or is one of the files that list packs (registry, README,
// docs/packs.md, packs/queue.json, changesets), only those packs run, with a cache of only their repositories.
// Anything else (the engine, tooling, a shared directory like packs/sentry/) runs every pack.
//
//   git diff --name-only --no-renames <base> HEAD | node scripts/pack-test-scope.mjs
//
// Prints `ids=<dir …>` (empty: run every pack), the cache `key` and the `restore` prefix that
// finds an older cache of the same packs, for $GITHUB_OUTPUT.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKS = 'packages/core/src/packs/';
const LISTS = new Set([`${PACKS}registry.ts`, 'README.md', 'docs/packs.md', 'packs/queue.json']);

/** The pack directories `files` stay inside, or `null` when every pack has to run. */
export function packScope(files, registered) {
  const ids = new Set();
  for (const file of files) {
    if (LISTS.has(file) || /^\.changeset\/[^/]+$/.test(file)) continue;
    const dir = file.startsWith(PACKS) ? file.slice(PACKS.length).split('/') : [];
    if (dir.length < 2 || !registered.includes(dir[0])) return null;
    ids.add(dir[0]);
  }
  return ids.size > 0 ? [...ids].sort() : null;
}

/** Pack directories registry.ts lists. */
export function registeredDirs(root) {
  const source = readFileSync(join(root, PACKS, 'registry.ts'), 'utf8');
  return [...source.matchAll(/\bdir: '([^']+)'/g)].map((m) => m[1]);
}

/** Changes with the ground truth of those packs: a new repository is fetched once. */
export function cacheKey(root, ids) {
  const hash = createHash('sha256');
  for (const id of ids) {
    const truth = join(root, PACKS, id, 'ground-truth.json');
    hash.update(`${id}\0${existsSync(truth) ? readFileSync(truth) : ''}\0`);
  }
  return `${restorePrefix(ids)}${hash.digest('hex').slice(0, 16)}`;
}

export function restorePrefix(ids) {
  return `pack-${ids.join('+')}-`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const files = readFileSync(0, 'utf8').split('\n').filter(Boolean);
  const ids = packScope(files, registeredDirs(root));
  console.log(`ids=${ids ? ids.join(' ') : ''}`);
  console.log(`key=${ids ? cacheKey(root, ids) : ''}`);
  console.log(`restore=${ids ? restorePrefix(ids) : ''}`);
}
