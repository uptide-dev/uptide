/**
 * What `uptide pack test --json` wrote, in the words `uptide pack test` prints, then how long
 * each ground-truth repository took (slowest first): CI keeps the JSON as an artifact and shows
 * this in the log and the job summary. Several files (one per matrix job) read as one run.
 * The log gets every site; `--summary` (CI: `$GITHUB_STEP_SUMMARY`) gets the cut that fits in a
 * job summary (`packTestSummary`).
 *
 *   tsx scripts/pack-test-report.ts [--summary <file>] pack-test.json [more.json …]
 */
import { appendFileSync, readFileSync } from 'node:fs';
import type { PackTestReport } from '@uptide/core';
import { formatPackTest, packTestSummary } from '../packages/cli/src/pack.ts';

const args = process.argv.slice(2);
const at = args.indexOf('--summary');
const summaryFile = at >= 0 ? args.splice(at, 2)[1] : undefined;
const files = args.length > 0 ? args : ['pack-test.json'];
const packs = files.flatMap(
  (file) => (JSON.parse(readFileSync(file, 'utf8')) as { packs: PackTestReport[] }).packs,
);

const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const rows = packs
  .flatMap((p) => p.repos.map((r) => ({ pack: p.dir, repo: r.label, t: r.timing })))
  .flatMap(({ t, ...r }) => (t ? [{ ...r, t, total: t.fetchMs + t.installMs + t.checkMs }] : []))
  .sort((a, b) => b.total - a.total);
const tail: string[] = [];
if (rows.length > 0) {
  tail.push('\n| pack | repository | fetch | install | check | total | peak RSS |');
  tail.push('|---|---|--:|--:|--:|--:|--:|');
  for (const r of rows)
    tail.push(
      `| ${r.pack} | ${r.repo} | ${s(r.t.fetchMs)} | ${s(r.t.installMs)} | ${s(r.t.checkMs)} | ${s(r.total)} | ${r.t.peakRssMb} MB |`,
    );
  tail.push(
    '\nPeak RSS: the pack test process once that repository is checked; installs run apart.',
  );
}
tail.push(packs.every((p) => p.passed) ? '\nEvery pack passed.' : '\nAt least one pack failed.');
const after = `${tail.join('\n')}\n`;

const out = packs.map((report) => formatPackTest(report)).join('\n');
process.stdout.write(`\`\`\`\n${out}\n\`\`\`\n${after}`);
if (summaryFile) appendFileSync(summaryFile, packTestSummary(packs, after));
