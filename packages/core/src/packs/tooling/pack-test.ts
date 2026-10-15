import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFsSurfaceCache } from '../../cache/fs-surface-cache.js';
import { check } from '../../check/check.js';
import type { Companion } from '../../check/companions.js';
import type { CheckReport } from '../../domain/report.js';
import {
  companionProblems,
  type GateResult,
  type GroundTruth,
  type GroundTruthRepo,
  type Pack,
  type PackStatus,
  type PackVerification,
  publicRepos,
  type RegisteredPack,
  recordedStatus,
  truthDigest,
  verificationTally,
  verifiedGate,
} from '../contract.js';
import { type FixtureResult, fixturesPass, runFixtures } from './fixtures.js';
import { type EnsureOptions, ensureFixture, ensureRepo, label, truthProblems } from './truth.js';

/**
 * A site as scored: repository-relative file, line, the rule it belongs to, its severity. A
 * predicted site has the severity `check` reported; an expected one, its rule's or note's
 * (`siteSeverity`), where `behavior` is a note `check` never reports as a finding.
 */
export interface ScoredSite {
  file: string;
  line: number;
  rule: string;
  severity?: 'breaking' | 'deprecated' | 'unverified' | 'behavior';
}

export interface Tally {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
}

export interface RepoScore {
  label: string;
  repo?: string;
  commit?: string;
  fixture?: string;
  from: string;
  to: string;
  /** Set when the repository could not be scored: nothing else below is meaningful. */
  error?: string;
  /** What the lockfile says is installed, when it is not the ground truth's `from`. */
  installedMismatch?: string;
  /** What `check` moves with the package there, at versions that agree (`fix` installs them together). */
  companions?: Companion[];
  /** Packages of the scope `check` leaves where they are (`check/companions.ts`). */
  stays?: string[];
  /** Packages the real upgrade moved (`with`) that `check` would leave behind, or cannot move consistently. */
  leftBehind?: string[];
  /** Required moves `check` will not make, each only a new major (`check/required.ts`). */
  blockers?: string[];
  predicted: ScoredSite[];
  expected: ScoredSite[];
  /** Predicted sites no expected finding has, at the line level. */
  falsePositives: ScoredSite[];
  /** Expected findings nothing was predicted at. */
  falseNegatives: ScoredSite[];
  /** Real sites reported under another rule: `rule` is predicted, `expected` the truth's. */
  wrongRule: (ScoredSite & { expected: string })[];
}

export interface PackTestReport {
  package: string;
  dir: string;
  /** What the evidence below supports, and what `verification.json` says. */
  status: PackStatus;
  recorded: PackStatus;
  /** The recorded verification no longer matches this run (`--write` updates it). Not a failure. */
  stale: boolean;
  /**
   * `verification.json` claims more than this run measures: recorded verified, measured
   * candidate. The one way a record fails the test; recording less on purpose passes.
   */
  overclaimed: boolean;
  /** Ground truth was not scored (`--fixtures-only`). */
  fixturesOnly: boolean;
  verification: PackVerification;
  problems: string[];
  fixtures: FixtureResult;
  repos: RepoScore[];
  /** Ground truth, per rule: a site counts for a rule only when the rule matches too. */
  rules: Record<string, Tally>;
  /** Ground truth, at the line level, every severity. */
  overall: Tally;
  /** Ground truth, at the line level, breaking findings only: the verified gate. */
  breaking: Tally;
  /** Ground truth, at the line level, the sites of behavior notes, whatever their severity. */
  behavior: Tally;
  /** The verified gate's verdict, and the real-site counts it read. */
  gate: GateResult & { breakingSites: number; behaviorSites: number };
  passed: boolean;
}

/** The rule id a scored site is filed under: a rule or note of the pack, else `generic`. */
export const GENERIC_RULE = 'generic';

function ratio(a: number, b: number): number {
  return b === 0 ? 1 : a / b;
}

function tally(tp: number, fp: number, fn: number): Tally {
  return {
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
  };
}

const key = (s: { file: string; line: number }): string => `${s.file}:${s.line}`;

/**
 * The sites `check` shows for the package, from its plan: the findings worth acting on,
 * grouped under the rule `fix` would apply. Repository-relative, as ground truth is written.
 */
