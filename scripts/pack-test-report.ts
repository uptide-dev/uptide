/**
 * What `uptide pack test --json` wrote, in the words `uptide pack test` prints, then how long
 * each ground-truth repository took (slowest first): CI keeps the JSON as an artifact and shows
 * this in the log and the job summary. Several files (one per matrix job) read as one run.
 *
 *   tsx scripts/pack-test-report.ts pack-test.json [more.json …]
 */
import { readFileSync } from 'node:fs';
import type { PackTestReport } from '@uptide/core';
import { formatPackTest } from '../packages/cli/src/pack.ts';

const files = process.argv.length > 2 ? process.argv.slice(2) : ['pack-test.json'];
const packs = files.flatMap(
  (file) => (JSON.parse(readFileSync(file, 'utf8')) as { packs: PackTestReport[] }).packs,
);
const out = packs.map((report) => formatPackTest(report)).join('\n');
console.log(`\`\`\`\n${out}\n\`\`\``);

const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const rows = packs
  .flatMap((p) => p.repos.map((r) => ({ pack: p.dir, repo: r.label, t: r.timing })))
  .flatMap(({ t, ...r }) => (t ? [{ ...r, t, total: t.fetchMs + t.installMs + t.checkMs }] : []))
  .sort((a, b) => b.total - a.total);
if (rows.length > 0) {
  console.log('\n| pack | repository | fetch | install | check | total | peak RSS |');
  console.log('|---|---|--:|--:|--:|--:|--:|');
  for (const r of rows)
    console.log(
      `| ${r.pack} | ${r.repo} | ${s(r.t.fetchMs)} | ${s(r.t.installMs)} | ${s(r.t.checkMs)} | ${s(r.total)} | ${r.t.peakRssMb} MB |`,
    );
  console.log(
    '\nPeak RSS: the pack test process once that repository is checked; installs run apart.',
  );
}
console.log(packs.every((p) => p.passed) ? '\nEvery pack passed.' : '\nAt least one pack failed.');
