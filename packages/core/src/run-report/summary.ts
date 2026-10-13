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
        `| \`${u.package}\` | ${u.from} → ${u.to} (${u.kind}) | ${STATUS[u.status]} | ${u.breaking.length} | ${verification(u)} | ${u.pr ? `[#${u.pr.number}](${u.pr.url})` : ''} | ${u.costUsd ? usd(u.costUsd) : ''} |`,
      );
    const notes = report.upgrades.filter((u) => u.error);
    if (notes.length) {
      lines.push('');
      for (const u of notes) lines.push(`- \`${u.package}\`: ${cell(u.error as string)}`);
    }
    const sites = report.upgrades.filter((u) => u.breaking.length);
    if (sites.length) {
      lines.push('', '<details><summary>Breaking sites</summary>', '');
      for (const u of sites) {
        lines.push(`**${u.package}**`, '');
        for (const s of u.breaking.slice(0, 50))
          lines.push(`- \`${s.file}:${s.line}\` ${s.symbol} (${s.change})`);
        if (u.breaking.length > 50) lines.push(`- and ${u.breaking.length - 50} more`);
        lines.push('');
      }
      lines.push('</details>');
    }
  }
  const cost = report.upgrades.reduce((sum, u) => sum + u.costUsd, 0);
  lines.push('', `LLM spend this run: ${usd(cost)}.`, '');
  return lines.join('\n');
}
