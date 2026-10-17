#!/usr/bin/env node
// Builds sample.json: public TypeScript repositories, pinned to a commit, stratified by package
// manager. Reads GitHub through `gh` (search and contents); writes nothing to any repository.
//
//   [UPTIDE_SAMPLE_EXCLUDE_OWNERS=a,b] node bench/oss-sample/build-sample.mjs [--per-manager 10] [--out bench/oss-sample/sample.json]
//
// Selection is deterministic for a given pool: candidates are ordered by sha256(salt + name),
// not by stars or recency, so the list is not tuned to repositories Uptide already handles.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SALT = 'upt-77';
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const perManager = Number(opt('per-manager', '10'));
const out = resolve(opt('out', 'bench/oss-sample/sample.json'));

// Owners to leave out (comma-separated GitHub logins), read at build time so no list lives in the tree.
// biome-ignore lint/suspicious/noUndeclaredEnvVars: a standalone script, not a turbo task
const excludeOwners = process.env.UPTIDE_SAMPLE_EXCLUDE_OWNERS ?? '';
const EXCLUDED_OWNERS = new Set(
  excludeOwners
    .split(',')
    .map((o) => o.trim().toLowerCase())
    .filter(Boolean),
);
const MAX_SIZE_KB = 150_000;
const LICENSES = ['mit', 'apache-2.0'];
const TOPICS = ['cli', 'api', 'library', 'sdk', 'framework', 'nodejs', 'react', 'nextjs', 'nestjs'];

const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const ghJson = (...a) => JSON.parse(gh(...a));
const rank = (name) => createHash('sha256').update(`${SALT}:${name}`).digest('hex');

const pool = new Map();
for (const license of LICENSES) {
  for (const topic of TOPICS) {
    let rows = [];
    try {
      rows = ghJson(
        'search',
        'repos',
        '--language=typescript',
        `--topic=${topic}`,
        '--stars=300..8000',
        '--archived=false',
        `--license=${license}`,
        '--updated=>2026-04-01',
        '--sort=stars',
        '--limit=40',
        '--json',
        'fullName,size,stargazersCount,license,defaultBranch,isFork,pushedAt',
      );
    } catch (e) {
      console.error(`search ${license}/${topic} failed: ${String(e.message).split('\n')[0]}`);
    }
    for (const r of rows) {
      if (r.isFork || r.size > MAX_SIZE_KB) continue;
      if (EXCLUDED_OWNERS.has(r.fullName.split('/')[0].toLowerCase())) continue;
      pool.set(r.fullName, r);
    }
  }
}
console.error(`pool: ${pool.size} candidates`);

function probe(r) {
  const [owner, name] = r.fullName.split('/');
  let names;
  try {
    names = ghJson('api', `repos/${owner}/${name}/contents/`).map((e) => e.name);
  } catch {
    return null;
  }
  if (!names.includes('package.json')) return null;
  if (names.some((n) => /^(bun\.lockb?|deno\.jsonc?)$/.test(n))) return null;
  const manager = names.includes('pnpm-lock.yaml')
    ? 'pnpm'
    : names.includes('yarn.lock')
      ? names.includes('.yarnrc.yml')
        ? 'yarn-berry'
        : 'yarn'
      : names.includes('package-lock.json')
        ? 'npm'
        : null;
  if (!manager) return null;
  const pkg = JSON.parse(
    Buffer.from(
      ghJson('api', `repos/${owner}/${name}/contents/package.json`).content,
      'base64',
    ).toString('utf8'),
  );
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const hasTs = names.some((n) => /^tsconfig.*\.json$/.test(n)) || 'typescript' in deps;
  if (!hasTs) return null;
  const monorepo = names.includes('pnpm-workspace.yaml') || Boolean(pkg.workspaces);
  const sha = gh('api', `repos/${owner}/${name}/commits/${r.defaultBranch}`, '--jq', '.sha').trim();
  return {
    id: r.fullName.replace('/', '__'),
    repo: r.fullName,
    commit: sha,
    license: r.license?.key ?? null,
    stars: r.stargazersCount,
    sizeKb: r.size,
    manager,
    monorepo,
  };
}

const ordered = [...pool.values()].sort((a, b) => rank(a.fullName).localeCompare(rank(b.fullName)));
const quota = { npm: perManager, pnpm: perManager, yarn: perManager };
const picked = [];
for (const r of ordered) {
  if (Object.values(quota).every((n) => n <= 0)) break;
  const row = probe(r);
  if (!row) continue;
  const bucket = row.manager.startsWith('yarn') ? 'yarn' : row.manager;
  if (quota[bucket] <= 0) continue;
  quota[bucket] -= 1;
  picked.push(row);
  console.error(`+ ${row.repo} (${row.manager}${row.monorepo ? ', monorepo' : ''})`);
}
picked.sort((a, b) => a.id.localeCompare(b.id));

const doc = {
  $comment:
    'UPT-77 sample: public TypeScript repositories with a root lockfile, ordered by sha256(salt:name) within each package-manager bucket. Pinned commits; nothing here is a fork, a repository by the maintainers, or in any pack ground truth. Regenerate with bench/oss-sample/build-sample.mjs.',
  selected: new Date().toISOString().slice(0, 10),
  salt: SALT,
  perManager,
  repos: picked,
};
writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
console.error(`wrote ${picked.length} repos to ${out}`);
