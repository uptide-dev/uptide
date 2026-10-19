#!/usr/bin/env node
// UpgradeBench v1 selection (bench/v1/repos.md): public commits that move a verified pack's
// package across the pack's major range, newest first, each checked against the rule.
// Reads GitHub through `gh` (commit search, commits, contents); writes nothing to any repository.
//
//   node bench/v1/find-candidates.mjs <excluded.txt> [--bots] >candidates.jsonl
//
// Without --bots: human commits and human pull requests. With --bots (the amended rule,
// bench/v1/repos.md): merged Renovate/Dependabot pull requests that a human fixed before merge.
//
// excluded.txt: one owner/name (or bare owner) per line, lower case.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Package, the pack's from and to majors (packages/core/src/packs/*/index.ts, sentry/pack.ts).
const PACKS = [
  { pack: 'zod', pkg: 'zod', from: [3], to: [4] },
  { pack: 'react', pkg: 'react', from: [18], to: [19] },
  { pack: 'next', pkg: 'next', from: [15], to: [16] },
  { pack: 'stripe', pkg: 'stripe', from: 'any>=14', to: 'any>=14' },
  { pack: 'express', pkg: 'express', from: [4], to: [5] },
  { pack: 'vitest', pkg: 'vitest', from: [4], to: [5] },
  { pack: 'typescript', pkg: 'typescript', from: [5], to: [6] },
  { pack: 'sentry', pkg: '@sentry/browser', from: [10], to: [11] },
  { pack: 'sentry', pkg: '@sentry/nextjs', from: [10], to: [11] },
  { pack: 'redis', pkg: 'redis', from: [4, 5], to: [5, 6] },
  { pack: 'ai', pkg: 'ai', from: [6], to: [7] },
  { pack: 'lucide-react', pkg: 'lucide-react', from: [0], to: [1] },
  { pack: 'joi', pkg: 'joi', from: [17], to: [18] },
  { pack: 'react-router', pkg: 'react-router', from: [6], to: [7] },
  { pack: 'react-router', pkg: 'react-router-dom', from: [6], to: [7] },
];
const SINCE = process.env.SINCE ?? '2026-04-01';
// ONLY=typescript,stripe limits a rerun to some packs.
const ONLY = process.env.ONLY?.split(',');
if (ONLY) PACKS.splice(0, PACKS.length, ...PACKS.filter((p) => ONLY.includes(p.pack)));
const excluded = new Set(
  readFileSync(process.argv[2], 'utf8')
    .split('\n')
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean),
);
const BOTS = process.argv.includes('--bots');
const SOURCE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/;
const BOT = /\[bot\]|dependabot|renovate|github-actions|greenkeeper|snyk-bot/i;

const gh = (path) =>
  JSON.parse(
    execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github+json', path], {
      encoding: 'utf8',
      maxBuffer: 64 << 20,
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  );
// Waits out an exhausted rate limit instead of reading the failure as a missing commit.
const waitForQuota = () => {
  const { core, search } = gh('rate_limit').resources;
  for (const r of [core, search])
    if (r.remaining === 0) sleep(Math.max(1, r.reset - Date.now() / 1000 + 5) * 1000);
};
const tryGh = (path) => {
  for (const wait of [0, 15000, 60000]) {
    if (wait) {
      sleep(wait);
      waitForQuota();
    }
    try {
      return gh(path);
    } catch {}
  }
  return null;
};
const sleep = (ms) => execFileSync('sleep', [String(ms / 1000)]);
const major = (spec) => {
  const m = /(\d+)\./.exec(spec) ?? /^\D*(\d+)\D*$/.exec(spec);
  return m ? Number(m[1]) : null;
};
const inRange = (n, r) => (r === 'any>=14' ? n >= 14 : r.includes(n));

/** Old and new major of `pkg` in one file's patch, from package.json or a pnpm catalog. */
function bump(patch, pkg) {
  const esc = pkg.replace(/[/@.-]/g, '\\$&');
  const re = new RegExp(`^([-+])\\s*["']?${esc}["']?\\s*:\\s*["']?([^"',\\s]+)`, 'gm');
  const side = { '-': [], '+': [] };
  for (const m of patch.matchAll(re)) side[m[1]].push(m[2]);
  const was = side['-'].map(major).filter((n) => n !== null);
  const is = side['+'].map(major).filter((n) => n !== null);
  if (!was.length || !is.length) return null;
  return {
    from: Math.max(...was),
    to: Math.max(...is),
    fromSpec: side['-'][0],
    toSpec: side['+'][0],
  };
}

