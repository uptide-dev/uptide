import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding } from '../domain/report.js';
import { satisfies, validRange } from '../fetch/range.js';
import { flowsToConsumer } from './flows-to-consumer.js';
import { type StripeBehaviorContext, stripeBehaviorSites } from './stripe/behavior-sites.js';

/**
 * Behavior records (ADR 0017): a change the same code meets at runtime that no type, test or
 * compiler shows, as a verbatim quote from a published source and a trigger that finds the
 * repository's own sites. A record is a finding only with both: a site the trigger resolved with
 * the type checker, and a quote the contract test proves is in the page it cites.
 */
export interface RecordSource {
  /** The published page or file the quote is from. */
  url: string;
  /** When it was read (`YYYY-MM-DD`). */
  read: string;
  /** sha256 of the full page: source drift requires explicit author review. */
  sha256: string;
  /** Verbatim, a substring of the full page. */
  quote: string;
  /** Optional vendored snapshot. External sources are fetched and verified at pack-build time. */
  snapshot?: string;
}

/**
 * A value of the target's type passed to a function of another package (the consumer), which
 * reads it differently on the target's new major: a zod object passed as `inputSchema` to the MCP
 * SDK. Skipped when the consumer is not installed, or installed outside `consumer.range`.
 */
export interface FlowsToConsumer {
  kind: 'flows-to-consumer';
  consumer: { package: string; range: string };
  calls: {
    /** The receiver's type, declared inside the consumer package (`McpServer`). */
    type: string;
    method: string;
    /** The 0-based argument; every argument after the first when absent (an overloaded `tool`). */
    argument?: number;
    /** The property of that argument holding the value (`inputSchema`). */
    property?: string;
  }[];
  /** What a value at the site must be for the record to apply: a predicate `flowsToConsumer` names. */
  value: 'zod-object-strip';
}

export type RecordTrigger = FlowsToConsumer | { kind: 'omits-property'; property: 'billing_mode' };

export interface BehaviorRecord {
  /** `<pack>/<slug>`: the rule id its sites are filed under. */
  id: string;
  /** Semver ranges of the installed version and the target the record holds between. */
  range: { from: string; to: string };
  /** At least one; each quote verbatim in its snapshot. */
  sources: RecordSource[];
  trigger: RecordTrigger;
  /** What the old code does on the new version, in one sentence. */
  effect: string;
  keepOld: {
    /** The edit at the site that restores the old behavior. */
    edit: string;
    /** Restores it and changes nothing else. */
    exact: boolean;
    /** What else the edit changes, when it is not exact: said in the PR as a decision. */
    alsoChanges?: string;
  };
  /** What a person gets by not applying `keepOld`. */
  adopt?: string;
}

/** One site a record matched, repository-relative. */
export interface RecordSite {
  record: string;
  file: string;
  line: number;
  snippet: string;
  /** Set after a `fix` session: the edit is in place (the trigger no longer matches the call). */
  kept?: boolean;
  /** The request API version did not cross the behavioral boundary. */
  unaffected?: boolean;
  /** Stable call identity for post-session verification. */
  identity?: string;
  /** Params cannot be resolved: ask the owner, never insert an edit. */
  decision?: boolean;
  /** API-specific preserving parameter path, or reason an edit needs review. */
  edit?: string;
  decisionReason?: string;
}

