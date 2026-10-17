import type { Finding, ImportersNotAnalyzed, Tier } from '../domain/report.js';
import type { Provider } from '../llm/types.js';
import type { ApiChangeFacts, Headline, PackContext } from '../packs/types.js';
import type { BaselineHealth } from './baseline.js';
import type { BehaviorResult } from './behavior.js';
import type { InstallReport } from './managers/upgrade.js';
import type { PeerBlockerGroup } from './peer-preflight.js';
import type { RootPin } from './root-pins.js';
export interface RelatedDeclaration {
  file: string;
  line: number;
  endLine: number;
  message: string;
}
export interface FixDiagnostic {
  file: string;
  line: number;
  column: number;
  code: number;
  message: string;
  /**
   * TS2322/TS2345: the shape of the type the compiler expected, one level deep
   * (`BillingCycleAnchor: { type: "now" | "unchanged" | OtherString }`). The message names
   * the type; a migration needs what it is.
   */
  expected?: string;
  relatedDeclarations?: RelatedDeclaration[];
  /** Start locations from TypeScript relatedInformation; diagnostic wording is not identity. */
  relatedLocations?: { file: string; line: number; column: number }[];
}
export interface FixSite {
  finding: Finding;
  outcome: 'mechanical' | 'agent' | 'manual';
  reason: string;
  /** Stable migration rule, retained for grouping without compiler-code heuristics. */
  rule?: string;
  diff?: string;
  /** Site key of the accepted edit that also resolved this diagnostic. */
  resolvedBy?: string;
  attempts?: AssistedAttempt[];
  editedFiles?: string[];
}
export type LlmFailureKind =
  | 'no-tool-call'
  | 'invalid-tool-call'
  | 'rate-limited'
  | 'api-error'
  | 'usage-unavailable'
  | 'token-bounds';
