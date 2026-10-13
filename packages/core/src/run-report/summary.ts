import type { RunReport, Upgrade } from './schema.js';

const cell = (text: string): string => text.replace(/\|/g, '\\|');
const usd = (n: number): string => `$${n.toFixed(2)}`;
const STATUS: Record<Upgrade['status'], string> = {
  fixed: 'fixed',
  failed: 'failed',
  available: 'available',
  skipped: 'skipped',
  up_to_date: 'up to date',
};

/** `3.25.76 → 4.6.5 (major)`; one version, and no kind, when nothing moves. */
const move = (u: Upgrade): string => (u.from === u.to ? u.from : `${u.from} → ${u.to} (${u.kind})`);

const status = (u: Upgrade): string =>
  u.movesWith ? `moves with \`${u.movesWith}\`` : STATUS[u.status];

/**
 * The breaking count, only where it is an answer: zero means nothing breaks only when a pack
 * analyzed the upgrade. Without a pack, or without an analysis, it says so instead of a number.
 */
function breaking(u: Upgrade): string {
  if (u.movesWith) return `with \`${u.movesWith}\``;
  if (u.breaking.length) return String(u.breaking.length);
  if (u.analysis === 'pack') return '0';
  if (u.analysis === 'none') return 'not analyzed: no pack yet';
  return u.status === 'up_to_date' ? '' : 'not analyzed';
}

function verification(u: Upgrade): string {
  const v = u.verification;
  if (!v) return '';
  const tests = v.tests ? `tests ${v.tests.passed} passed, ${v.tests.failed} failed` : 'no tests';
  return `types ${v.typecheck.before} → ${v.typecheck.after}, lint ${v.lint.before} → ${v.lint.after}, ${tests}`;
}

/** The report as Markdown for `$GITHUB_STEP_SUMMARY`: the same fields, nothing more. */
export function renderSummary(report: RunReport): string {
  const lines = [
    `## Uptide: ${report.mode}`,
    '',
    `${report.repo.owner}/${report.repo.name} at \`${report.sha.slice(0, 12)}\`, engine ${report.engineVersion}.`,
    '',
  ];
  if (report.error) lines.push(`**The run stopped:** ${cell(report.error)}`, '');
  if (report.upgrades.length === 0) lines.push('No dependency upgrades to report.');
  else {
    lines.push(
      '| Package | Upgrade | Status | Breaking sites | Verification | Pull request | LLM cost |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const u of report.upgrades)
      lines.push(
        `| \`${u.package}\` | ${move(u)} | ${status(u)} | ${breaking(u)} | ${verification(u)} | ${u.pr ? `[#${u.pr.number}](${u.pr.url})` : ''} | ${u.costUsd ? usd(u.costUsd) : ''} |`,
      );
    const notes = report.upgrades.filter((u) => u.error);
    if (notes.length) {
      lines.push('');
      for (const u of notes) lines.push(`- \`${u.package}\`: ${cell(u.error as string)}`);
    }
    // Where each package breaks, by path and line; no heading when nothing does.
    const sites = report.upgrades.filter((u) => u.breaking.length);
    if (sites.length) {
      lines.push('', '### Breaking sites');
      for (const u of sites) {
        const places = [...new Set(u.breaking.map((s) => `${s.file}:${s.line}`))];
        lines.push('', `**\`${u.package}\`** (${places.length})`, '');
        for (const place of places.slice(0, 50)) lines.push(`- \`${cell(place)}\``);
        if (places.length > 50) lines.push(`- and ${places.length - 50} more`);
      }
    }
  }
  const cost = report.upgrades.reduce((sum, u) => sum + u.costUsd, 0);
  lines.push('', `LLM spend this run: ${usd(cost)}.`, '');
  return lines.join('\n');
}