export function predictedSites(report: CheckReport, pack: Pack): ScoredSite[] {
  const own = new Set([...pack.rules.map((r) => r.id), ...pack.behavior.map((b) => b.id)]);
  const sites = new Map<string, ScoredSite>();
  for (const p of report.packages) {
    const names = p.members ? p.members.map((m) => m.name) : [p.name];
    if (!names.includes(pack.name)) continue;
    const prefix = p.workspace === '.' || p.workspace === '*' ? '' : `${p.workspace}/`;
    const absolute = (file: string): string =>
      file.startsWith(prefix) ? file : `${prefix}${file}`;
    // A call site an anchored finding lists as evidence is neither a true nor a false
    // positive: the one site is the anchor (the declaration, a compiler option), which the
    // ground truth names, and the evidence under it is not scored even when another finding
    // lands on the same line.
    const evidence = new Set(
      p.findings
        .filter((f) => f.anchorOnly)
        .flatMap((f) =>
          (f.downstream ?? []).map((d) => key({ file: absolute(d.file), line: d.line })),
        ),
    );
    const anchors = new Set(
      p.findings
        .filter((f) => f.anchorOnly)
        .map((f) => key({ file: absolute(f.usage.file), line: f.usage.line })),
    );
    for (const group of p.plan ?? [])
      for (const location of group.locations) {
        const file = absolute(location.file);
        if (
          evidence.has(key({ file, line: location.line })) &&
          !anchors.has(key({ file, line: location.line }))
        )
          continue;
        const site: ScoredSite = {
          file,
          line: location.line,
          rule: own.has(group.rule) ? group.rule : GENERIC_RULE,
          severity: group.severity,
        };
        // One site, one rule: the more severe group wins, as the plan lists it first.
        if (!sites.has(key(site))) sites.set(key(site), site);
      }
  }
  return [...sites.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** One repository: what was predicted against what the ground truth expects. */
export function scoreSites(
  predicted: ScoredSite[],
  expected: ScoredSite[],
): Pick<RepoScore, 'falsePositives' | 'falseNegatives' | 'wrongRule'> {
  const truth = new Map(expected.map((e) => [key(e), e]));
  const seen = new Set(predicted.map(key));
  return {
    falsePositives: predicted.filter((p) => !truth.has(key(p))),
    falseNegatives: expected.filter((e) => !seen.has(key(e))),
    // A `generic` entry is a site no rule covered when the truth was written: any rule may claim it.
    wrongRule: predicted
      .filter(
        (p) =>
          truth.has(key(p)) &&
          truth.get(key(p))?.rule !== GENERIC_RULE &&
          truth.get(key(p))?.rule !== p.rule,
      )
      .map((p) => ({ ...p, expected: truth.get(key(p))?.rule as string })),
  };
}

/**
 * The severity of an expected site: its rule's, or its note's as `check` reports the note's
 * findings (breaking unless the note says otherwise). A note `check` never reports as a finding
 * is `behavior`; a site no rule or note covers (`generic`) is breaking.
 */
export function siteSeverity(
  pack: Pick<Pack, 'rules' | 'behavior'>,
  rule: string,
): 'breaking' | 'deprecated' | 'behavior' {
  const own = pack.rules.find((r) => r.id === rule);
  if (own) return own.severity;
  const note = pack.behavior.find((b) => b.id === rule);
  if (!note) return 'breaking';
  if (note.severity) return note.severity;
  return note.detect && note.reported.includes('finding') ? 'breaking' : 'behavior';
}

/**
 * Every scored repository together: per rule, at the line level, for breaking findings, and
 * for the sites of behavior notes.
 */
export function scoreTruth(
  pack: Pick<Pack, 'rules' | 'behavior'>,
  scored: Pick<RepoScore, 'predicted' | 'expected' | 'falsePositives' | 'falseNegatives'>[],
): Pick<PackTestReport, 'rules' | 'overall' | 'breaking' | 'behavior'> {
  const all = <K extends 'predicted' | 'expected' | 'falsePositives' | 'falseNegatives'>(k: K) =>
    scored.flatMap((r) => r[k]);
  const fp = all('falsePositives');
  const fn = all('falseNegatives');
  const predicted = all('predicted');
  const overall = tally(predicted.length - fp.length, fp.length, fn.length);
  const breakingPredicted = predicted.filter((p) => p.severity === 'breaking');
  const breakingFp = fp.filter((p) => p.severity === 'breaking');
  // A miss is a breaking one when the rule or note it was expected under is.
  const breaking = tally(
    breakingPredicted.length - breakingFp.length,
    breakingFp.length,
    fn.filter((f) => siteSeverity(pack, f.rule) === 'breaking').length,
  );
  const notes = new Set(pack.behavior.map((b) => b.id));
  const ofNote = (s: ScoredSite) => notes.has(s.rule);
  const noteFp = fp.filter(ofNote).length;
  const behavior = tally(
    predicted.filter(ofNote).length - noteFp,
    noteFp,
    fn.filter(ofNote).length,
  );
  const rules: Record<string, Tally> = {};
  const ids = new Set([
    ...pack.rules.map((r) => r.id),
    ...pack.behavior.map((b) => b.id),
    ...predicted.map((p) => p.rule),
    ...all('expected').map((e) => e.rule),
  ]);
  for (const id of ids) {
    let tp = 0;
    let rfp = 0;
    let rfn = 0;
    for (const r of scored) {
      const claimed = new Map(r.predicted.map((p) => [key(p), p.rule]));
      // A `generic` entry counts for whichever rule claims its site now.
      const expected = r.expected.map((e) =>
        e.rule === GENERIC_RULE && claimed.has(key(e))
          ? { ...e, rule: claimed.get(key(e)) as string }
          : e,
      );
      const want = new Set(expected.filter((e) => e.rule === id).map(key));
      const got = new Set(r.predicted.filter((p) => p.rule === id).map(key));
      for (const k of got) (want.has(k) ? () => tp++ : () => rfp++)();
      for (const k of want) if (!got.has(k)) rfn++;
    }
    if (tp + rfp + rfn > 0) rules[id] = tally(tp, rfp, rfn);
  }
  return { rules, overall, breaking, behavior };
}

async function scoreRepo(
  pack: Pack,
  entry: GroundTruthRepo,
  root: string,
  options: EnsureOptions,
): Promise<RepoScore> {
  const expected = entry.findings.map((f) => ({
    file: f.file,
    line: f.line,
    rule: f.rule,
    severity: siteSeverity(pack, f.rule),
  }));
  const base: RepoScore = {
    label: label(entry),
    ...(entry.repo ? { repo: entry.repo } : {}),
    ...(entry.commit ? { commit: entry.commit } : {}),
    ...(entry.fixture ? { fixture: entry.fixture } : {}),
    from: entry.from,
    to: entry.to,
    predicted: [],
    expected,
    falsePositives: [],
    falseNegatives: [],
    wrongRule: [],
  };
  try {
    const dir = entry.fixture
      ? await ensureFixture(root, entry.fixture, options)
      : await ensureRepo(
          {
            repo: entry.repo as string,
            commit: entry.commit as string,
            ...(entry.directory ? { directory: entry.directory } : {}),
          },
          options,
        );
    const project = entry.directory ? join(dir, entry.directory) : dir;
    options.log?.(`checking ${pack.name} ${entry.from} → ${entry.to} in ${label(entry)}`);
    const report = await check({
      cwd: project,
      only: [pack.name],
      targets: { [pack.name]: entry.to },
      packs: [pack],
      // In this thread, with the pack under test: no worker loads the bundled registry.
      cache: createFsSurfaceCache(),
    });
    const installed = [
      ...new Set(report.packages.filter((p) => p.name === pack.name).map((p) => p.installed)),
    ];
    if (installed.length > 0 && !installed.includes(entry.from))
      base.installedMismatch = `the lockfile has ${installed.join(', ')}, the ground truth says ${entry.from}`;
    const own = report.packages.filter((p) => p.name === pack.name);
    const predicted = predictedSites(report, pack);
    return {
      ...base,
      ...companionOutcome(own, entry.with),
      predicted,
      ...scoreSites(predicted, expected),
    };
  } catch (err) {
    return { ...base, error: (err as Error).message };
  }
}

/**
 * What `check` moves with the package in one repository, against what its real upgrade moved
 * (`with`): a package the upgrade moved that `check` does not is left behind, and says why
 * when a blocker names it (a required move only a new major makes).
 */
export function companionOutcome(
  own: CheckReport['packages'],
  moved: Record<string, string> = {},
): Pick<RepoScore, 'companions' | 'stays' | 'leftBehind' | 'blockers'> {
  const companions = [
    ...new Map(own.flatMap((p) => p.companions ?? []).map((c) => [c.name, c])).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const stays = [...new Set(own.flatMap((p) => p.companionStays ?? []))].sort();
  const blockers = [...new Set(own.flatMap((p) => p.companionBlockers ?? []))].sort();
  const names = (blocker: string, name: string) =>
    new RegExp(`(^|[ (])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} `).test(blocker);
  const leftBehind = [
    ...new Set(own.flatMap((p) => p.companionConflicts ?? [])),
    ...Object.entries(moved)
      .filter(([name]) => !companions.some((c) => c.name === name))
      .map(([name, version]) => {
        const blocker = blockers.find((b) => names(b, name));
        return `${name}: the upgrade moved it to ${version}, check leaves it${blocker ? ` (blocked: ${blocker})` : ''}`;
      }),
  ];
  return {
    ...(companions.length ? { companions } : {}),
    ...(stays.length ? { stays } : {}),
    ...(blockers.length ? { blockers } : {}),
    ...(leftBehind.length ? { leftBehind } : {}),
  };
}

export interface PackTestOptions extends EnsureOptions {
  /** The uptide checkout: packs live in `<root>/packages/core/src/packs`. */
  root: string;
  /** Fixtures only: no repository is fetched or checked. */
  fixturesOnly?: boolean;
  /** Record this run's verification in the pack's `verification.json`. */
  write?: boolean;
  /** Write each fixture case's `after.ts` from what the rules produce. */
  updateFixtures?: boolean;
}

export function packsDir(root: string): string {
  return join(root, 'packages', 'core', 'src', 'packs');
}

export function readTruth(dir: string): { truth: GroundTruth; text: string } | undefined {
  const file = join(dir, 'ground-truth.json');
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, 'utf8');
  return { truth: JSON.parse(text) as GroundTruth, text };
}

/** Fixtures and ground truth of one pack, scored; nothing is written. */
export async function testPack(
  entry: RegisteredPack,
  options: PackTestOptions,
): Promise<PackTestReport> {
  const { pack } = entry;
  const dir = join(packsDir(options.root), entry.dir);
  const problems: string[] = [];
  if (!pack.meta.sources.length) problems.push('meta.sources lists no changelog or guide');
  if (!pack.meta.maintainer) problems.push('meta.maintainer is empty');
  problems.push(...companionProblems(pack.companions, pack.name));
  problems.push(
    ...companionProblems(pack.releaseGroup, pack.name).map((p) =>
      p.replace('companions[', 'releaseGroup['),
    ),
    ...companionProblems(pack.alternateLeads, pack.name).map((p) =>
      p.replace('companions[', 'alternateLeads['),
    ),
  );
  const fixtures = runFixtures(pack, dir, { update: options.updateFixtures === true });
  if (fixtures.cases.length === 0 && pack.rules.some((r) => r.rewrite || r.detect))
    problems.push('rules that rewrite or detect need fixtures (fixtures/<case>/before.ts)');
  const read = readTruth(dir);
  if (!read) problems.push('no ground-truth.json');
  const truth = read?.truth ?? { package: pack.name, repos: [] };
  problems.push(...truthProblems(truth, pack.name));

  const repos: RepoScore[] = [];
  if (!options.fixturesOnly && problems.length === 0)
    for (const repo of truth.repos) repos.push(await scoreRepo(pack, repo, options.root, options));

  const { rules, overall, breaking, behavior } = scoreTruth(
    pack,
    repos.filter((r) => !r.error),
  );

  const gate = gateOf(pack, truth, repos);
  // A pack whose upgrade leaves part of the group behind produces an inconsistent install.
  if (options.fixturesOnly) gate.reasons.unshift('ground truth not scored (--fixtures-only)');
  for (const r of repos) {
    if (r.error) gate.reasons.unshift(`${r.label} could not be scored`);
    if (r.leftBehind?.length)
      gate.reasons.unshift(`${r.label}: check leaves part of the upgrade behind`);
  }
  const status: PackStatus = gate.reasons.length ? 'candidate' : 'verified';
  gate.status = status;
  const verification: PackVerification = {
    status,
    truth: read ? truthDigest(read.text) : '',
    repos: publicRepos(truth).length,
    breaking: verificationTally(breaking),
    behavior: verificationTally(behavior),
    class: gate.class,
    breakingSites: gate.breakingSites,
    behaviorSites: gate.behaviorSites,
    unexercised: gate.unexercised,
  };
  const recorded = recordedStatus(entry.verification);
  // Fixtures alone say nothing about ground truth: only a full run can find the record stale.
  let stale =
    !options.fixturesOnly && JSON.stringify(verification) !== JSON.stringify(entry.verification);
  const scoredAll = problems.length === 0 && repos.every((r) => !r.error);
  // A repository that could not be scored is no evidence either way: it fails as unscored.
  const overclaimed = !options.fixturesOnly && scoredAll && overclaims(recorded, status);
  if (options.write && stale && scoredAll && !options.fixturesOnly) {
    writeVerification(options.root, entry.dir, verification);
    stale = false;
  }
  const passed =
    scoredAll &&
    fixturesPass(fixtures) &&
    breaking.falsePositives === 0 &&
    !repos.some((r) => r.leftBehind?.length) &&
    !overclaimed;
  return {
    package: pack.name,
    dir: entry.dir,
    status,
    recorded,
    stale,
    overclaimed,
    fixturesOnly: options.fixturesOnly === true,
    verification,
    problems,
    fixtures,
    repos,
    rules,
    overall,
    breaking,
    behavior,
    gate,
    passed,
  };
}

/**
 * The gate over one run: real sites are those of public repositories (a fixture repository
 * scores, never counts), and so are the true positives that exercise a mechanical rule.
 */
export function gateOf(
  pack: Pick<Pack, 'rules' | 'behavior'>,
  truth: GroundTruth,
  repos: RepoScore[],
): PackTestReport['gate'] {
  const scored = repos.filter((r) => !r.error);
  const real = scored.filter((r) => !r.fixture);
  const notes = new Set(pack.behavior.map((b) => b.id));
  const expected = real.flatMap((r) => r.expected);
  const breakingSites = expected.filter((e) => siteSeverity(pack, e.rule) === 'breaking').length;
  const behaviorSites = expected.filter((e) => notes.has(e.rule)).length;
  const ruleSites = expected.length - behaviorSites;
  const all = scoreTruth(pack, scored);
  const { rules } = scoreTruth(pack, real);
  const mechanical = Object.fromEntries(
    pack.rules
      .filter((r) => r.rewrite)
      .map((r) => [
        r.id,
        {
          truePositives: rules[r.id]?.truePositives ?? 0,
          falsePositives: all.rules[r.id]?.falsePositives ?? 0,
        },
      ]),
  );
  const gate = verifiedGate({
    repos: publicRepos(truth).length,
    ruleSites,
    breakingSites,
    behaviorSites,
    breaking: all.breaking,
    behavior: all.behavior,
    mechanical,
  });
  return { ...gate, breakingSites, behaviorSites };
}

/**
 * Whether a record claims more than the evidence supports: verified where the run measures
 * candidate. A record may claim less (candidate where the run measures verified): the runtime
 * then treats the package as generic, which is a maintainer's choice, not a lie.
 */
export function overclaims(recorded: PackStatus, measured: PackStatus): boolean {
  return recorded === 'verified' && measured === 'candidate';
}

/** `--write`: the record the runtime gate reads, as this run measured it. */
export function writeVerification(root: string, dir: string, record: PackVerification): string {
  const file = join(packsDir(root), dir, 'verification.json');
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

/**
 * A pack whose test never finished (it ran past its deadline, or its process died): failed,
 * with the reason as its problem, so the run names the pack instead of stalling or vanishing.
 */
export function unfinishedPack(entry: RegisteredPack, reason: string): PackTestReport {
  const none = tally(0, 0, 0);
  return {
    package: entry.pack.name,
    dir: entry.dir,
    status: 'candidate',
    recorded: recordedStatus(entry.verification),
    stale: false,
    overclaimed: false,
    fixturesOnly: false,
    verification: entry.verification,
    problems: [reason],
    fixtures: {
      cases: [],
      rules: {},
      falsePositives: [],
      falseNegatives: [],
      rewriteFailures: [],
      unknown: [],
    },
    repos: [],
    rules: {},
    overall: none,
    breaking: none,
    behavior: none,
    gate: {
      status: 'candidate',
      class: 'breaking',
      reasons: [reason],
      unexercised: [],
      breakingSites: 0,
      behaviorSites: 0,
    },
    passed: false,
  };
}