const seen = new Set();
const out = [];
const now = new Date().toISOString();
for (const p of BOTS ? [] : PACKS) {
  const name = p.pkg.replace(/^@sentry\//, 'sentry ');
  const word = p.pkg.replace(/^@sentry\/.*/, 'sentry').toLowerCase();
  const majors = p.to === 'any>=14' ? [21, 22, 23] : p.to;
  const queries = [
    ...['upgrade', 'migrate', 'bump', 'update'].map((verb) => `${verb} ${name}`),
    ...majors.flatMap((m) => [`${name} ${m}`, `${name} v${m}`]),
  ];
  for (const q of queries) {
    for (const page of [1, 2]) {
      // Bounded on both sides: commits with a clock in the future otherwise fill the newest pages.
      const query = `${q} committer-date:${SINCE}..${now.slice(0, 10)}`;
      const res = tryGh(
        `search/commits?q=${encodeURIComponent(query)}&sort=committer-date&order=desc&per_page=100&page=${page}`,
      );
      sleep(2200);
      for (const item of res?.items ?? []) {
        const repo = item.repository.full_name;
        const key = `${repo}@${item.sha}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // A message that does not name the package is search noise, not an upgrade of it.
        if (!item.commit.message.toLowerCase().includes(word)) continue;
        // A committer date in the future is a misconfigured clock, not the most recent upgrade.
        if (item.commit.committer.date > now) continue;
        out.push({ p, repo, sha: item.sha, item });
      }
      if ((res?.items?.length ?? 0) < 100) break;
    }
  }
}
// Second source: merged pull requests whose title names the package; the commit is the one the
// merge put on the base branch (a squash, or the merge commit, whose first parent is the base).
for (const [p, author] of PACKS.flatMap((p) =>
  BOTS ? [[p, 'app/renovate'], [p, 'app/dependabot']] : [[p, null]],
)) {
  const name = p.pkg.replace(/^@sentry\//, 'sentry ');
  const word = p.pkg.replace(/^@sentry\/.*/, 'sentry').toLowerCase();
  for (const page of [1, 2, 3]) {
    const by = author ? ` author:${author}` : '';
    const query = `${name} in:title is:pr is:merged is:public merged:${SINCE}..${now.slice(0, 10)}${by}`;
    const res = tryGh(
      `search/issues?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=100&page=${page}`,
    );
    sleep(2200);
    for (const it of res?.items ?? []) {
      if (!it.title.toLowerCase().includes(word)) continue;
      if ((it.user?.type === 'Bot') !== BOTS) continue;
      const repo = it.repository_url.split('/repos/')[1];
      const merged = it.pull_request?.merged_at;
      if (!merged || merged > now) continue;
      const key = `${repo}#${it.number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        p,
        repo,
        sha: null,
        pr: it.number,
        bot: BOTS,
        item: {
          repository: { full_name: repo, fork: false },
          author: { login: it.user.login },
          commit: {
            author: { name: it.user.login },
            committer: { date: merged },
            message: `${it.title} (#${it.number})`,
          },
        },
      });
    }
    if ((res?.items?.length ?? 0) < 100) break;
  }
}
out.sort((a, b) => b.item.commit.committer.date.localeCompare(a.item.commit.committer.date));

