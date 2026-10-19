// Scores every run in $BENCH_OUT/runs the same way, blind to arm: it never reads key.tsv.
// The reference of a repository is the run whose head is the human's upgrade commit.
//
//   BENCH_OUT=<dir> node bench/score.mjs             writes $BENCH_OUT/scores.json
//   BENCH_OUT=<dir> node bench/score.mjs --unblind   then prints the table with arms joined in
//
// Measures, on code files only (lockfiles, package.json and docs left out):
// - coverage: human hunks (git diff -U0 parent..upgrade) whose old lines the run also changed;
//   a pure insertion counts as the two lines around it. Missed hunks are the candidates for
//   escaped regressions, read by hand.
// - unrelated: run hunks in files the human left alone that never name the package.
// - regressions: local checks and CI checks that fail on the run and pass on the reference.
// - unverified: whether the run's summary or PR body says what it did not verify.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CODE = /\.(c|m)?(t|j)sx?$/;
const UNVERIFIED =
  /not (been )?(verified|tested|checked|run)|did(n't| not) (run|verify|test|check)|could(n't| not) (run|verify|test)|unable to|untested|unverified|manual(ly)? (review|check|test)|needs? (manual|human)|not covered|wasn't able/i;

const read = (file, fallback) =>
  existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
const git = (repo, ...args) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });

/** Hunks of `git diff -U0 a b` on code files: file, old start, old count. */
export function hunks(diff) {
  const found = [];
  let file;
  for (const line of diff.split('\n')) {
    const header = /^diff --git a\/(.+) b\//.exec(line);
    if (header) file = CODE.test(header[1]) ? header[1] : undefined;
    const hunk = /^@@ -(\d+)(?:,(\d+))? /.exec(line);
    if (hunk && file)
      found.push({
        file,
        start: Number(hunk[1]),
        count: hunk[2] === undefined ? 1 : Number(hunk[2]),
      });
  }
  return found;
}
/** Old-side lines a hunk touches; an insertion after line n touches n and n + 1. */
export const lines = (h) =>
  h.count === 0 ? [h.start, h.start + 1] : Array.from({ length: h.count }, (_, i) => h.start + i);

export function compare(human, agent) {
  const touched = new Set(agent.flatMap((h) => lines(h).map((l) => `${h.file}:${l}`)));
  const missed = human.filter((h) => !lines(h).some((l) => touched.has(`${h.file}:${l}`)));
  return { covered: human.length - missed.length, missed };
}

function score(out, selection, run) {
  const dir = join(out, 'runs', run);
  const meta = read(join(dir, 'meta.json'));
  const entry = selection.repos.find((r) => r.id === meta.id);
  const repo = join(dir, 'repo');
  const human = hunks(git(repo, 'diff', '-U0', '--no-renames', entry.parent, entry.upgrade));
  const agent = hunks(git(repo, 'diff', '-U0', '--no-renames', entry.parent, meta.head));
  const { covered, missed } = compare(human, agent);
  const humanFiles = new Set(human.map((h) => h.file));
  const names = new RegExp(`['"]${entry.package.replace(/[/.]/g, '\\$&')}(/[^'"]*)?['"]`);
  const unrelated = agent.filter((h) => {
    if (humanFiles.has(h.file)) return false;
    try {
      return !names.test(git(repo, 'show', `${entry.parent}:${h.file}`));
    } catch {
      return false; // a file the run created
    }
  });
  const summaryFile = join(dir, 'summary.md');
  const summary = existsSync(summaryFile) ? readFileSync(summaryFile, 'utf8') : '';
  return {
    run,
    id: meta.id,
    head: meta.head,
    reference: meta.head === entry.upgrade,
    exit: meta.exit,
    costUsd: meta.costUsd,
    wallSeconds: meta.wallSeconds,
    uncommittedFiles: meta.uncommittedFiles,
    humanHunks: human.length,
    covered,
    missed: missed.map((h) => `${h.file}:${h.start}`),
    agentHunks: agent.length,
    agentFiles: new Set(agent.map((h) => h.file)).size,
    unrelated: unrelated.map((h) => `${h.file}:${h.start}`),
    unverified: UNVERIFIED.exec(summary)?.[0] ?? null,
    checks: read(join(dir, 'checks.json'), {}),
    ci: read(join(dir, 'ci.json'), []).map((c) => ({
      name: `${c.workflow}/${c.name}`,
      bucket: c.bucket,
    })),
  };
}

export function regressions(row, reference) {
  if (!reference || row.reference) return [];
  const local = Object.entries(row.checks)
    .filter(([step, code]) => code !== 0 && reference.checks[step] === 0)
    .map(([step]) => `local ${step}`);
  const passed = new Set(reference.ci.filter((c) => c.bucket === 'pass').map((c) => c.name));
  const ci = row.ci
    .filter((c) => c.bucket === 'fail' && passed.has(c.name))
    .map((c) => `ci ${c.name}`);
  return [...local, ...ci];
}

function table(rows, arms) {
  const ci = (r) => {
    const n = (b) => r.ci.filter((c) => c.bucket === b).length;
    return r.ci.length ? `${n('pass')} pass, ${n('fail')} fail` : 'none';
  };
  const checks = (r) =>
    Object.entries(r.checks)
      .map(([s, c]) => `${s} ${c === 0 ? 'ok' : 'FAIL'}`)
      .join(', ') || 'not run';
  const lines = [
    '| repo | arm | exit | coverage | missed | unrelated | regressions vs human | states unverified | local checks | fork CI | cost | wall |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  const sorted = [...rows].sort(
    (a, b) => a.id.localeCompare(b.id) || arms[a.run].localeCompare(arms[b.run]),
  );
  for (const r of sorted)
    lines.push(
      `| ${r.id} | ${arms[r.run]} | ${r.exit} | ${r.covered}/${r.humanHunks} | ${r.missed.length} | ${r.unrelated.length} | ${r.regressions.join(', ') || 'none'} | ${r.unverified ? 'yes' : 'no'} | ${checks(r)} | ${ci(r)} | $${Number(r.costUsd).toFixed(2)} | ${Math.round(r.wallSeconds / 60)} min |`,
    );
  return lines.join('\n');
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const out = process.env.BENCH_OUT;
  if (!out) throw new Error('set BENCH_OUT');
  const selection = JSON.parse(
    readFileSync(process.env.BENCH_SELECTION ?? new URL('./selection.json', import.meta.url), 'utf8'),
  );
  const rows = readdirSync(join(out, 'runs')).map((run) => score(out, selection, run));
  for (const row of rows)
    row.regressions = regressions(
      row,
      rows.find((r) => r.reference && r.id === row.id),
    );
  writeFileSync(join(out, 'scores.json'), `${JSON.stringify(rows, null, 2)}\n`);
  if (process.argv.includes('--unblind')) {
    const key = readFileSync(join(out, 'key.tsv'), 'utf8').trim().split('\n');
    console.log(
      table(rows, Object.fromEntries(key.map((l) => [l.split('\t')[0], l.split('\t')[2]]))),
    );
  }
}