/** What is wrong with a pack's records, as sentences: `pack test` and the contract test refuse them. */
export function recordProblems(
  records: readonly BehaviorRecord[],
  dir: string,
  pack: string,
): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const r of records) {
    const where = `records "${r.id}"`;
    if (!r.id.startsWith(`${pack}/`)) problems.push(`${where}: the id starts with "${pack}/"`);
    if (ids.has(r.id)) problems.push(`${where}: the id is used twice`);
    ids.add(r.id);
    if (!validRange(r.range.from) || !validRange(r.range.to))
      problems.push(`${where}: range.from and range.to are semver ranges`);
    if (r.trigger.kind === 'flows-to-consumer' && !validRange(r.trigger.consumer.range))
      problems.push(`${where}: trigger.consumer.range is a semver range`);
    if (!r.sources.length) problems.push(`${where}: no source, no record`);
    if (!r.keepOld.exact && !r.keepOld.alsoChanges)
      problems.push(`${where}: keepOld is not exact, so alsoChanges says what else it changes`);
    for (const s of r.sources) {
      if (!/^https:\/\//.test(s.url)) problems.push(`${where}: ${s.url} is not an https URL`);
      if (!s.snapshot) {
        if (
          !/^[a-f0-9]{64}$/.test(s.sha256) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(s.read) ||
          !s.quote.trim()
        )
          problems.push(`${where}: fetched sources require a sha256, read date and quote`);
        continue; // Full external pages are verified by the pack build, never vendored.
      }
      let text: string;
      try {
        text = readFileSync(join(dir, s.snapshot), 'utf8');
      } catch {
        problems.push(`${where}: no snapshot at ${s.snapshot}`);
        continue;
      }
      problems.push(...sourceProblems(s, text).map((p) => `${where}: ${p}`));
    }
  }
  return problems;
}

/** Shared by offline vendored snapshots and the build-time external-source fetch. */
export function sourceProblems(source: RecordSource, text: string): string[] {
  const name = source.snapshot ?? source.url;
  const problems: string[] = [];
  if (createHash('sha256').update(text).digest('hex') !== source.sha256)
    problems.push(`${name} does not match its sha256`);
  if (!source.quote.trim() || !text.includes(source.quote))
    problems.push(`the quote is not verbatim in ${name}`);
  return problems;
}

/** The records that hold between the installed version and the target. */
export function applicable(
  records: readonly BehaviorRecord[],
  from: string,
  to: string,
): BehaviorRecord[] {
  return records.filter((r) => satisfies(from, r.range.from) && satisfies(to, r.range.to));
}

/**
 * The sites of each record in one workspace, resolved with the type checker. `before`: the
 * repository as it is, on the installed version (`check`). `after`: the migrated branch on the
 * target, where a site that still matches is one the edit has not reached.
 */
export function recordSites(
  records: readonly BehaviorRecord[],
  input: {
    root: string;
    workspace: string;
    phase: 'before' | 'after';
    stripe?: StripeBehaviorContext;
  },
): RecordSite[] {
  return records.flatMap((record) =>
    triggerSites(record, input).map((site) => ({
      record: record.id,
      ...site,
      file: input.workspace === '.' ? site.file : join(input.workspace, site.file),
    })),
  );
}

function triggerSites(
  record: BehaviorRecord,
  input: {
    root: string;
    workspace: string;
    phase: 'before' | 'after';
    stripe?: StripeBehaviorContext;
  },
): Omit<RecordSite, 'record'>[] {
  if (!record.sources.length || record.sources.some((s) => !s.quote.trim())) return [];
  return record.trigger.kind === 'flows-to-consumer'
    ? flowsToConsumer(record.trigger, input)
    : stripeBehaviorSites(input);
}

/** A record's sites as `check` reports them, workspace-relative: their own rule, never breaking (ADR 0017 §5). */
export function recordFindings(
  records: readonly BehaviorRecord[],
  input: {
    root: string;
    workspace: string;
    package: string;
    from: string;
    to: string;
    stripe?: StripeBehaviorContext;
  },
): Finding[] {
  const usable = applicable(records, input.from, input.to);
  if (!usable.length) return [];
  return usable.flatMap((record) =>
    triggerSites(record, { ...input, phase: 'before' }).map(
      (site): Finding => ({
        change: {
          package: input.package,
          from: input.from,
          to: input.to,
          path: record.id,
          kind: 'signature',
          severity: 'unverified',
          source: 'pack',
          confidence: 1,
        },
        usage: {
          file: site.file,
          line: site.line,
          column: 1,
          endLine: site.line,
          endColumn: 1,
          symbolPath: record.id,
          access: 'call',
          snippet: site.snippet,
          via: 'direct',
        },
        severity: 'unverified',
        confidence: 1,
        fixability: 'manual',
        reason:
          'decision' in site && site.decision
            ? `${site.decisionReason ?? 'Parameters could not be resolved; review billing_mode before choosing classic or flexible'}. ${record.effect}`
            : record.effect,
        rule: record.id,
        details: citations(record),
        evidence: 'pack',
      }),
    ),
  );
}