export interface AssistedAttempt {
  responseModel?: string;
  reservationUsd?: number;
  unreportedCostUsd?: number;
  failureKind?: LlmFailureKind;
  durationMs?: number;
  attempt: number;
  outcome: 'accepted' | 'reverted';
  before: FixDiagnostic[];
  after: FixDiagnostic[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  explanation: string;
  diff?: string;
}
export interface TestResult {
  /** The workspace the run is reported under; a shared configuration reports under its directory. */
  workspace: string;
  status: 'passed' | 'failed' | 'missing' | 'timeout';
  output: string;
  /** What ran, as typed from the run's directory. Absent when nothing could be run. */
  command?: string;
  /** How the scope was chosen: a script, the tests related to the affected files, a directory. */
  scope?: string;
  /** Workspaces this run answers for. */
  covers?: string[];
  /** `270 tests in 41 files`, when the runner printed its counts. */
  summary?: string;
  /** Integration and end-to-end test files left out because they need services (the default). */
  notRun?: { files: number; needs: string[] };
  /** With `--with-services`: the services the run was allowed to reach, and where. */
  services?: { names: string[]; targets: string[] };
  /**
   * Test files that failed on the first attempt and passed when the run was repeated once. Only
   * failures outside the affected files are retried: those are the flaky ones, not ours.
   */
  retried?: string[];
  /**
   * The run failed, but the same test files failed before anything changed (a missing generated
   * client, a service the tests expect): the repository's problem, not the migration's. The
   * files, or `['*']` when the runner named none.
   */
  preexisting?: string[];
  /**
   * The scoped run (the runner's related tests) failed without a failing test, or found no
   * related test, and the repository's own suite ran instead (`ranInstead`, which `command`
   * names too): the scoped command and the end of what it printed.
   */
  fallback?: {
    command: string;
    reason: 'failed' | 'no-related';
    output: string;
    ranInstead: string;
  };
}
/**
 * The repository's own `build` script, run after the bump when no pack covers the upgrade: the
 * type-check does not see build configuration, and a build does.
 */
export interface BuildResult {
  /** Workspace preparation before the baseline; absent for builds after the bump. */
  phase?: 'baseline';
  workspace: string;
  status: 'passed' | 'failed' | 'missing' | 'timeout';
  /** What ran, from the workspace's directory. Absent when there was no build script. */
  command?: string;
  /** The package.json script that ran (`build-ci`), chosen by `verify.build` or the defaults. */
  script?: string;
  /**
   * Why it failed before the framework's own build started, when the output says so:
   * `needs DATABASE_URL`, `needs a database`. The fix is a script that builds without it.
   */
  cause?: string;
  /** The end of what it printed, or why nothing ran. */
  output: string;
}
/** The repository's own lint (biome, prettier, eslint) run on the files the migration edited. */
export interface LintResult {
  tool: string;
  /** `pre-existing`: it fails now and failed on the same files before the migration. */
  status: 'passed' | 'failed' | 'pre-existing';
  command: string;
  /** How many files it was run on. */
  files: number;
  /** What the tool printed when it did not pass. */
  output: string;
}
/** What an `--agent sdk` session says it did, in the structured summary it ends with. */
export interface AgentSummary {
  changed: { file: string; what: string }[];
  newFiles: string[];
  decisions: string[];
  assumptions: string[];
  couldNotDo: string[];
}
/** One SDK session over the package's manual sites, measured, and the gate's verdict. */
export interface AgentTaskRecord {
  id: string;
  rule: string;
  files: string[];
  sites: number;
  fixed: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  unreportedCostUsd?: number;
  durationMs: number;
  toolCalls: Record<string, number>;
  gate: 'accepted' | 'rejected' | 'no-change' | 'error';
  rejection?: string;
  /** Undeclared new files removed before validating and checking the remaining edits. */
  discardedFiles?: string[];
  /** The SDK's stop reason when it did not finish cleanly (`error_max_budget_usd`). */
  stop?: string;
  /** How many single-site tasks shared this task's gate. */
  batch?: number;
  /** Accepted file diffs captured before the task's working tree can change. */
  diffs?: Record<string, string>;
  summary?: AgentSummary;
}
export interface FixRequest {
  finding: Finding;
  guide: string;
  enclosingFunction: string;
  source: string;
  compilerError: string;
  relatedDeclarations?: (RelatedDeclaration & { source: string })[];
  sharedDiagnostics?: Pick<FixDiagnostic, 'file' | 'line' | 'code' | 'message'>[];
  retry?: string;
}
export interface FixResponse {
  responseModel?: string;
  reservationUsd?: number;
  failureKind?: LlmFailureKind;
  retryAfterMs?: number;
  failure?: string;
  halt?: boolean;
  /** Budget retained for a call whose API did not report usage. */
  unreportedCostUsd?: number;
  diff: string;
  explanation?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}
export interface Fixer {
  readonly id: string;
  readonly provider?: Provider;
  /** Worst-case USD reservation, including the output cap. Required for budgeted calls. */
  estimate?(input: FixRequest): number;
  fix(input: FixRequest, remainingUsd?: number): Promise<FixResponse>;
}
export interface FixReport {
  rootPins?: RootPin[];
  /** Pack pipeline limitations: agent-led results can be published only as drafts. */
  agentFallback?: string[];
  /** A local candidate smoke run; never eligible for publication. */
  packWarning?: 'candidate pack, not verified';
  peerConflicts?: PeerBlockerGroup[];
  /** From the check `fix` ran: importing files the memory cap left out, per workspace. */
  importersNotAnalyzed?: ImportersNotAnalyzed[];
  /** `generic`: no pack covers the upgrade; every edit is the agent's, verified by the compiler. */
  tier?: Tier;
  lockfile?: InstallReport;
  repo: string;
  package: string;
  target: string;
  /** Where the target came from: asked for, the npm `latest` dist-tag, or the pack's tested target offline. */
  targetSource?: 'requested' | 'latest on npm' | 'release-age policy' | "the pack's tested target";
  /** Why the target is older than the newest release: the repository's release-age policy. */
  releaseAge?: string;
  from?: string;
  /** What moved with it, at the versions that agree with the target, and why (`check/companions.ts`). */
  companions?: { name: string; from: string; to: string; reason: string; required?: true }[];
  /** Packages of the same scope left where they are, and why (`check/companions.ts`). */
  companionStays?: string[];
  /** Required moves only a new major makes, never made (`check/required.ts`). */
  companionBlockers?: string[];
  /** `@types` stubs removed instead of upgraded, and why (`check/removed.ts`). */
  companionRemovals?: { name: string; from: string; reason: string }[];
  /** `pin`: no upgrade; the SDK's default API version was written on every client (`--pin-current-api`). */
  mode?: 'pin';
  /** The API version the pin run wrote. */
  apiVersion?: string;
  uptideVersion?: string;
  uptideCommit?: string;
  uptideDirty?: boolean;
  verifiedAt?: string;
  verificationTimingMs?: number;
  head?: string;
  /** Committed tree checked by verification; required before publication. */
  verifiedTree?: string;
  /** Export failed; the verified work remains in the kept clone. */
  exportError?: string;
  /** A fresh export used a numbered branch to preserve this existing branch. */
  branchRenamedFrom?: string;
  baseHead?: string;
  changedFiles?: string[];
  verificationPending?: boolean;
  branch: string;
  sites: FixSite[];
  /** Generated code produced in the clone before the baseline (a Prisma client), per workspace. */
  generated?: {
    workspace: string;
    command: string;
    status: 'generated' | 'failed' | 'timeout';
    output?: string;
  }[];
  verification: {
    baseline: FixDiagnostic[];
    target: FixDiagnostic[];
    after: FixDiagnostic[];
    newErrors: FixDiagnostic[];
    baselineTests: TestResult[];
    tests: TestResult[];
    /** The pack requires a successful build, including on later verification runs. */
    buildRequired?: boolean;
    /** Workspace preparation and builds required by a pack or the generic path. */
    build?: BuildResult[];
    baselineBuild?: BuildResult[];
    /** Lint of the edited files with the repository's own tools; a new failure fails verification. */
    lint?: LintResult[];
    /** Formatters run on the edited files (`biome`, `prettier`), when any changed them. */
    formatted?: string[];
    passed: boolean;
    /** Set when the baseline could not see packages the repository installs: no type verdict holds. */
    typesUnverified?: string;
    workspaceTypes?: { workspace: string; errors: number }[];
    /** The repository before the upgrade (`fix/baseline.ts`): unhealthy means compare, not prove. */
    baselineHealth?: BaselineHealth;
  };
  llm: {
    provider?: Provider;
    model?: string;
    /** Worst-case reservation for calls with no trustworthy usage. Not reported spend. */
    unreportedCostUsd?: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    available: boolean;
    disabled?: boolean;
    /** Set when `--max-cost` stopped the agent: the limit and unfinished sites (including stopped retries). */
    costLimit?: { limitUsd: number; notAttempted: number };
    /** Agent SDK sessions (the Anthropic default) instead of the patch agent. */
    agent?: 'sdk';
    /** The SDK would have been the default but is not installed: the patch agent ran. */
    sdkMissing?: true;
    tasks?: AgentTaskRecord[];
    feedback?: { roundsUsed: number; maxRounds: number; maxCostUsd: number };
  };
  timingMs: number;
  prBody: string;
  /** The migration report as a page, written by the CLI next to the stored run. */
  html?: string;
  /** The starting branch, or commit when detached; independent of the PR's target branch. */
  base?: string;
  /** `--base`: the branch the PR is opened against, when not the target repository's default. */
  prBase?: string;
  prUrl?: string;
  /** Set when `--pr` was asked for and refused: why nothing was pushed. The branch stays local. */
  /** What the publish step printed (the plan, warnings): shown by the caller once nothing else is drawing. */
  publicationLog?: string;
  publication?: {
    refused: string[];
    /** The publish step itself failed (push, `gh`): the run is in the repository, `uptide pr` retries. */
    failed?: string;
  };
  notes: string[];
  behavior?: BehaviorResult[];
  reviewSections?: ReviewSection[];
  /** What the pack knew about this repository (versions, evidence): review material is made from it. */
  packContext?: PackContext;
  /** The provider's API changelog between the pinned versions, counted against this code. */
  apiChanges?: ApiChangeFacts;
  /** Pack-provided decisions from facts of this repository, rendered under "Decisions for you". */
  decisions?: string[];
  /** The rules `decisions` speaks for: an agent's restatement of one is not said again. */
  decidedRules?: string[];
  /** One owner decision the pack says first, at the top of the PR body (`MigrationPack.headline`). */
  headline?: Headline;
  /** The user's checkout the run was made for; `repo` is the private clone it ran in. */
  source?: string;
  /** The temporary clone the run used: removed when no longer needed, kept (with why) otherwise. */
  clone?: { path: string; kept: boolean; reason?: string };
  /** What changed in the user's checkout during the run. Never expected; blocks publication. */
  sourceChanged?: string[];
  /** `origin` of the repository the run belongs to, normalized to its https URL. */
  remote?: string;
}

/** Review material from a pack: lines always shown, and lists that may be shortened to fit. */
export interface ReviewSection {
  title: string;
  lines: string[];
  /**
   * Long lists, most important first (a changelog: breaking entries first). In a PR body
   * they lose items from the end when the body would exceed GitHub's limit; `more` is the
   * line that stands for what is left out, `{n}` its count. The migration page has them all.
   */
  lists?: { summary: string; items: string[]; more: string }[];
}
