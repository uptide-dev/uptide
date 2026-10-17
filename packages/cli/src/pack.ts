import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  type PackTestReport,
  type RegisteredPack,
  RULE_PRECISION_MIN_SITES,
  RULE_PRECISION_WARNING,
  rateLabel,
  rulePrecision,
  type Tally,
} from '@uptide/core';
import pc from 'picocolors';
import { CliError } from './errors.js';

/** The uptide checkout `cwd` is in: packs are contributor work, done in the source tree. */
export function packRoot(cwd: string): string {
  let dir = cwd;
  for (;;) {
    if (existsSync(join(dir, 'packages', 'core', 'src', 'packs', 'registry.ts'))) return dir;
    const parent = dirname(dir);
    if (parent === dir)
      throw new CliError('uptide pack works inside an uptide checkout', {
        why: 'packs live in packages/core/src/packs of https://github.com/uptide-dev/uptide',
        next: 'git clone https://github.com/uptide-dev/uptide && cd uptide && pnpm install',
      });
    dir = parent;
  }
}

/**
 * The packs to test: what this build carries, checked against the checkout's registry. A pack
 * added or edited since the build would be tested as it was, so a missing one is an error.
 */
export function packsToTest(
  root: string,
  registered: readonly RegisteredPack[],
  names: readonly string[],
): RegisteredPack[] {
  const onDisk = [
    ...readFileSync(join(root, 'packages', 'core', 'src', 'packs', 'registry.ts'), 'utf8').matchAll(
      /\{ dir: '([^']+)'/g,
    ),
  ].map((m) => m[1] as string);
  const missing = onDisk.filter((dir) => !registered.some((e) => e.dir === dir));
  if (missing.length > 0)
    throw new CliError(`this build of uptide does not include the pack in ${missing.join(', ')}`, {
      why: 'pack test runs the packs compiled into the CLI; `pnpm uptide` runs them from source',
      next: `pnpm uptide pack test${names.map((n) => ` ${n}`).join('')}`,
    });
  if (names.length === 0) return [...registered];
  return names.map((name) => {
    const entry = registered.find((e) => e.pack.name === name || e.dir === name);
    if (!entry)
      throw new CliError(`no pack for ${name}`, {
        next: `uptide pack new ${name} --from <range> --to <range>`,
      });
    return entry;
  });
}

function row(name: string, t: Tally): string {
  return `  ${name.padEnd(28)} ${rateLabel(t, 'precision').padStart(9)} ${rateLabel(t, 'recall').padStart(7)} ${String(t.truePositives).padStart(5)} ${String(t.falsePositives).padStart(4)} ${String(t.falseNegatives).padStart(4)}`;
}

/**
 * What `uptide pack test` prints for one pack. `limit` keeps the first sites of each
 * false-positive, false-negative and wrong-rule list (the job summary's version).
 */