// One repository per pack: once a pack has its newest match, its older candidates are not read.
const picked = new Set();
for (const cand of out) {
  const { p, repo, item, pr, bot } = cand;
  if (picked.has(p.pack)) continue;
  let sha = cand.sha;
  if (!sha) {
    sha = tryGh(`repos/${repo}/pulls/${pr}`)?.merge_commit_sha;
    // The same merge may also have come from commit search.
    if (!sha || seen.has(`${repo}@${sha}`)) continue;
    seen.add(`${repo}@${sha}`);
  }
  const row = {
    pack: p.pack,
    package: p.pkg,
    repo,
    upgrade: sha,
    date: item.commit.committer.date,
    author: item.author?.login ?? item.commit.author.name,
    title: item.commit.message.split('\n')[0].slice(0, 100),
  };
  const drop = (why) => console.log(JSON.stringify({ ...row, verdict: 'drop', why }));
  const lower = repo.toLowerCase();
  if (excluded.has(lower) || excluded.has(lower.split('/')[0])) {
    drop('excluded (ground truth, pilot, OSS sample or alanagoyal)');
    continue;
  }
  if (item.repository.fork) {
    drop('fork');
    continue;
  }
  if (!bot && (BOT.test(row.author) || BOT.test(item.commit.author.name ?? ''))) {
    drop('bot author');
    continue;
  }
  // A human's merge of a bot's branch is the bot's upgrade; only --bots can take it, and only
  // with a human fix commit.
  if (!bot && /from \S+\/(dependabot|renovate)\//i.test(item.commit.message)) {
    drop('merge of a bot pull request');
    continue;
  }
  if (bot) {
    // A human pushed at least one commit touching source files before the merge.
    const commits = tryGh(`repos/${repo}/pulls/${pr}/commits?per_page=100`) ?? [];
    const human = commits.filter(
      (c) => !BOT.test(c.author?.login ?? c.commit.author.name ?? '') && c.author?.type !== 'Bot',
    );
    const fixed = human.some((c) =>
      (tryGh(`repos/${repo}/commits/${c.sha}`)?.files ?? []).some(
        (f) =>
          SOURCE.test(f.filename) &&
          !/(^|\/)(package\.json|[^/]*lock[^/]*)$/.test(f.filename),
      ),
    );
    if (!fixed) {
      drop('bot pull request without a human source commit');
      continue;
    }
    row.humanCommits = human.length;
  }
  const commit = tryGh(`repos/${repo}/commits/${sha}`);
  if (!commit) {
    drop('commit unreadable');
    continue;
  }
  let b = null;
  let manifest = null;
  for (const f of commit.files ?? []) {
    if (!/(^|\/)(package\.json|pnpm-workspace\.yaml)$/.test(f.filename) || !f.patch) continue;
    const got = bump(f.patch, p.pkg);
    if (got && got.to > got.from) {
      b = got;
      manifest = f.filename;
      break;
    }
  }
  if (!b) {
    drop(`no ${p.pkg} major bump in a manifest`);
    continue;
  }
  if (!inRange(b.from, p.from) || !inRange(b.to, p.to)) {
    drop(`bump ${b.from}->${b.to} outside the pack's range`);
    continue;
  }
  const parent = commit.parents?.[0]?.sha;
  const meta = tryGh(`repos/${repo}`);
  if (!meta || meta.private) {
    drop('repository not public');
    continue;
  }
  if (meta.fork) {
    drop('fork');
    continue;
  }
  // NOASSERTION: a license file GitHub does not classify; repos.md records the one read.
  if (!meta.license?.spdx_id) {
    drop('no license');
    continue;
  }
  const cmp = tryGh(`repos/${repo}/compare/${sha}...${meta.default_branch}`);
  if (!cmp || !['ahead', 'identical'].includes(cmp.status)) {
    drop(`not on ${meta.default_branch}`);
    continue;
  }
  const root = tryGh(`repos/${repo}/contents/?ref=${parent}`) ?? [];
  const names = new Set(root.map((e) => e.name));
  const lock = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock', 'bun.lockb'].find(
    (n) => names.has(n),
  );
  if (!lock) {
    drop('no lockfile at the repository root');
    continue;
  }
  const dir = manifest.includes('/') ? manifest.slice(0, manifest.lastIndexOf('/')) : '';
  const tsconfig =
    names.has('tsconfig.json') ||
    (dir && tryGh(`repos/${repo}/contents/${dir}/tsconfig.json?ref=${parent}`));
  if (!tsconfig) {
    drop('no tsconfig.json (JavaScript: the tsc rule cannot hold)');
    continue;
  }
  const workflows = tryGh(`repos/${repo}/contents/.github/workflows?ref=${parent}`);
  if (!Array.isArray(workflows) || workflows.length === 0) {
    drop('no CI workflow');
    continue;
  }
  const scripts = (path) => {
    const f = tryGh(`repos/${repo}/contents/${path}?ref=${parent}`);
    if (!f?.content) return {};
    try {
      return JSON.parse(Buffer.from(f.content, 'base64').toString()).scripts ?? {};
    } catch {
      return {};
    }
  };
  const rootScripts = scripts('package.json');
  const pkgScripts = manifest.endsWith('package.json') ? scripts(manifest) : {};
  const test = rootScripts.test ?? pkgScripts.test;
  if (!test || /no test specified/.test(test)) {
    drop('no test script');
    continue;
  }
  picked.add(p.pack);
  console.log(
    JSON.stringify({
      ...row,
      verdict: 'match',
      parent,
      from: b.fromSpec,
      to: b.toSpec,
      manifest,
      lockfile: lock,
      test,
      stars: meta.stargazers_count,
      defaultBranch: meta.default_branch,
      license: meta.license?.spdx_id ?? null,
    }),
  );
}
