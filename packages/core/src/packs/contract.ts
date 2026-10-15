import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Finding } from '../domain/report.js';
import type { Usage } from '../domain/usage.js';
import { satisfies } from '../fetch/range.js';
import type {
  MigrationPack,
  MigrationRule,
  PackCompanion,
  PackContext,
  TransformResult,
} from './types.js';

/**
 * The public contract of a migration pack (docs/packs.md). `MigrationPack` is what the runner
 * calls; `Pack` adds what a person, a reviewer or `uptide pack test` needs to judge it: where
 * the knowledge comes from, what each rule claims, what the compiler cannot see, and the real
 * repositories it is scored against.
 */

/** Where the pack's knowledge comes from: the upstream changelog and migration guide. */
export interface PackSource {
  title: string;
  url: string;
}

export interface PackMeta {
  /** The npm package name, exactly as a consumer depends on it. */
  package: string;
  /** Semver range of the installed versions the pack migrates from (`>=3 <4`). */
  from: string;
  /** Semver range of the target versions (`>=4 <5`). */
  to: string;
  /** At least one: the changelog or migration guide each rule and note is taken from. */
  sources: readonly PackSource[];
  /** Who answers for the pack: a GitHub handle (`@octocat`) or `uptide-dev`. */
  maintainer: string;
  /**
   * The real breaking sites `verified` needs, when not `VERIFIED_MIN_BREAKING_SITES`: only for a
   * major whose guide lists fewer breaking changes, and only with the reason written under
   * `## Breaking-site minimum` in the pack's RESEARCH.md (`pack test` checks it is there).
   */
  minBreakingSites?: number;
}

/** One place a rule or a behavior note applies, found in a file's text. */
export interface SourceSite {
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
  /** The code at the site, trimmed: what the report shows. */
  snippet: string;
  /** The name as the code writes it (`system`, `stepCountIs`): what a summary of sites lists. */
  name?: string;
}

/**
 * A mechanical rule. Detection is the type diff `check` already does: the rule claims the
 * findings whose change kind and symbol path it matches (`kinds`, `symbols`), and `detect`
 * adds sites no type diff reports, from a file's text. `rewrite` is the deterministic edit at
 * one reported site; a rule without it is assisted, and its `guide` goes to the agent.
 */
export interface PackRule extends MigrationRule {
  /** One line, for `pack test`, the docs and the plan. */
  summary: string;
  /** What a site of this rule is: it breaks at the target, or it is deprecated there. */
  severity: 'breaking' | 'deprecated';
  /**
   * The edit at one reported site, or `{ applied: false, reason }` when the site is not one it
   * can migrate safely. Never edits anything but the reported site.
   */
  rewrite?(text: string, finding: Finding, context: PackContext): TransformResult;
  /** Sites in a file that uses the package which the type diff cannot report. */
  detect?(text: string, file: string): SourceSite[];
  /**
   * With `kinds` and `symbols`: what the compiler said at the site must match too. A
   * compiler-only finding's path is its code (`TS2353`), which says nothing about which
   * property was rejected; the message does.
   */
  message?: RegExp;
}

/**
 * A change the compiler cannot see: the same code compiles and behaves differently. How a
 * site is reported: `finding` lists it in `check` as a pack finding for a person to decide
 * (never edited); `decision` lists it under "Decisions for you" in the pull request;
 * `test-follow-up` updates a test assertion only after the migrated code made it fail.
 */
export interface BehaviorNote {
  id: string;
  summary: string;
  reported: readonly ('finding' | 'decision' | 'test-follow-up')[];
  /** With `decision`: false hides it; a string supplies a repository-specific line. Omitted means show summary. */
  applies?(context: PackContext): boolean | string;
  /** With `finding`: the sites, from a file that uses the package. */
  detect?(text: string, file: string): SourceSite[];
  /** With `finding`: whether a site breaks at the target, or only needs a look. */
  severity?: 'breaking' | 'deprecated';
}

/** A pack as the public contract describes it; see docs/packs.md. */
export interface Pack extends MigrationPack {
  readonly meta: PackMeta;
  readonly rules: readonly PackRule[];
  readonly behavior: readonly BehaviorNote[];
  /** What the agent is told for every site no rule rewrites; each rule's `guide` comes first. */
  readonly instructions: string;
  /**
   * Rules a hand-written `transform` edits without a `rewrite` of their own (Stripe's pin):
   * mechanical for the verified gate, so each needs a real site like any rewrite.
   */
  readonly mechanical?: readonly string[];
}

