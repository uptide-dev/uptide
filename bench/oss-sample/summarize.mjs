#!/usr/bin/env node
// Turns a run directory into the summary tables: outcome counts, one row per repository, and the
// non-successes grouped by fingerprint (equal fingerprint = candidate single root cause).
// Steps are re-classified from the saved exit code and logs, so a classifier change does not
// need a re-run.
//
//   node bench/oss-sample/summarize.mjs <out-dir> > summary-tables.md
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { classify } from './classify.mjs';

const out = resolve(process.argv[2] ?? 'bench/oss-sample/out');
const results = JSON.parse(readFileSync(join(out, 'results.json'), 'utf8'));
const read = (id, name) => {
  const f = join(out, 'runs', id, name);
  return existsSync(f) ? readFileSync(f, 'utf8') : '';
};
const parse = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

const rows = results.map((r) => {
  const step = (name) => {
    const s = r[name];
    if (!s) return null;
    const stdout = read(r.id, `${name}.out`);
    return {
      ...s,
      ...classify({
        step: name,
        exit: s.exit,
        signal: s.signal,
        timedOut: s.timedOut,
        stdout,
        stderr: read(r.id, `${name}.err`),
        json: parse(stdout),
      }),
    };
  };
  return { ...r, check: step('check'), fix: step('fix') };
});

const ran = rows.filter((r) => r.check || r.fix);
const setupFailed = rows.filter((r) => r.setup?.failed);
const noTarget = rows.filter((r) => r.target === null);
const lines = [];
const p = (s = '') => lines.push(s);

p(
  `${rows.length} repositories: ${ran.length} ran, ${setupFailed.length} setup failed, ${noTarget.length} without an upgrade target.`,
);
p();
for (const stepName of ['check', 'fix']) {
  const counts = {};
  for (const r of ran) {
    const k = r[stepName]?.kind;
    if (k) counts[k] = (counts[k] ?? 0) + 1;
  }
  const text = Object.entries(counts)
    .map(([k, n]) => `${k} ${n}`)
    .join(', ');
  p(`${stepName}: ${text}`);
}
p();
p('| repo | manager | target | check | fix |');
p('| --- | --- | --- | --- | --- |');
for (const r of rows) {
  const t = r.target
    ? `${r.target.name} ${r.target.current}→${r.target.latest} (${r.target.kind ?? '?'}, tier ${r.target.tier})`
    : '-';
  const cell = (s) =>
    s ? `${s.kind} (exit ${s.exit ?? s.signal ?? 'timeout'}, ${Math.round(s.ms / 1000)}s)` : '-';
  const tag = r.setup?.failed ? `setup failed: ${r.setup.failed}` : null;
  p(
    `| ${r.repo}${r.monorepo ? ' (mono)' : ''} | ${r.manager} | ${t} | ${tag ?? cell(r.check)} | ${tag ?? cell(r.fix)} |`,
  );
}
p();

const groups = new Map();
const add = (key, kind, fingerprint, repo) => {
  const g = groups.get(key) ?? { kind, fingerprint, repos: [] };
  g.repos.push(repo);
  groups.set(key, g);
};
for (const r of rows) {
  for (const s of [r.check, r.fix]) {
    if (!s || s.kind === 'success') continue;
    add(`${s.kind} | ${s.fingerprint}`, s.kind, s.fingerprint, r.repo);
    if (s.exit === 2 && s.ms > 10_000) {
      add(
        'slow-refusal',
        'other',
        `slow refusal: exit 2 after more than 10 s (${s.fingerprint})`,
        r.repo,
      );
    }
  }
  if (r.integrity && !r.integrity.checkoutUntouched) {
    add(
      'integrity',
      'other',
      `checkout changed by check/fix: ${r.integrity.changed?.join('; ')}`,
      r.repo,
    );
  }
  if (r.integrity?.tempEntriesLeft) {
    add(
      'temp',
      'other',
      `run directories left in UPTIDE_RUNS_DIR after fix: ${r.integrity.tempEntries.join(', ')}`,
      r.repo,
    );
  }
  if (r.setup?.failed) {
    add(
      `setup | ${r.setup.failed}`,
      'setup',
      `${r.setup.failed}: ${r.setup.detail ?? ''}`.slice(0, 160),
      r.repo,
    );
  }
}
p('## Groups');
p();
p('| repos | class | fingerprint | which |');
p('| ---: | --- | --- | --- |');
for (const g of [...groups.values()].sort((a, b) => b.repos.length - a.repos.length)) {
  p(
    `| ${g.repos.length} | ${g.kind} | ${g.fingerprint.replace(/\|/g, '\\|')} | ${g.repos.join(', ')} |`,
  );
}
console.log(lines.join('\n'));
