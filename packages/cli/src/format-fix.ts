import { isAbsolute, relative } from 'node:path';
import {
  baselineHeadline,
  baselineHealthOf,
  costStopMessage,
  describeEresolveRetry,
  describeOutOfScope,
  describePhases,
  describeResolved,
  describeTransitive,
  describeUndeclared,
  type FixReport,
  fixVerdict,
  groupPeerBlockers,
  summaryCells,
} from '@uptide/core';
import pc from 'picocolors';
import { elapsed } from './progress.js';

export interface FormatFixOptions {
  color?: boolean;
  /** How the user invokes uptide (`uptide`), for the commands printed. */
  invocation?: string;
  suggest?: (command: string) => string;
  /** Where the user runs commands from: paths are printed relative to it, so they work as typed. */
  cwd?: string;
  /** The whole run as the user saw it, clone included; the report's own timing is the work. */
  ms?: number;
}

/**
 * The end of `fix`: five lines on the run, then where the result is and what to do next.
 * The PR body itself is a file; the terminal says where.
 */
export function formatFixSummary(report: FixReport, opts: FormatFixOptions = {}): string {
  const colors = pc.createColors(opts.color ?? true);
  const uptide = opts.invocation ?? 'uptide';
  const cells = summaryCells(report);
  const dot = colors.dim('·');
  const title =
    report.mode === 'pin'
      ? `pin ${report.package} API version ${report.apiVersion ?? ''}`
      : `${report.package} ${report.from ?? '?'} → ${report.target}${report.targetSource ? ` ${colors.dim(`(${report.targetSource})`)}` : ''}`;
  const { text, tone } = fixVerdict(report);
  const verdict = (
    tone === 'passed' ? colors.green : tone === 'compared' ? colors.yellow : colors.red
  )(text);
  const unhealthy = report.verificationPending
    ? undefined
    : baselineHeadline(baselineHealthOf(report));
  const lines = [
    `${colors.bold('uptide fix')} ${dot} ${title} ${dot} ${verdict} ${dot} ${elapsed(opts.ms ?? report.timingMs)}`,
    '',
    // Broken before the upgrade: the first thing to read, before any row of the comparison.
    ...(unhealthy ? [colors.yellow(`⚠ ${unhealthy}`), ''] : []),
    ...(report.releaseAge ? [colors.dim(report.releaseAge), ''] : []),
    ...(
      [
        ['Risk', cells.risk],
        ['Changes', cells.changes],
        ['Types', cells.types],
        ['Behavior', cells.behavior],
        ['Tests', cells.tests],
      ] as const
    ).map(([label, text]) => `  ${pad(label, 9)} ${plain(text)}`),
    ...(report.companions?.length
      ? [
          `  ${pad('With', 9)} ${report.companions.map((c) => `${c.name} ${c.from} → ${c.to}`).join(', ')}`,
        ]
      : []),
    ...(report.companions?.some((c) => c.migration === 'own')
      ? [
          `  ${pad('Risk', 9)} needs its own migration: ${report.companions
            .filter((c) => c.migration === 'own')
            .map((c) => `${c.name} ${c.from} → ${c.to} (major, no pack)`)
            .join(', ')}`,
        ]
      : []),
    // Without a pack the reader is told once, here, what stands behind the edits.
    ...(report.tier === 'generic' && report.sites.some((s) => s.outcome === 'agent')
      ? [
          `  ${pad('Tier', 9)} generic: no migration pack; every edit is the agent's, kept on the compiler's word. Review each one.`,
        ]
      : []),
    ...(report.agentFallback?.length
      ? [`  ${pad('Fallback', 9)} agent-led draft: ${report.agentFallback.join('; ')}`]
      : []),
    ...(report.cleanInstall
      ? [
          `  ${pad('Install', 9)} ${report.cleanInstall.passed ? 'clean install passes' : 'clean install FAILS'}: ${report.cleanInstall.command}`,
        ]
      : []),
    ...(report.llm.feedback
      ? [
          `  ${pad('Feedback', 9)} ${report.llm.feedback.roundsUsed}/${report.llm.feedback.maxRounds} rounds · $${report.llm.costUsd.toFixed(2)} of $${report.llm.feedback.maxCostUsd.toFixed(2)}`,
        ]
      : []),
    ...(report.llm.costLimit
      ? [`  ${pad('Agent', 9)} ${costStopMessage(report.llm.costLimit, report.llm.estimate)}`]
      : []),
    ...(report.llm.agentIdle
      ? [
          `  ${pad('Agent', 9)} ${colors.red(`The agent did not change anything: ${report.llm.agentIdle}`)}`,
        ]
      : []),
    ...(report.phases?.length ? [`  ${pad('Phases', 9)} ${describePhases(report.phases)}`] : []),
    // What the check behind this run could not see, per workspace (the files are in the report).
    ...(report.importersNotAnalyzed ?? []).map(
      (gap) =>
        `  ${pad('Coverage', 9)} ${gap.workspace === '.' ? '' : `${gap.workspace}: `}${gap.message}`,
    ),
    '',
  ];
  if (report.peerConflicts?.length) {
    lines.push(colors.bold('Peer risks'));
    for (const peer of groupPeerBlockers(report.peerConflicts))
      lines.push(
        `  ${peer.name} ${peer.version}: ${peer.peers.map((p) => `${p.peer} ${p.range} rejects ${p.target}`).join('; ')}${peer.declined ? ` · kept with a peer override (${peer.declined} is a major with no migration pack)${peer.strategy === 'blocked' ? '; verification failed: blocker' : ''}` : peer.allowed ? ' · explicitly allowed in package.json' : ''}`,
      );
    lines.push('');
  }
  if (report.lockfile?.outOfScope?.length) {
    lines.push(colors.bold('Lockfile changes outside the upgrade: review'));
    for (const c of report.lockfile.outOfScope) lines.push(`  ${describeOutOfScope(c)}`);
    lines.push('');
  }
  if (report.lockfile?.parentChurn?.length) {
    lines.push(colors.bold('Lockfile churn the parent commit already has (not from the upgrade)'));
    for (const c of report.lockfile.parentChurn) lines.push(`  ${describeOutOfScope(c)}`);
    lines.push('');
  }
  if (report.lockfile?.eresolveRetry) {
    lines.push(
      colors.bold('Lockfile re-resolved'),
      `  ${describeEresolveRetry(report.lockfile.eresolveRetry)}`,
      '',
    );
  }
  if (report.lockfile?.resolved?.length) {
    lines.push(colors.bold('Resolved version differs from the target'));
    for (const r of report.lockfile.resolved) lines.push(`  ${describeResolved(r)}`);
    lines.push('');
  }
  if (report.lockfile?.undeclared?.length) {
    lines.push(colors.bold('Imported but not declared'));
    for (const u of report.lockfile.undeclared) lines.push(`  ${describeUndeclared(u)}`);
    lines.push('');
  }
  if (report.lockfile?.peerReresolved?.length) {
    lines.push(colors.bold('Re-resolved because a peer changed'));
    for (const p of report.lockfile.peerReresolved)
      lines.push(`  ${p.name} ${p.from} → ${p.to} · peers ${p.peers.join(', ')}`);
    lines.push('');
  }
  if (report.lockfile?.transitive?.length) {
    lines.push(colors.bold('Moved with the upgraded packages'));
    for (const m of report.lockfile.transitive) {
      const shown = m.changes.slice(0, 2).map(describeTransitive).join(', ');
      const more = m.changes.length - 2;
      lines.push(
        `  ${m.name} ${m.from.join(', ') || 'none'} → ${m.to.join(', ') || 'none'} ${shown}${more > 0 ? `, and ${more} more (in the report)` : ''}`,
      );
    }
    lines.push('');
  }
  const housekeeping = report.lockfile?.housekeeping;
  if (housekeeping)
    lines.push(
      colors.dim(
        `Lockfile housekeeping · ${housekeeping.deduped.length} dedupe move${housekeeping.deduped.length === 1 ? '' : 's'} · ${housekeeping.metadata.length} metadata-only change${housekeeping.metadata.length === 1 ? '' : 's'}${housekeeping.onto?.length ? ` · ${housekeeping.onto.length} move${housekeeping.onto.length === 1 ? '' : 's'} onto the upgrade's copies` : ''} (details in the report)`,
      ),
      '',
    );
  const from = opts.cwd ?? report.source ?? report.repo;
  if (report.exportError) lines.push(colors.red(`Export failed: ${report.exportError}`), '');
  const where = report.exportError
    ? `NOT exported; verified work is in ${report.clone?.path ?? report.repo}`
    : report.source
      ? `in your repository, not checked out`
      : `in ${report.repo}`;
  lines.push(`${colors.bold('Branch')} ${report.branch} ${colors.dim(`(${where})`)}`);
  if (report.branchRenamedFrom)
    lines.push(
      colors.dim(
        `  ${report.branchRenamedFrom} already exists with different content; created ${report.branch}.`,
      ),
    );
  const base = report.baseHead ?? report.base;
  if (!report.exportError && base) lines.push(`  git diff ${base}..${report.branch} --stat`);
  if (report.clone?.kept)
    lines.push(
      colors.dim(`  temporary clone kept at ${report.clone.path}: ${report.clone.reason}`),
    );
  lines.push('', colors.bold('Next'));
  const next: [string, string][] = [];
  if (report.prUrl) next.push([report.prUrl, 'the pull request']);
  else if (report.verification.passed)
    next.push([
      `${uptide} pr --branch ${report.branch}`,
      `push the branch and open ${report.publication?.refused.length ? '' : 'a draft '}PR${report.remote ? ` on ${report.remote.replace(/^https:\/\/github\.com\//, '')}` : ''}`,
    ]);
  else if (!report.exportError)
    next.push([
      `${uptide} verify --branch ${report.branch}`,
      'verify again after fixing what failed',
    ]);
  const local = (file: string): string => {
    const rel = relative(from, file);
    return rel.startsWith('..') || isAbsolute(rel) ? file : rel;
  };
  if (report.html) next.push([`open ${local(report.html)}`, 'the migration report']);
  next.push([local(report.prBody), 'the PR description']);
  for (const entry of next) entry[0] = opts.suggest?.(entry[0]) ?? entry[0];
  const width = Math.max(...next.map(([c]) => c.length));
  for (const [cmd, what] of next) lines.push(`  ${pad(cmd, width)}    ${colors.dim(what)}`);
  return `${lines.join('\n')}\n`;
}

/** The cells are Markdown for the PR table; the terminal has no backticks or bold. */
function plain(text: string): string {
  return text.replaceAll('`', '').replace(/\*\*([^*]+)\*\*/g, '$1');
}
const pad = (text: string, to: number): string => text + ' '.repeat(Math.max(0, to - text.length));