/**
 * Ground truth: real public repositories at the commit before they made this upgrade, with
 * every finding the pack must report there. `fixture` entries are repositories in this tree
 * (`fixtures/repos/...`): scored like the others, never counted toward `verified`.
 */
export interface GroundTruthRepo {
  /** `owner/name` on GitHub. */
  repo?: string;
  /** The full SHA scored: the commit before the upgrade. */
  commit?: string;
  /** A repository inside this one, relative to its root, instead of `repo` and `commit`. */
  fixture?: string;
  /** The project inside the repository, when it is not at its root (`frontend`). */
  directory?: string;
  /** Where the expected findings come from: the commit or pull request that made the upgrade. */
  migration?: string;
  /** The exact version installed at `commit` and the one to check against. */
  from: string;
  to: string;
  /**
   * The packages the repository's own upgrade moved with this one, at the versions it chose
   * (`@ai-sdk/react` with `ai`). `pack test` fails when `check` would not move each of them:
   * the package upgraded alone is an install the real upgrade never had.
   */
  with?: Record<string, string>;
  why: string;
  /** Repository-relative `file`, 1-based `line`, and the rule (or behavior note) id. */
  findings: GroundTruthFinding[];
}

export interface GroundTruthFinding {
  file: string;
  line: number;
  rule: string;
  /** Optional: what changed there in the real upgrade. */
  note?: string;
}

export interface GroundTruth {
  $comment?: string;
  package: string;
  repos: GroundTruthRepo[];
}

/**
 * What `uptide pack test --write` recorded: the status the gate below reads at runtime. CI
 * runs `pack test` on every pack and fails when this record claims verified where the ground
 * truth measures candidate, so the label cannot outlive the evidence behind it.
 */
export interface PackVerification {
  status: PackStatus;
  /** sha256 of the ground-truth file the result was computed from. */
  truth: string;
  /** Public repositories in the ground truth (fixtures excluded). */
  repos: number;
  breaking: VerificationTally;
  /** Sites of behavior notes, whatever their severity. Absent from records written before it. */
  behavior?: VerificationTally;
  /** The gate's class (`verifiedGate`). Absent from records written before UPT-48. */
  class?: 'breaking' | 'behavior';
  /** Expected breaking and behavior-note sites across public repositories. */
  breakingSites?: number;
  behaviorSites?: number;
  /** Mechanical rules no real site confirmed: `fix` runs their sites as assisted. */
  unexercised?: string[];
}

/**
 * Precision and recall as recorded. A ratio with nothing to measure reads 1; the counts, absent
 * from records written before they were kept, tell that apart from a perfect score.
 */
export interface VerificationTally {
  precision: number;
  recall: number;
  falsePositives: number;
  truePositives?: number;
  falseNegatives?: number;
}

/** A run's tally as `verification.json` records it. */
export function verificationTally(t: Required<VerificationTally>): Required<VerificationTally> {
  return {
    precision: Number(t.precision.toFixed(4)),
    recall: Number(t.recall.toFixed(4)),
    falsePositives: t.falsePositives,
    truePositives: t.truePositives,
    falseNegatives: t.falseNegatives,
  };
}

/** A precision or recall for people: `n/a` when nothing was predicted, or nothing expected. */
export function rateLabel(tally: VerificationTally, rate: 'precision' | 'recall'): string {
  const missed = rate === 'precision' ? tally.falsePositives : tally.falseNegatives;
  if (tally.truePositives === 0 && missed === 0) return 'n/a';
  return `${Math.round(tally[rate] * 100)}%`;
}

/**
 * `verified`: what `verifiedGate` says: ground truth from at least two public repositories, no
 * false positive among its breaking findings there, and enough real sites to trust it. Anything else is a `candidate`: it ships, `uptide pack test`
 * scores it, and `check`, `list` and `fix` treat the dependency as generic.
 */
export type PackStatus = 'verified' | 'candidate';

export const VERIFIED_MIN_REPOS = 2;

export function publicRepos(truth: GroundTruth): GroundTruthRepo[] {
  return truth.repos.filter((r) => r.repo !== undefined && r.commit !== undefined);
}

/** Expected breaking sites, across public repositories, a `verified` pack needs (UPT-48). */
export const VERIFIED_MIN_BREAKING_SITES = 5;

/** Expected behavior-note sites, across public repositories, a behavior-only pack needs. */
export const VERIFIED_MIN_BEHAVIOR_SITES = 5;

