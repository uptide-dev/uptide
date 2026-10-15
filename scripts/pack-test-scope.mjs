// Which packs a pull request needs `uptide pack test` for. When every changed file is inside a
// registered pack's directory, or is one of the files that list packs (registry, README,
// docs/packs.md, packs/queue.json, changesets), only those packs run.
// Anything else (the engine, tooling, a shared directory like packs/sentry/) runs every pack.
//
//   git diff --name-only --no-renames <base> HEAD | node scripts/pack-test-scope.mjs
//
// Prints `packs=<JSON array>` for $GITHUB_OUTPUT: the changed packs, or every registered pack.
// Each becomes one job of the workflow's matrix.
import { readFileSync } from 'node:fs';
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const files = readFileSync(0, 'utf8').split('\n').filter(Boolean);
  const registered = registeredDirs(root);
  console.log(`packs=${JSON.stringify(packScope(files, registered) ?? registered)}`);
}