/** Each source as one line: the quote and where it is from. */
export function citations(record: BehaviorRecord): string[] {
  return record.sources.map((s) => `"${s.quote}" (${s.url}, read ${s.read})`);
}

const at = (sites: readonly RecordSite[]) =>
  [...sites]
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
    .map((s) => `\`${s.file}:${s.line}\``)
    .join(', ');

/** The agent's block: every matched site with its record, sources and the edit that keeps it. */
export function recordPrompt(
  records: readonly BehaviorRecord[],
  sites: readonly RecordSite[],
): string[] {
  const lines: string[] = [];
  for (const record of records) {
    const own = sites.filter((s) => s.record === record.id);
    if (!own.length) continue;
    lines.push(
      `- ${record.id}: ${record.effect}`,
      ...own.map(
        (s) =>
          `  site: ${s.file}:${s.line} \`${s.snippet}\`${s.decision ? ` — ${s.decisionReason ?? 'unresolved params'}: decision only; do not edit` : s.edit ? ` — edit: ${s.edit}` : ''}`,
      ),
      ...citations(record).map((c) => `  source: ${c}`),
      `  keeps the old behavior: ${record.keepOld.edit}${record.keepOld.exact ? ' (exactly)' : `; it also ${record.keepOld.alsoChanges}`}`,
    );
  }
  if (!lines.length) return [];
  return [
    'Behavior changes at these sites (no compiler error, type or test shows them; each is cited):',
    ...lines,
    'At each site, apply the edit that keeps the old behavior, or say in decisions why not, naming the record id.',
  ];
}

/**
 * "Decisions for you" lines: what the record changes, its cited sources, where the edit was
 * applied and where it was not, and what else the edit changes when it is not exact.
 */
export function recordDecisions(
  records: readonly BehaviorRecord[],
  sites: readonly RecordSite[],
): string[] {
  return records.flatMap((record) => {
    const own = sites.filter((s) => s.record === record.id);
    if (!own.length) return [];
    const kept = own.filter((s) => s.kept);
    if (record.keepOld.exact && kept.length === own.length) return [];
    const open = own.filter((s) => !s.kept && !s.decision);
    const unknown = own.filter((s) => s.decision);
    const sources = record.sources.map((s) => `"${s.quote}" ([source](${s.url}))`).join('; ');
    const done = kept.length
      ? `Applied \`${record.keepOld.edit}\` at ${at(kept)}${record.keepOld.exact ? ', which keeps the old behavior exactly.' : `: it keeps the old behavior, and it also ${record.keepOld.alsoChanges}. Keep it, or drop it${record.adopt ? ` to ${record.adopt}` : ''}.`}`
      : '';
    const left = open.length
      ? `Not applied at ${at(open)}: recommended \`${record.keepOld.edit}\`${record.keepOld.exact ? '' : `, which also ${record.keepOld.alsoChanges}`}.`
      : '';
    return [
      `- **Behavior change (${record.id}):** ${record.effect} Sources: ${sources}. ${record.adopt ? `To adopt the new default: ${record.adopt}. ` : ''}${[done, left, unknown.length ? `Decision for you at ${at(unknown)}: ${[...new Set(unknown.map((s) => s.decisionReason ?? 'Unresolved params; inspect the runtime parameters before choosing classic or flexible'))].join('; ')}. No automatic edit.` : ''].filter(Boolean).join(' ')}`,
    ];
  });
}

/** Exact, verified preserving edits belong in the existing What changed section. */
export function recordKept(
  records: readonly BehaviorRecord[],
  sites: readonly RecordSite[],
): string[] {
  return records.flatMap((record) => {
    const kept = sites.filter((s) => s.record === record.id && s.kept && !s.decision);
    if (!record.keepOld.exact || !kept.length) return [];
    return [
      `- **Kept (${record.id}):** \`${record.keepOld.edit}\` at ${at(kept)}. ${record.sources.map((s) => `"${s.quote}" ([source](${s.url}))`).join('; ')}. ${record.adopt ? `Adopting the new default: ${record.adopt}.` : ''}`,
    ];
  });
}