/**
 * What the gate reads, all of it from public repositories but the false positives, which count
 * wherever `pack test` scored them. `mechanical` is every rule with a `rewrite`, with its real
 * true and false positives.
 */
export interface GateEvidence {
  repos: number;
  /** The pack's own minimum (`meta.minBreakingSites`), else `VERIFIED_MIN_BREAKING_SITES`. */
  minBreakingSites?: number;
  /** Expected sites under a rule or `generic`: what the compiler or a rule sees, not a note. */
  ruleSites: number;
  breakingSites: number;
  behaviorSites: number;
  breaking: { truePositives: number; falsePositives: number };
  behavior: { truePositives: number; falsePositives: number };
  mechanical: Record<string, { truePositives: number; falsePositives: number }>;
}

/**
 * The gate's verdict. `class` is `behavior` for an upgrade the compiler cannot see (every
 * expected site is a behavior note's, whatever its severity: ioredis 6), judged on its notes;
 * otherwise `breaking`. `reasons` say why a candidate is one. `unexercised` are mechanical rules
 * no real site ever confirmed: their sites run as assisted, whatever the status.
 */
export interface GateResult {
  status: PackStatus;
  class: 'breaking' | 'behavior';
  reasons: string[];
  unexercised: string[];
}

const sites = (n: number, what: string): string => `${n} ${what} site${n === 1 ? '' : 's'}`;

/** The verified gate, from what `pack test` measured. */
export function verifiedGate(e: GateEvidence): GateResult {
  const cls = e.ruleSites === 0 && e.behaviorSites > 0 ? 'behavior' : 'breaking';
  const reasons: string[] = [];
  if (e.repos < VERIFIED_MIN_REPOS)
    reasons.push(
      `${e.repos} public repositor${e.repos === 1 ? 'y' : 'ies'}, verified needs ${VERIFIED_MIN_REPOS}`,
    );
  if (e.breaking.falsePositives > 0)
    reasons.push(
      `${e.breaking.falsePositives} false positive${e.breaking.falsePositives === 1 ? '' : 's'} among breaking findings`,
    );
  if (cls === 'breaking') {
    const min = e.minBreakingSites ?? VERIFIED_MIN_BREAKING_SITES;
    if (e.breakingSites < min)
      reasons.push(
        `${sites(e.breakingSites, 'breaking')} in public ground truth, verified needs ${min}`,
      );
    if (e.breaking.truePositives === 0) reasons.push('no breaking site found');
  } else {
    if (e.behavior.falsePositives > 0)
      reasons.push(
        `${e.behavior.falsePositives} false positive${e.behavior.falsePositives === 1 ? '' : 's'} among behavior-note sites`,
      );
    const ruleFp = Object.values(e.mechanical).reduce((n, r) => n + r.falsePositives, 0);
    if (ruleFp > 0)
      reasons.push(`${ruleFp} false positive${ruleFp === 1 ? '' : 's'} among mechanical rules`);
    if (e.behaviorSites < VERIFIED_MIN_BEHAVIOR_SITES)
      reasons.push(
        `${sites(e.behaviorSites, 'behavior-note')} in public ground truth, verified needs ${VERIFIED_MIN_BEHAVIOR_SITES}`,
      );
    if (e.behavior.truePositives === 0) reasons.push('no behavior-note site found');
  }
  const unexercised = Object.entries(e.mechanical)
    .filter(([, r]) => r.truePositives === 0)
    .map(([id]) => id)
    .sort();
  return { status: reasons.length ? 'candidate' : 'verified', class: cls, reasons, unexercised };
}

/** The digest a verification record is tied to: the ground-truth file as committed. */
export function truthDigest(text: string): string {
  return `sha256-${createHash('sha256').update(text).digest('hex')}`;
}

/** The gate, at runtime: what the committed record says, and only if it is consistent. */
export function recordedStatus(record: PackVerification | undefined): PackStatus {
  return record?.status === 'verified' &&
    record.repos >= VERIFIED_MIN_REPOS &&
    record.breaking.falsePositives === 0
    ? 'verified'
    : 'candidate';
}

/** A pack in the registry: its code, its directory under `packs/`, and its recorded status. */
export interface RegisteredPack {
  dir: string;
  pack: Pack;
  verification: PackVerification;
}

/**
 * The rule a finding belongs to: the one that set it, else the first whose kinds, symbols and
 * (when it has one) message match.
 */