export function formatPackTest(report: PackTestReport, color = false, limit = Infinity): string {
  const c = pc.createColors(color);
  const out: string[] = [];
  const recorded = report.recorded === report.status ? '' : `, recorded ${report.recorded}`;
  out.push(c.bold(`uptide pack test ${report.package} · ${report.status}${recorded}`));
  for (const problem of report.problems) out.push(`  ${c.red('✗')} ${problem}`);

  const f = report.fixtures;
  const fixtureSites = Object.values(f.rules).reduce(
    (n, t) => n + t.truePositives + t.falseNegatives,
    0,
  );
  const fixturesOk =
    f.rewriteFailures.length + f.falsePositives.length + f.falseNegatives.length === 0 &&
    f.unknown.length === 0;
  out.push(
    `fixtures      ${f.cases.length} case${f.cases.length === 1 ? '' : 's'}, ${fixtureSites} site${fixtureSites === 1 ? '' : 's'} · ${fixturesOk ? c.green('pass') : c.red('fail')}`,
  );
  for (const u of f.unknown)
    out.push(`  ${c.red('✗')} ${u.file}:${u.line} names no rule: ${u.rule}`);
  for (const r of f.rewriteFailures)
    out.push(`  ${c.red('✗')} ${r.file}${r.line ? `:${r.line}` : ''} ${r.message}`);
  for (const s of f.falsePositives)
    out.push(`  ${c.red('✗')} ${s.file}:${s.line} ${s.rule} detected, not marked`);
  for (const s of f.falseNegatives)
    out.push(`  ${c.red('✗')} ${s.file}:${s.line} ${s.rule} marked, not detected`);

  if (report.fixturesOnly) out.push('ground truth  skipped (--fixtures-only)');
  else if (report.repos.length === 0)
    out.push('ground truth  no repository yet: the pack ships as a candidate');
  else {
    out.push('ground truth');
    for (const r of report.repos) {
      const head = `  ${r.label.padEnd(44)} ${report.package} ${r.from} → ${r.to}`;
      if (r.error) {
        out.push(`${head}  ${c.red(`error: ${r.error}`)}`);
        continue;
      }
      out.push(
        `${head}  predicted ${r.predicted.length}, expected ${r.expected.length}, false positives ${r.falsePositives.length}, false negatives ${r.falseNegatives.length}`,
      );
      if (r.installedMismatch) out.push(`    ${c.yellow('!')} ${r.installedMismatch}`);
      if (r.companions?.length)
        out.push(
          `    with ${r.companions.map((m) => `${m.name} ${m.from} → ${m.to}${m.required ? ` (moved because ${m.reason})` : ''}`).join(', ')}`,
        );
      for (const stay of r.stays ?? []) out.push(`    ${c.dim(`· ${stay}`)}`);
      for (const blocker of r.blockers ?? []) out.push(`    ${c.red('✗')} blocked: ${blocker}`);
      for (const removal of r.removals ?? [])
        out.push(`    ${c.cyan('−')} removed: ${removal.name} ${removal.from}, ${removal.reason}`);
      for (const left of r.leftBehind ?? []) out.push(`    ${c.red('✗')} ${left}`);
      for (const left of [...(r.explained ?? []), ...(r.repoChoice ?? [])])
        out.push(`    ${c.dim(`· ${left}`)}`);
    }
    out.push('');
    out.push(
      `  ${'rule'.padEnd(28)} ${'precision'.padStart(9)} ${'recall'.padStart(7)} ${'tp'.padStart(5)} ${'fp'.padStart(4)} ${'fn'.padStart(4)}`,
    );
    for (const [rule, t] of Object.entries(report.rules).sort(([a], [b]) => a.localeCompare(b)))
      out.push(row(rule, t));
    out.push(row('overall (sites)', report.overall));
    // Absent from a report written before behavior notes were scored on their own.
    if (report.behavior) out.push(row('behavior notes (sites)', report.behavior));
    out.push(c.bold(row('breaking (sites)', report.breaking)));
    const listed = (
      title: string,
      sites: { label: string; file: string; line: number; text: string }[],
    ) => {
      if (sites.length === 0) return;
      out.push('');
      out.push(`${title} (${sites.length})`);
      for (const s of sites.slice(0, limit))
        out.push(`  ${s.label}  ${s.file}:${s.line}  ${s.text}`);
      if (sites.length > limit) out.push(`  … and ${sites.length - limit} more, see the job log`);
    };
    listed(
      'false positives',
      report.repos.flatMap((r) =>
        r.falsePositives.map((s) => ({
          label: r.label,
          file: s.file,
          line: s.line,
          text: `${s.rule} (${s.severity ?? 'breaking'})`,
        })),
      ),
    );
    listed(
      'false negatives',
      report.repos.flatMap((r) =>
        r.falseNegatives.map((s) => ({
          label: r.label,
          file: s.file,
          line: s.line,
          text: s.severity ? `${s.rule} (${s.severity})` : s.rule,
        })),
      ),
    );
    listed(
      'reported under another rule',
      report.repos.flatMap((r) =>
        r.wrongRule.map((s) => ({
          label: r.label,
          file: s.file,
          line: s.line,
          text: `${s.rule}, expected ${s.expected}`,
        })),
      ),
    );
  }
  out.push('');
  if (!report.fixturesOnly && report.repos.length > 0) {
    const g = report.gate;
    out.push(
      `gate          ${g.class === 'behavior' ? 'behavior-only, ' : ''}${g.breakingSites} breaking site${g.breakingSites === 1 ? '' : 's'}, ${g.behaviorSites} behavior-note site${g.behaviorSites === 1 ? '' : 's'} in public ground truth · ${g.status}`,
    );
    for (const reason of g.reasons) out.push(`  ${c.yellow('·')} ${reason}`);
    if (g.unexercised.length)
      out.push(
        `  ${c.yellow('·')} no real site exercises ${g.unexercised.join(', ')}: their rewrites run as assisted`,
      );
    // Per-rule precision of every rewrite, breaking or not (UPT-65). Below the threshold a rule
    // runs as assisted (UPT-96); the pack's status is untouched.
    const threshold = Math.round(RULE_PRECISION_WARNING * 100);
    const mechanical = Object.entries(g.mechanical ?? {}).sort(([a], [b]) => a.localeCompare(b));
    if (mechanical.length) {
      out.push(
        `rewrites      ${'precision'.padStart(9)} ${'tp'.padStart(5)} ${'fp'.padStart(4)}  (real true positives, scored false positives)`,
      );
      for (const [id, r] of mechanical) {
        const p = rulePrecision(r);
        const low = g.lowPrecision.includes(id)
          ? `  ${c.yellow('!')} below ${threshold}%: assisted`
          : (p ?? 1) < RULE_PRECISION_WARNING
            ? `  ${c.yellow('!')} below ${threshold}%, under ${RULE_PRECISION_MIN_SITES} sites: too few to judge`
            : '';
        out.push(
          `  ${id.padEnd(28)} ${(p === undefined ? 'n/a' : `${Math.round(p * 100)}%`).padStart(9)} ${String(r.truePositives).padStart(5)} ${String(r.falsePositives).padStart(4)}${low}`,
        );
      }
      if (g.lowPrecision.length)
        out.push(
          `  ${c.yellow('!')} ${g.lowPrecision.join(', ')} below ${threshold}% precision over ${RULE_PRECISION_MIN_SITES}+ sites: their rewrites run as assisted`,
        );
    }
  }
  if (report.overclaimed)
    out.push(
      `${c.red('✗')} verification.json records verified; this run measures candidate: \`uptide pack test ${report.package} --write\` records it`,
    );
  else if (report.recorded === 'candidate' && report.status === 'verified' && !report.fixturesOnly)
    out.push('recorded candidate by choice; measures verified');
  else if (report.stale)
    out.push(
      `verification.json differs from this run: \`uptide pack test ${report.package} --write\` records it`,
    );
  const breakingFp = report.breaking.falsePositives;
  out.push(
    report.passed
      ? c.green(`PASS ${report.package}: ${report.status}`)
      : c.red(
          `FAIL ${report.package}${breakingFp ? `: ${breakingFp} false positive${breakingFp === 1 ? '' : 's'} among breaking findings` : ''}`,
        ),
  );
  return `${out.join('\n')}\n`;
}