export function ruleFor<R extends MigrationRule & { message?: RegExp }>(
  rules: readonly R[],
  finding: Finding,
): R | undefined {
  const set = rules.find((r) => r.id === finding.rule);
  if (set) return set;
  // A root-cause anchor is claimed by the rule that claims the errors under it: the one most
  // of them match, from their codes and messages.
  if (finding.change.kind === 'cause' && finding.downstream?.length) {
    const votes = new Map<R, number>();
    for (const d of finding.downstream.slice(0, 200)) {
      const rule = ruleFor(rules, {
        ...finding,
        change: { ...finding.change, kind: 'type', path: `TS${d.code}` },
        usage: { ...finding.usage, compileError: d.message, compileCode: d.code },
      });
      if (rule) votes.set(rule, (votes.get(rule) ?? 0) + 1);
    }
    return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];
  }
  return rules.find(
    (r) =>
      r.kinds.includes(finding.change.kind) &&
      r.symbols.test(finding.change.path) &&
      (!r.message || r.message.test(finding.usage.compileError ?? '')),
  );
}

/** Rule and note sites found in one file's text, as `check` reports a pack's own finding. */
function detected(
  pack: Pick<Pack, 'meta' | 'rules' | 'behavior'>,
  input: { file: string; text: string; from: string; to: string },
): Finding[] {
  const sources = [
    ...pack.rules
      .filter((r) => r.detect)
      .map((r) => ({
        id: r.id,
        summary: r.summary,
        severity: r.severity,
        detect: r.detect,
        manual: !r.rewrite,
      })),
    ...pack.behavior
      .filter((b) => b.detect && b.reported.includes('finding'))
      .map((b) => ({
        id: b.id,
        summary: b.summary,
        severity: b.severity ?? 'breaking',
        detect: b.detect,
        manual: true,
      })),
  ];
  const findings: Finding[] = [];
  for (const source of sources)
    for (const site of source.detect?.(input.text, input.file) ?? []) {
      const path = site.name ?? `${pack.meta.package}:${source.id}`;
      findings.push({
        change: {
          package: pack.meta.package,
          from: input.from,
          to: input.to,
          path,
          kind: source.severity === 'deprecated' ? 'deprecated' : 'signature',
          severity: source.severity,
          source: 'pack',
          confidence: 1,
        },
        usage: {
          file: input.file,
          line: site.line,
          column: site.column,
          endLine: site.line,
          endColumn: site.column,
          symbolPath: path,
          access: 'call',
          snippet: site.snippet,
          via: 'direct',
        } as Usage,
        severity: source.severity,
        confidence: 1,
        fixability: source.manual ? 'manual' : 'mechanical',
        reason: source.summary,
        rule: source.id,
      });
    }
  return findings;
}

export interface PackSpec {
  meta: PackMeta;
  rules: PackRule[];
  behavior?: BehaviorNote[];
  instructions: string;
  /** The version `fix` falls back to when the registry cannot answer. */
  defaultTarget?: string;
  /** Packages that always move with the package, each with its official source (`MigrationPack.companions`). */
  companions?: readonly PackCompanion[];
  inventory?: readonly string[];
  requiresBuild?: boolean;
  releaseGroup?: readonly PackCompanion[];
  alternateLeads?: readonly PackCompanion[];
  foldFindings?: MigrationPack['foldFindings'];
}

/**
 * A pack built from the contract alone, which is what `uptide pack new` scaffolds: the runner's
 * hooks are derived from the rules and notes. Zod and Stripe implement `Pack` by hand because
 * they also gather context no rule has (default messages, API versions).
 */
export function definePack(spec: PackSpec): Pack {
  const behavior = spec.behavior ?? [];
  const pack: Pack = {
    name: spec.meta.package,
    meta: spec.meta,
    rules: spec.rules,
    behavior,
    instructions: spec.instructions,
    ...(spec.companions ? { companions: spec.companions } : {}),
    ...(spec.inventory ? { inventory: spec.inventory } : {}),
    ...(spec.requiresBuild ? { requiresBuild: true } : {}),
    ...(spec.releaseGroup ? { releaseGroup: spec.releaseGroup } : {}),
    ...(spec.alternateLeads ? { alternateLeads: spec.alternateLeads } : {}),
    ...(spec.foldFindings ? { foldFindings: spec.foldFindings } : {}),
    defaultTarget: spec.defaultTarget ?? '',
    supports: (from, to) => satisfies(from, spec.meta.from) && satisfies(to, spec.meta.to),
    transform(text, finding, context) {
      if (!pack.supports(context.from, context.to))
        return {
          text,
          applied: false,
          reason: `pack supports ${spec.meta.package} ${spec.meta.from} to ${spec.meta.to} only`,
        };
      const rule = ruleFor(spec.rules, finding);
      if (!rule?.rewrite)
        return { text, applied: false, reason: 'no mechanical rule for this reported site' };
      if (rule.severity === 'deprecated' && !context.includeDeprecated)
        return { text, applied: false, reason: 'deprecated sites need --include-deprecated' };
      const result = rule.rewrite(text, finding, context);
      return result.applied ? { ...result, rule: rule.id } : result;
    },
    ruleOf: (finding) => ruleFor([...spec.rules, ...detectingNotes(behavior)], finding)?.id,
    guide(finding) {
      const rule = ruleFor(spec.rules, finding);
      return [rule?.guide, spec.instructions].filter(Boolean).join('\n');
    },
    reviewNotes: () => [
      ...behavior.filter((b) => !b.reported.includes('decision')).map((b) => b.summary),
      ...spec.meta.sources.map((s) => `${s.title}: ${s.url}`),
    ],
    runtimeFindings({ workspace, from, to, usages, files: inventory = [], read }) {
      const files = [...new Set([...usages.map((u) => u.file), ...inventory])].sort();
      return files.flatMap((file) => {
        const text = read(join(workspace, file));
        return text === undefined ? [] : detected(pack, { file, text, from, to });
      });
    },
  };
  return pack;
}

/** Notes reported as findings (by `detect`, or by `foldFindings`): their findings carry the note's id, as rules' do. */
function detectingNotes(behavior: readonly BehaviorNote[]): MigrationRule[] {
  return behavior
    .filter((b) => b.reported.includes('finding'))
    .map((b) => ({ id: b.id, kinds: [], symbols: /$^/, guide: b.summary }));
}

/** Sites detected in one file, for fixtures and ground truth: what `check` would add. */
export function detectIn(
  pack: Pick<Pack, 'meta' | 'rules' | 'behavior'>,
  file: string,
  text: string,
): { rule: string; line: number }[] {
  return detected(pack, { file, text, from: '', to: '' }).map((f) => ({
    rule: f.rule as string,
    line: f.usage.line,
  }));
}

/**
 * The most common rewrite: one identifier at the reported site becomes another. Only the
 * occurrence the finding points at (its line, at or after its column) is replaced, and only
 * when it is that whole identifier; anything else is declined with a reason.
 */
export function replaceAtSite(
  text: string,
  finding: Pick<Finding, 'usage'>,
  before: string,
  after: string,
): TransformResult {
  const lines = text.split('\n');
  const index = finding.usage.line - 1;
  const line = lines[index];
  if (line === undefined) return { text, applied: false, reason: 'the reported line is gone' };
  const word = new RegExp(`(?<![\\w$])${before.replace(/[$.]/g, '\\$&')}(?![\\w$])`, 'g');
  word.lastIndex = Math.max(0, finding.usage.column - 1);
  const match = word.exec(line);
  if (!match || match.index !== Math.max(0, finding.usage.column - 1))
    return { text, applied: false, reason: `the reported site is not \`${before}\`` };
  lines[index] = `${line.slice(0, match.index)}${after}${line.slice(match.index + before.length)}`;
  return { text: lines.join('\n'), applied: true, reason: `\`${before}\` is \`${after}\`` };
}

/**
 * What is wrong with a pack's `companions`, as sentences: `pack test` refuses to score a pack
 * with any. Every entry names the package and an `https` URL of the official migration guide or
 * changelog that says it moves with the leader; an entry never rests on a ground-truth
 * repository alone, which only shows what one repository did.
 */
export function companionProblems(
  companions: readonly Partial<PackCompanion>[] | undefined,
  packageName: string,
): string[] {
  const problems: string[] = [];
  (companions ?? []).forEach((c, i) => {
    const where = `companions[${i}]${c.name ? ` "${c.name}"` : ''}`;
    if (!c.name?.trim()) problems.push(`${where}: name is empty`);
    if (c.name === packageName) problems.push(`${where}: a pack does not name its own package`);
    let https = false;
    try {
      https = c.source !== undefined && new URL(c.source).protocol === 'https:';
    } catch {
      https = false;
    }
    if (!https)
      problems.push(
        `${where}: source must be the https URL of the official migration guide or changelog that says it moves with ${packageName}`,
      );
  });
  return problems;
}