/** Sites each list keeps in the job summary; the job log has them all. */
export const SUMMARY_LIST_LIMIT = 20;
/** GitHub rejects a step summary over 1 MiB; this leaves room for the lines around the reports. */
export const SUMMARY_MAX_BYTES = 1024 * 1024 - 64 * 1024;

/**
 * The reports for `$GITHUB_STEP_SUMMARY`, in a code block followed by `tail`: every score table,
 * each site list cut to its first `SUMMARY_LIST_LIMIT`, and the whole cut at a line under
 * `SUMMARY_MAX_BYTES` when even that is too long.
 */
export function packTestSummary(reports: PackTestReport[], tail = ''): string {
  const block = (body: string) => `\`\`\`\n${body}\n\`\`\`\n${tail}`;
  const body = reports.map((r) => formatPackTest(r, false, SUMMARY_LIST_LIMIT)).join('\n');
  if (Buffer.byteLength(block(body)) <= SUMMARY_MAX_BYTES) return block(body);
  const note = '… cut here to fit the job summary, see the job log';
  const room = SUMMARY_MAX_BYTES - Buffer.byteLength(block(note));
  const head = Buffer.from(body).subarray(0, Math.max(0, room)).toString('utf8');
  return block(`${head.slice(0, head.lastIndexOf('\n') + 1)}${note}`);
}
