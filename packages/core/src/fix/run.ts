import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { workspacePackagesOf } from '../adapters/typescript/repo.js';
import { type CheckOptions, check } from '../check/check.js';
import { compareVersions } from '../check/version.js';
import type { PackageFetcher } from '../domain/io.js';
import { type ProgressListener, progress } from '../domain/progress.js';
import type { CheckReport, Finding } from '../domain/report.js';
import { SafetyRefusal, UptideError } from '../errors.js';
import { createNpmFetcher } from '../fetch/npm-fetcher.js';
import { loadRegistryConfig } from '../fetch/npmrc.js';
import { installedPackageDir } from '../list/evidence.js';
import { ACCEPTED_KEYS, selectLlm } from '../llm/config.js';
import {
  type CostSetting,
  costEstimate,
  DEFAULT_MAX_COST_USD,
  describeEstimate,
  overEstimateMessage,
  providerFixer,
  sdkCostEstimate,
} from '../llm/fixer.js';
import { nanos } from '../llm/pricing.js';
import { packageChangelog, usedNames } from '../packs/changelog.js';
import { decidedRules, decisionInventory, packDecisions } from '../packs/decisions.js';
import { genericPack } from '../packs/generic.js';
import {
  activePack,
  activePacks,
  assertCandidateLocal,
  CANDIDATE_WARNING,
  candidatePack,
  withCompanionPacks,
} from '../packs/index.js';
import { leadName } from '../packs/leads.js';
import { applicable, type RecordSite, recordDecisions, recordSites } from '../packs/records.js';
import { payloadApiVersions, stripeUsageContext } from '../packs/stripe/relevance.js';
import type { MigrationPack, PackContext } from '../packs/types.js';
import { resetSharedState } from '../shared-state.js';
import { prepareWorkspace } from '../verify/prepare-workspace.js';
import { UPTIDE_COMMAND, uptideVersionInfo } from '../version.js';
import { assist } from './assisted.js';
import { baselineHealth, testsOrBuildVouch, upgradeBrokeBuild } from './baseline.js';
import { behaviorCheck } from './behavior.js';
import { buildWorkspaces, configuredBuildScript } from './build.js';
import {
  assistedPeerPreflight,
  assistedRootPins,
  fallbackReport,
  feedbackFiles,
  feedbackPatchRunner,
  trimOutput,
  verificationFeedback,
} from './feedback.js';
import { fileTransaction } from './file-transaction.js';
import { type Generated, generateClients } from './generate.js';
import { assertManagerAvailable } from './managers/availability.js';
import { assertNpmLockSync } from './managers/npm-sync.js';
import type { InstallReport, Upgrade } from './managers/upgrade.js';
import { isMajorUpgrade, NO_PACK_YET } from './no-pack.js';
import { groupPeerBlockers, type PeerPlan, writePeerOverrides } from './peer-preflight.js';
import { pinCurrentApi } from './pin.js';
import { command, git, projectRoot } from './process.js';
import { publicationBlockers } from './publish.js';
import { changeRule, editDiff, prBody } from './report.js';
import { describeRootPin, planRootPins, writeRootPins } from './root-pins.js';
import { assistWithSdk, sdkRequired, sdkUnavailable, type TaskRunner } from './sdk-agent.js';
import { selectedFindings } from './select.js';
import { applyFollowUps, commit, type Followed, safeFile, settle } from './settle.js';
import { formatFiles, lintFiles } from './style.js';
import { type ResolvedTarget, resolveTarget } from './target.js';
import type {
  BuildResult,
  FixDiagnostic,
  Fixer,
  FixPhase,
  FixReport,
  FixRunKind,
  FixSite,
  LintResult,
  TestResult,
} from './types.js';
import {
  clearing,
  describeServices,
  diagnostics,
  gitLineMoves,
  markPreexisting,
  newDiagnostics,
  planTests,
  type TestOptions,
  testArtifacts,
  testWorkspaces,
  typeChecker,
  typeResolutionFailure,
  untrackedFiles,
} from './verify.js';
import {
  assertInstalledVersions,
  assertNoDowngrades,
  bumpVersions,
  declareLead,
  install,
  packageManager,
  removeDeclarations,
  validateVersionRanges,
} from './versions.js';

export interface FixOptions {
  /** Use registered candidates locally; incompatible with publication. */
  allowCandidate?: boolean;
  onProgress?: ProgressListener;
  cwd: string;
  provider?: string;
  model?: string;
  /** Any direct dependency: one with a pack (zod, stripe) or, with the agent, any other. */
  only: string;
  also?: string[];
  allowPeer?: string[];
  /** Explicit pin consent; otherwise PR runs may update pins unless uptide.yml opts out. */
  updatePins?: boolean;
  /** Set for an agent-led run: pins Uptide cannot update safely stay as written (UPT-102). */
  unsafePins?: 'leave';
  /** Frozen read-only plan made before the CLI clone. */
  peerPlan?: PeerPlan;
  /** Read-only planning failed before isolation; continue with the lead and record why. */
  plannerFailure?: string;
  /** Preflight refusals an agent continues past with the plan intact (UPT-78): a draft. */
  agentLed?: string[];
  target?: string;
  includeDeprecated?: boolean;
  pr?: boolean;
  /**
   * The run is meant to be published once it is delivered (`--pr` run in a clone, which then
   * publishes itself): a run that could never be published is refused before it starts.
   */
  forPublication?: boolean;
  yes?: boolean;
  fixer?: Fixer | null;
  testTimeoutMs?: number;
  pack?: MigrationPack;
  /**
   * Also run tests that need a database, a cache or a queue. Off by default; with it, `yes`
   * must confirm the services and connection targets that were printed.
   */
  withServices?: boolean;
  /**
   * stripe only: no upgrade. Write the installed SDK's default API version on every client
   * created without `apiVersion`: zero behaviour change, the smallest PR.
   */
  pinCurrentApi?: boolean;
  /**
   * Assisted-fix budget: SDK tasks may overshoot by one turn; patch calls reserve their
   * worst-case cost. Unfinished sites stay manual. Default: 1 USD for every package. A
   * preflight estimate above it stops the run before any agent call.
   */
  maxCostUsd?: number;
  /** `maxCost`: the limit comes from uptide.yml (Action, App), so messages name that setting. */
  costSetting?: CostSetting;
  /**
   * Action and App runs: no preflight cost stop, since nobody is there to rerun with a higher
   * limit. The agent works within the limit and the report says what is left.
   */
  withinBudget?: boolean;
  /** The package.json script a required build runs (`verify.build`); default: the clone's uptide.yml, else build:ci, build-ci, build. */
  buildScript?: string;
  /**
   * `sdk` runs assisted fixes in one Claude Agent SDK session per package.
   * Default for authenticated Anthropic runs without a supplied fixer; otherwise `patch`.
   */
  agent?: 'patch' | 'sdk';
  /** The build doing the work; injected by tests, which run from a checkout under development. */
  tool?: ReturnType<typeof uptideVersionInfo>;
}
/** Small I/O seams let tests exercise the real transaction without registry or an LLM. */
export interface FixServices {
  check(options: CheckOptions): Promise<CheckReport>;
  // biome-ignore lint/suspicious/noConfusingVoidType: injected installers may deliberately return no report
  install(root: string, upgrade?: Upgrade): Promise<InstallReport | void>;
  diagnostics(root: string, workspaces: string[]): FixDiagnostic[];
  /** `files`: repository-relative paths the migration touches, to scope the run to related tests. */
  tests(
    root: string,
    workspaces: string[],
    timeoutMs?: number,
    files?: string[],
    options?: TestOptions,
  ): Promise<TestResult[]>;
  /** The repository's formatter on these files only; returns the formatters that ran. */
  format?(root: string, files: string[]): Promise<string[]>;
  /** The repository's lint on these files; `baseline` marks failures that were already there. */
  lint?(root: string, files: string[], baseline?: LintResult[]): Promise<LintResult[]>;
  /** The repository's build runner for workspace preparation and required verification builds. */
  build?: typeof buildWorkspaces;
  /** Generated code the repository needs before it can be measured (a Prisma client). */
  generate?(root: string, workspaces: string[]): Promise<Generated[]>;
  /** A dist-tag to an exact version (`latest`); the registry by default. */
  resolve?(name: string, tag: string): Promise<string>;
  /** Registry manifests for companion range preflight, before cloning. */
  manifests?: PackageFetcher['manifests'];
  /** Full manifests, for whether a version ships its own types (`check/removed.ts`). */
  metadata?: PackageFetcher['metadata'];
  /** `--agent sdk` sessions; the Claude Agent SDK by default. */
  agentRunner?: TaskRunner;
  /** Why the optional SDK cannot run, or undefined when it can; a reason stops the run. */
  sdkUnavailable?: () => Promise<string | undefined>;
  /** The publish step of a `--pr` run; `publishVerified` by default. */
  publish?(
    result: FixReport,
    options: { tool: { uptideDirty: boolean }; yes?: boolean; cwd?: string },
  ): Promise<void>;
}
const defaults: FixServices = { check, install, diagnostics, tests: testWorkspaces };
/**
 * `--with-services` runs the repository's tests against whatever its setup connects to. That is
 * never done on a guess: the services and targets are named, and `--yes` has to confirm them.
 */
export function confirmServices(
  root: string,
  options: { withServices?: boolean; yes?: boolean },
): void {
  if (!options.withServices || options.yes) return;
  const reach = describeServices(root, workspacePackagesOf(root));
  if (reach.length === 0) return;
  throw new UptideError(
    'SERVICES_NOT_CONFIRMED',
    `--with-services would run tests against:\n${reach.map((l) => `  ${l}`).join('\n')}\nNothing ran. Add --yes to confirm these services and run.`,
  );
}
/** `git@github.com:owner/repo.git` and its https form are the same repository. */
export function normalizeRemote(url: string): string {
  return url
    .trim()
    .replace(/\.git$/, '')
    .replace(/^git@([^:]+):/, 'https://$1/')
    .replace(/^ssh:\/\/git@/, 'https://');
}
function originOf(root: string): string | undefined {
  try {
    return normalizeRemote(git(root, 'remote', 'get-url', 'origin')) || undefined;
  } catch {
    return undefined;
  }
}
/** Compatibility alias: the same default now applies to all packages. */
export const GENERIC_MAX_COST_USD = DEFAULT_MAX_COST_USD;
/**
 * One package's migration. A failure leaves no shared TypeScript state behind: whatever a
 * caller runs next in this process (the Action fixes each detected upgrade in turn) starts
 * as in a new process (shared-state.ts).
 */
export async function fix(
  options: FixOptions,
  services: FixServices = defaults,
): Promise<FixReport> {
  try {
    assertCandidateLocal(options);
    // Asked for by an alternate lead's name (`react-router-dom`), the pack's lead is fixed.
    const only = leadName(
      options.only,
      options.pack ? [options.pack] : activePacks(options.allowCandidate),
    );
    return await fixPackage(only === options.only ? options : { ...options, only }, services);
  } catch (err) {
    resetSharedState();
    throw err;
  }
}

async function fixPackage(options: FixOptions, services: FixServices): Promise<FixReport> {
  const started = Date.now();
  // Each phase ends where the next begins, so together they are the run's wall time.
  const phases: FixPhase[] = [];
  let lapped = started;
  let runs: NonNullable<FixPhase['runs']> = {};
  const lap = (name: FixPhase['name'], costUsd?: number): void => {
    const now = Date.now();
    phases.push({
      name,
      ms: now - lapped,
      ...(costUsd !== undefined ? { costUsd } : {}),
      ...(Object.keys(runs).length ? { runs } : {}),
    });
    lapped = now;
    runs = {};
  };
  // The repository's commands each phase runs, counted where they are called.
  const timed =
    <A extends unknown[], R>(kind: FixRunKind, work: (...args: A) => R) =>
    (...args: A): R => {
      const start = Date.now();
      const done = (): void => {
        const entry = runs[kind] ?? { count: 0, ms: 0 };
        entry.count++;
        entry.ms += Date.now() - start;
        runs[kind] = entry;
      };
      const result = work(...args);
      if (result instanceof Promise) return result.finally(done) as R;
      done();
      return result;
    };
  // Every build the run executes, preparation and verification, with its wall time.
  const buildRuns = { count: 0, ms: 0 };
  const timedBuild: typeof buildWorkspaces = timed('build', async (...args) => {
    const start = Date.now();
    try {
      const results = await (services.build ?? buildWorkspaces)(...args);
      buildRuns.count += results.filter((b) => b.command).length;
      return results;
    } finally {
      buildRuns.ms += Date.now() - start;
    }
  });
  const root = realpathSync(resolve(options.cwd));
  if (
    options.maxCostUsd !== undefined &&
    (!Number.isFinite(options.maxCostUsd) || options.maxCostUsd <= 0)
  )
    throw new Error('--max-cost must be a positive finite amount in USD');
  const selection = selectLlm(root, options);
  const sdkDefault =
    options.agent === undefined &&
    options.fixer === undefined &&
    selection.provider === 'anthropic' &&
    selection.available;
  const sdkAgent = options.fixer !== null && (options.agent === 'sdk' || sdkDefault);
  if (sdkAgent && selection.provider !== 'anthropic')
    throw new UptideError(
      'NO_FIXER',
      `--agent sdk runs on Anthropic models only; ${selection.provider} keeps the default agent`,
    );
  if (sdkAgent && !selection.available && !services.agentRunner)
    throw new UptideError('NO_FIXER', '--agent sdk needs ANTHROPIC_API_KEY');
  // Never a fallback to the patch executor: an SDK that cannot run stops the run before any clone.
  const sdkMissing =
    sdkAgent && !services.agentRunner
      ? await (services.sdkUnavailable ?? sdkUnavailable)()
      : undefined;
  if (sdkMissing) throw new UptideError('SDK_UNAVAILABLE', sdkRequired(sdkMissing));
  let pack =
    options.pack ?? activePack(options.only, options.allowCandidate) ?? genericPack(options.only);
  if (pack.name !== options.only) throw new Error(`no migration pack for ${options.only}`);
  const fixer = options.fixer === null ? undefined : (options.fixer ?? providerFixer(selection));
  // Without a pack every edit is the agent's: no agent, nothing this command can do.
  const needsAgent = (candidate: MigrationPack): void => {
    if (candidate.rules.length === 0 && !fixer)
      throw new UptideError(
        'NO_FIXER',
        `${candidate.name} has no migration pack, so every fix would come from the agent, and ${options.fixer === null ? 'assisted fixes are off (--no-llm)' : `no selected-provider API key is set; accepted environment variables: ${ACCEPTED_KEYS}`}`,
      );
  };
  needsAgent(pack);
  projectRoot(root);
  if (git(root, 'status', '--porcelain', '--untracked-files=all'))
    throw new UptideError('DIRTY_WORKING_TREE', 'uptide fix requires a clean working tree');
  confirmServices(root, options);
  if (options.pinCurrentApi) return pinCurrentApi(options, services, originOf);
  const tool = options.tool ?? uptideVersionInfo();
  // A PR records the Uptide commit that produced it; uncommitted changes make that a lie.
  if (options.pr && tool.uptideDirty)
    throw new UptideError(
      'DIRTY_UPTIDE_TREE',
      `uptide fix --pr refuses to run from an Uptide checkout with uncommitted changes (at ${tool.uptideCommit.slice(0, 12)}); commit or stash them, rebuild, and run again`,
    );
  if (!options.pinCurrentApi) assertNpmLockSync(root);
  const fallback: string[] = options.plannerFailure ? [options.plannerFailure] : [];
  const canAssist = sdkAgent || !!fixer;
  const agentLed = [...(options.agentLed ?? [])];
  let peerPlan = options.peerPlan;
  if (!peerPlan && !options.plannerFailure) {
    try {
      const planned = await assistedPeerPreflight(options, services, undefined, canAssist);
      options = planned.options;
      peerPlan = planned.plan;
      if (planned.reason) agentLed.push(planned.reason);
    } catch (error) {
      if (!canAssist || error instanceof SafetyRefusal) throw error;
      fallback.push(
        `Planner refused; upgrading the lead only: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  // Without an injected resolver, the repository's own registry and release-age policy.
  const registry = services.resolve
    ? undefined
    : createNpmFetcher({ config: loadRegistryConfig({ cwd: root }) });
  const resolved: ResolvedTarget = peerPlan
    ? {
        version: peerPlan.target,
        source: peerPlan.targetSource,
        ...(peerPlan.releaseAge ? { releaseAge: peerPlan.releaseAge } : {}),
      }
    : await resolveTarget(pack, options.target, services.resolve ?? registry?.resolve, registry);
  const target = resolved.version;
  validateVersionRanges(root, [{ name: pack.name, to: target }]);
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(target))
    throw new Error('target must be an exact version');
  assertNoDowngrades(root, [{ name: pack.name, to: target }, ...(peerPlan?.companions ?? [])]);
  const pinPlan = assistedRootPins(
    options,
    (o) =>
      planRootPins(root, [{ name: pack.name, to: target }, ...(peerPlan?.companions ?? [])], o),
    canAssist,
  );
  options = pinPlan.options;
  agentLed.push(...pinPlan.reasons);
  // A peer blocker moved across a major its pack covers: that pack's rules run here too.
  const companionPacks = (peerPlan?.companions ?? []).flatMap((c) => {
    const companion =
      c.migration === 'pack' ? activePack(c.name, options.allowCandidate) : undefined;
    return companion ? [{ pack: companion, to: c.to }] : [];
  });
  const branch = `uptide/${pack.name}-${target}`;
  packageManager(root);
  if (services.install === install) await assertManagerAvailable(root);
  const defaultDiagnostics = services.diagnostics === diagnostics;
  services = {
    ...services,
    install: timed('install', services.install),
    diagnostics: timed('types', services.diagnostics),
    tests: timed('tests', services.tests),
    lint: timed('lint', services.lint ?? lintFiles),
    format: timed('format', services.format ?? formatFiles),
    generate: timed('generate', services.generate ?? generateClients),
  };
  // Generated clients and consumed workspace builds, before the planner compiles anything.
  const prepared = await prepareWorkspace(root, workspacePackagesOf(root), {
    build: timedBuild,
    generate: services.generate ?? generateClients,
    buildScript: options.buildScript,
    onProgress: options.onProgress,
  });
  const generated = prepared.generated;
  const workspaceBuilds: BuildResult[] = prepared.builds.map((result) => ({
    ...result,
    phase: 'baseline' as const,
  }));
  const report = await services
    .check({
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      cwd: root,
      only: [pack.name, ...companionPacks.map((c) => c.pack.name)],
      // The lead's pack speaks for its group in check: its companions' detect rules run too.
      ...(companionPacks.length
        ? {
            packs: [
              withCompanionPacks(
                pack,
                companionPacks.map((c) => c.pack),
              ),
              ...activePacks(options.allowCandidate).filter((p) => p.name !== pack.name),
            ],
          }
        : {}),
      targets: {
        [pack.name]: target,
        ...Object.fromEntries(companionPacks.map((c) => [c.pack.name, c.to])),
      },
      runtime: false,
      plan: false,
      ...(options.allowCandidate ? { allowCandidate: true } : {}),
      workspaceConcurrency: 1,
    })
    .catch((error: unknown) => {
      if (!canAssist || error instanceof SafetyRefusal) throw error;
      const reason = `Planner refused: ${error instanceof Error ? error.message : String(error)}`;
      fallback.push(reason);
      return fallbackReport(root, pack.name, target, reason);
    });
  let packages = report.packages.filter(
    (p) => p.name === pack.name && !p.notes.includes('up to date'),
  );
  if (!packages.length) {
    // Installed below the target, yet the check returned nothing to work from: say that.
    const behind = fallbackReport(root, pack.name, target, '').packages.filter(
      (p) => p.installed !== 'unknown' && compareVersions(p.installed, target) < 0,
    );
    if (!behind.length) throw new Error(`${pack.name} has no upgrade to ${target}`);
    const reason = `the check returned nothing to analyze for ${pack.name} ${behind[0]?.installed} → ${target} (no import or pack site found)`;
    if (!canAssist) throw new UptideError('INCOMPLETE_CHECK', `${reason}. Nothing was changed.`);
    fallback.push(`Planner refused: ${reason}`);
    packages = fallbackReport(root, pack.name, target, reason).packages.filter((p) =>
      behind.some((b) => b.workspace === p.workspace),
    );
  }
  // A pack that does not cover this upgrade (zod 4 → 4) leaves it to the generic path.
  if (
    !options.pack &&
    !fallback.length &&
    packages.some((p) => !pack.supports(p.installed, target))
  ) {
    pack = genericPack(options.only);
    needsAgent(pack);
  }
  let generic = pack.rules.length === 0;
  const lowest = [...packages].sort((a, b) => compareVersions(a.installed, b.installed))[0];
  // Nothing analyzed a major upgrade without a pack: it is never published, so a --pr run
  // spends nothing on it (no-pack.ts).
  if (
    generic &&
    !fallback.length &&
    (options.pr || options.forPublication) &&
    isMajorUpgrade(lowest?.installed, target)
  )
    throw new UptideError(
      'PUBLICATION_REFUSED',
      `${NO_PACK_YET}: ${pack.name} ${lowest?.installed ?? 'unknown'} → ${target} is a major upgrade, and Uptide opens a pull request for one only with a verified migration pack. Nothing was changed.`,
    );
  for (const p of packages) {
    if (!fallback.length && !pack.supports(p.installed, target))
      throw new Error(`${pack.name} pack does not support ${p.installed} → ${target}`);
    if (
      ['skipped', 'no-types', 'private', 'unknown', 'partial'].includes(p.status) ||
      p.compile?.skipped ||
      p.unanalyzed.length
    ) {
      const reason = `incomplete check: ${p.name} ${p.notes.join('; ')}`;
      if (!canAssist) throw new UptideError(p.skipReason ?? 'INCOMPLETE_CHECK', reason);
      fallback.push(reason);
    }
  }
  // What moves with it (check/companions.ts): one install at versions that agree, or none.
  const conflicts = [...new Set(packages.flatMap((p) => p.companionConflicts ?? []))];
  const stays = [...new Set(packages.flatMap((p) => p.companionStays ?? []))].sort();
  // A required move only a new major makes is never made: the PR says so instead.
  const blockers = [...new Set(packages.flatMap((p) => p.companionBlockers ?? []))].sort();
  // A `@types` stub the new version makes redundant goes, in the same install (check/removed.ts).
  const removals = [
    ...new Map(packages.flatMap((p) => p.companionRemovals ?? []).map((r) => [r.name, r])).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
  if (conflicts.length > 0 && !canAssist)
    throw new UptideError(
      'INCONSISTENT_UPGRADE',
      `${pack.name} ${target} cannot be installed consistently: ${conflicts.join('; ')}. Nothing was changed.`,
    );
  if (conflicts.length) fallback.push(`Planner refused: ${conflicts.join('; ')}`);
  if (fallback.length) {
    pack = genericPack(options.only);
    generic = true;
    removals.length = 0;
  }
  const companions = fallback.length
    ? []
    : [
        ...new Map(
          (peerPlan?.companions ?? packages.flatMap((p) => p.companions ?? [])).map((c) => [
            c.name,
            c,
          ]),
        ).values(),
      ].sort((a, b) => a.name.localeCompare(b.name));
  const sitePack = withCompanionPacks(
    pack,
    companionPacks.filter((c) => companions.some((m) => m.name === c.pack.name)).map((c) => c.pack),
  );
  // Refused before the clone, continued by the agent: the pack and the plan still apply.
  fallback.push(...agentLed);
  assertNoDowngrades(root, [{ name: pack.name, to: target }, ...companions]);
  const pins = planRootPins(root, [{ name: pack.name, to: target }, ...companions], options);
  for (const pin of pins)
    options.onProgress?.({
      phase: 'resolve',
      state: 'done',
      warning: true,
      detail: describeRootPin(pin),
    });
  validateVersionRanges(root, [{ name: pack.name, to: target }, ...companions]);
  const initialContext = {
    from: lowest?.installed ?? '',
    to: target,
    includeDeprecated: options.includeDeprecated ?? false,
  };
  let packContext: PackContext = pack.resolveContext
    ? await pack.resolveContext(initialContext)
    : initialContext;

  // Workspaces that declare the package, and those that import it without declaring it and
  // were analyzed: their sites are in the report, so their types and tests are verified too.
  const importers = new Set(
    packages.flatMap((p) => (p.importers ?? []).filter((i) => i.analyzed).map((i) => i.workspace)),
  );
  const workspaces = workspacePackagesOf(root).filter((w) => {
    const p = JSON.parse(readFileSync(join(root, w, 'package.json'), 'utf8'));
    return (
      importers.has(w) ||
      ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].some(
        (s) => typeof p[s]?.[pack.name] === 'string',
      )
    );
  });
  if (pack.name === 'stripe')
    packContext = {
      ...packContext,
      ...(await stripeUsageContext(root, workspaces, initialContext.from)),
      payloadVersions: payloadApiVersions(root, workspaces),
    };
  packContext = { ...packContext, inventory: decisionInventory(root, workspaces, pack) };
  if (pack.scanContext) packContext = { ...packContext, ...pack.scanContext(root, workspaces) };
  // Each moved companion pack gets the context the lead got, over its own versions.
  if (sitePack !== pack) {
    const moved = companionPacks.flatMap((c) => {
      const move = companions.find((m) => m.name === c.pack.name);
      return move ? [{ pack: c.pack, from: move.from, to: move.to }] : [];
    });
    const contexts: Record<string, PackContext> = {};
    for (const c of moved) {
      const base = { from: c.from, to: c.to, includeDeprecated: initialContext.includeDeprecated };
      const resolved: PackContext = c.pack.resolveContext
        ? await c.pack.resolveContext(base)
        : base;
      contexts[c.pack.name] = {
        ...resolved,
        inventory: decisionInventory(root, workspaces, c.pack),
        ...c.pack.scanContext?.(root, workspaces),
      };
    }
    packContext = { ...packContext, companions: contexts };
  }
  // Validate checked-in knowledge before any version or source write.
  sitePack.reviewSections?.(packContext);
  const verify = <T>(detail: string, work: () => T | Promise<T>): Promise<T> =>
    progress(options.onProgress, { phase: 'verify', package: pack.name, detail }, work);
  const names = (list: string[]): string =>
    list.map((w) => (w === '.' ? 'root' : (w.split('/').pop() ?? w))).join(', ');
  lap('analyze');
  const needsBuild = generic || pack.requiresBuild === true;
  // ponytail: what a build sees, as HEAD's tree plus the diff and untracked names over it; an
  // untracked file edited in place goes unseen.
  const treeState = (): string =>
    [
      git(root, 'rev-parse', 'HEAD^{tree}'),
      git(root, 'diff', 'HEAD'),
      git(root, 'status', '--porcelain', '--untracked-files=all'),
    ].join('\0');
  // A build leaves a clean tree as it found it.
  const keepClean = async <T>(work: () => Promise<T>): Promise<T> => {
    const clean = !git(root, 'status', '--porcelain', '--untracked-files=all');
    try {
      return await work();
    } finally {
      if (clean && git(root, 'status', '--porcelain', '--untracked-files=all')) {
        git(root, 'checkout', '--', '.');
        git(root, 'clean', '-fdq');
      }
    }
  };
  const runBuild = async (always = false, only = workspaces): Promise<BuildResult[]> => {
    if ((!needsBuild && !always) || !only.length) return [];
    return keepClean(async () => {
      try {
        return await verify(`build (${names(only)})`, () =>
          timedBuild(root, only, undefined, options.buildScript ?? configuredBuildScript(root)),
        );
      } catch (error) {
        return [
          {
            workspace: '.',
            status: 'failed',
            cause: 'build could not run',
            output: error instanceof Error ? error.message : String(error),
          },
        ];
      }
    });
  };
  const baselineBuild = await runBuild();
  const baseline = await verify(`types (${names(workspaces)})`, () =>
    services.diagnostics(root, workspaces),
  );
  // The same scope before and after: the files with reported sites decide which tests relate.
  // Without a pack only what has evidence is migrated: an unconfirmed site is not the agent's.
  const selected = [pack.name, ...(sitePack === pack ? [] : companionPacks.map((c) => c.pack.name))]
    .flatMap((name) => selectedFindings(report, name, options.includeDeprecated ?? false))
    .filter((f) => !generic || f.severity === 'breaking');
  const affected = [...new Set(selected.map((f) => f.usage.file))];
  // Evidence at a site the compiler rejected is confirmed evidence: the change is real there.
  if (packContext.evidence)
    packContext = { ...packContext, evidence: confirmedEvidence(packContext.evidence, selected) };
  // The sites a behavior record matched: the agent is told each one, the PR body decides them.
  const records = applicable(pack.records ?? [], initialContext.from, target);
  const matched = selected.flatMap((f) =>
    records.some((r) => r.id === f.rule)
      ? [
          {
            record: f.rule as string,
            file: f.usage.file,
            line: f.usage.line,
            snippet: f.usage.snippet.trim(),
          },
        ]
      : [],
  );
  if (matched.length) packContext = { ...packContext, recordSites: matched };
  const untracked = untrackedFiles(root);
  const baselineTests = await verify(`tests (${names(workspaces)})`, () =>
    services.tests(root, workspaces, options.testTimeoutMs, affected, {
      withServices: options.withServices === true,
      fullSuite: true,
    }),
  );
  const artifacts = testArtifacts(root, untracked);
  services = clearing(services, root, artifacts);
  // Lint of the same files before anything changes: a failure that is already there is not ours.
  const baselineLint = await (services.lint ?? lintFiles)(root, affected);
  lap('baseline');
  const baseHead = git(root, 'rev-parse', 'HEAD');
  git(root, 'switch', '-c', branch);
  // A workspace that reaches the lead only through an alternate lead declares it now.
  const declaredLead = declareLead(
    root,
    pack.name,
    (pack.alternateLeads ?? []).map((a) => a.name),
    target,
  );
  const bumps = [
    bumpVersions(root, pack.name, target),
    ...companions.map((c) => bumpVersions(root, c.name, c.to)),
    ...removals.map((r) => removeDeclarations(root, r.name)),
  ];
  const bump = {
    files: [
      ...new Set([
        ...declaredLead,
        ...bumps.flatMap((b) => b.files),
        ...writeRootPins(root, pins),
        ...writePeerOverrides(root, peerPlan?.conflicts ?? []),
      ]),
    ],
    workspaces: [...new Set(bumps.flatMap((b) => b.workspaces))],
  };
  const lockfile = await progress(
    options.onProgress,
    {
      phase: 'install',
      package: pack.name,
      detail: `${pack.name} ${target}${companions.length ? ` with ${companions.length} package${companions.length === 1 ? '' : 's'}` : ''}`,
    },
    () =>
      services.install(root, {
        name: pack.name,
        version: target,
        workspaces: bump.workspaces,
        files: bump.files.map((f) => relative(root, f)),
        ...(peerPlan?.conflicts.some((p) => p.allowed)
          ? {
              allowedPeers: [
                ...new Set(peerPlan.conflicts.filter((p) => p.allowed).map((p) => p.name)),
              ],
            }
          : {}),
        ...(companions.length
          ? { also: companions.map((c) => ({ name: c.name, version: c.to })) }
          : {}),
        ...(removals.length ? { remove: removals.map((r) => r.name) } : {}),
        ...(canAssist ? { acceptOutOfScope: true } : {}),
      }),
  );
  if (lockfile?.outOfScope?.length)
    fallback.push(
      `Install check: ${lockfile.outOfScope.length} lockfile resolution${lockfile.outOfScope.length === 1 ? '' : 's'} changed outside the upgrade's dependency subtree (listed for review)`,
    );
  assertInstalledVersions(root, [{ name: pack.name, to: target }, ...companions]);
  // The target's own CHANGELOG.md, from the copy just installed: no download of its own.
  const installedTarget = installedPackageDir(root, workspaces[0] ?? '.', pack.name);
  const changelog = installedTarget
    ? packageChangelog(installedTarget, {
        from: initialContext.from,
        to: target,
        names: [
          ...new Set(
            affected.flatMap((f) => {
              try {
                return usedNames(readFileSync(join(root, f), 'utf8'), pack.name);
              } catch {
                return [];
              }
            }),
          ),
        ],
      })
    : [];
  if (changelog.length) packContext = { ...packContext, changelog };
  const moved = companions.map((c) => `${c.name} ${c.to}`).join(', ');
  const dropped = removals.map((r) => r.name).join(', ');
  commit(
    root,
    `chore: upgrade ${pack.name} to ${target}${moved ? ` with ${moved}` : ''}${dropped ? `, remove ${dropped}` : ''}`,
    [...bump.files, join(root, packageManager(root).lockfile)],
  );
  // The install replaced node_modules, and what was generated into it with them.
  const consumedBuilds = {
    build: timedBuild,
    moved: [pack.name, ...companions.map((c) => c.name), ...removals.map((r) => r.name)],
    buildScript: options.buildScript,
    onProgress: options.onProgress,
  };
  const rebuilt = await prepareWorkspace(root, workspaces, {
    ...consumedBuilds,
    generate: services.generate ?? generateClients,
  });
  generated.push(...rebuilt.generated.map((g) => ({ ...g, phase: 'bump' as const })));
  let consumed = rebuilt.builds;
  let consumedAt = treeState();
  const targetChecker = sdkAgent && defaultDiagnostics ? typeChecker(root, workspaces) : undefined;
  const checkTarget = targetChecker
    ? timed('types', targetChecker.check)
    : () => services.diagnostics(root, workspaces);
  const targetErrors = await verify(`types (${names(workspaces)})`, checkTarget);
  lap('install');
  const sites: FixSite[] = [];
  const changed = new Set<string>();
  const rulesStarted = performance.now();
  options.onProgress?.({ phase: 'rules', package: pack.name, state: 'start' });
  const originals = new Map<string, string>();
  for (const finding of selected) {
    if (!existsSync(join(root, finding.usage.file))) {
      sites.push({
        finding,
        outcome: 'manual',
        reason: 'The anchored file was removed or renamed by an earlier edit.',
      });
      continue;
    }
    const file = safeFile(root, finding.usage.file);
    const original = readFileSync(file, 'utf8');
    if (!originals.has(finding.usage.file)) originals.set(finding.usage.file, original);
    let result = sitePack.transform(original, finding, {
      ...packContext,
      from: finding.change.from,
      to: target,
      includeDeprecated: options.includeDeprecated ?? false,
    });
    let editedFiles: string[] | undefined;
    if (result.applied && result.edits?.length) {
      const before = await checkTarget();
      const transaction = await fileTransaction(
        root,
        [{ kind: 'write', file: finding.usage.file, text: result.text }, ...result.edits],
        async () => {
          targetChecker?.clear();
          if (newDiagnostics(before, await checkTarget()).length) return false;
          const tests = await services.tests(
            root,
            workspaces,
            options.testTimeoutMs,
            [
              ...new Set([
                finding.usage.file,
                ...(result.edits ?? []).flatMap((edit) =>
                  edit.kind === 'rename' ? [edit.file, edit.to] : [edit.file],
                ),
              ]),
            ],
            { related: true, withServices: options.withServices === true },
          );
          return markPreexisting(tests, baselineTests).every(
            (test) => test.status === 'passed' || test.status === 'missing' || test.preexisting,
          );
        },
      );
      targetChecker?.clear();
      if (transaction.applied) {
        editedFiles = transaction.files;
        for (const name of transaction.files) changed.add(join(root, name));
      } else result = { ...result, applied: false, reason: transaction.reason };
    } else if (result.applied) {
      writeFileSync(file, result.text);
      changed.add(file);
    }
    const site: FixSite = {
      finding,
      outcome: result.applied ? 'mechanical' : 'manual',
      reason: result.reason,
      ...(result.applied ? { diff: editDiff(original, result.text) } : {}),
      ...(editedFiles ? { editedFiles } : {}),
    };
    site.rule =
      finding.rule ??
      result.rule ??
      sitePack.ruleOf?.(finding) ??
      changeRule({ package: pack.name }, site);
    sites.push(site);
  }
  options.onProgress?.({
    phase: 'rules',
    package: pack.name,
    state: 'done',
    ms: performance.now() - rulesStarted,
  });
  commit(root, `fix(${pack.name}): apply mechanical migrations`, [...changed]);
  // A helper several sites need is placed once, by rule, where every site can import it; the
  // agent then imports. One file written, its barrels updated, verified with the sites.
  for (const { helper, edits } of pack.sharedHelpers?.({
    root,
    workspaces,
    findings: selected,
    context: packContext,
  }) ?? []) {
    const files: string[] = [];
    // The site the helper answers for: a period read, whose rule the helper edit joins.
    const base =
      selected.find((f) => /current_period_(?:start|end)/.test(f.change.path)) ??
      selected.find((f) => /current_period_(?:start|end)/.test(f.usage.compileError ?? '')) ??
      (selected[0] as Finding);
    for (const edit of edits) {
      const file = safeFile(root, edit.file);
      const original = readFileSync(file, 'utf8');
      writeFileSync(file, edit.text);
      files.push(file);
      sites.push({
        finding: {
          ...base,
          usage: {
            ...base.usage,
            file: edit.file,
            line: edit.line ?? original.split('\n').length,
            column: 1,
            endLine: edit.text.split('\n').length,
            endColumn: 1,
            snippet: `${helper.name} shared from ${helper.file}`,
          },
        },
        outcome: 'mechanical',
        reason:
          edit.file === helper.file
            ? `${helper.name} placed here once, where every migrated file imports it`
            : `re-exports ${helper.name} so the sites can import it`,
        diff: editDiff(original, edit.text),
        rule: changeRule(
          { package: pack.name },
          { finding: base, outcome: 'mechanical', reason: '' },
        ),
      });
      if (!affected.includes(edit.file)) affected.push(edit.file);
    }
    commit(root, `fix(${pack.name}): add ${helper.name} to ${helper.file}`, files);
    packContext = { ...packContext, helpers: [...(packContext.helpers ?? []), helper] };
  }
  const pendingCompilerSites = sites.filter(
    (s) => s.outcome === 'manual' && s.finding.usage.compileError,
  );
  if (pendingCompilerSites.length && sites.some((s) => s.outcome === 'mechanical')) {
    const errorFiles = new Set((await verify('types after rules', checkTarget)).map((d) => d.file));
    for (const site of pendingCompilerSites) {
      const usage = site.finding.usage;
      if (
        !errorFiles.has(usage.file) &&
        targetErrors.some(
          (d) =>
            d.file === usage.file && (d.line === usage.line || d.message === usage.compileError),
        )
      ) {
        site.outcome = 'mechanical';
        site.reason = 'compiler error resolved by preceding rule-based edits';
      }
    }
  }
  lap('rules');
  // Before any agent call: what the sites left to the agent should cost, against the limit.
  // An estimate above it stops here, with nothing spent; the limit is never raised for it.
  const maxCostUsd = options.maxCostUsd ?? DEFAULT_MAX_COST_USD;
  const agentSites = sites.filter((s) => s.outcome === 'manual').length;
  const estimate = canAssist
    ? sdkAgent
      ? sdkCostEstimate(selection.provider, selection.model, sites, maxCostUsd, options.costSetting)
      : costEstimate(
          selection.provider,
          selection.model,
          agentSites,
          maxCostUsd,
          options.costSetting,
        )
    : undefined;
  if (estimate && !options.withinBudget && nanos(estimate.usd) > nanos(estimate.limitUsd))
    throw new UptideError('COST_ESTIMATE', overEstimateMessage(estimate));
  if (estimate && agentSites)
    options.onProgress?.({
      phase: 'assist',
      package: pack.name,
      state: 'done',
      warning: true,
      detail: `Agent ${describeEstimate(estimate)} (${estimate.setting === 'maxCost' ? 'maxCost in uptide.yml' : '--max-cost'})`,
    });
  // The agent's own run_tests, where a test script runs more than its runner's related tests
  // (`pnpm run build && pnpm run test:unit`): those tests alone. Its gate, and the final
  // verification after it, run what they always ran. Elsewhere the check is the gate's run,
  // whose result the gate reuses on the same tree.
  const testOptions = { withServices: options.withServices === true, related: true };
  const commands = (o: TestOptions) =>
    planTests(root, workspaces, affected, o)
      .map((p) => p.command)
      .join('\n');
  const narrowCheck = commands({ ...testOptions, agentCheck: true }) !== commands(testOptions);
  const agentCheckTests = (files: string[]) =>
    services.tests(root, workspaces, options.testTimeoutMs, files, {
      ...testOptions,
      agentCheck: true,
    });
  // A gate's failing test files, run once more alone (UPT-111).
  const rerunTests = (files: string[]) =>
    services.tests(root, workspaces, options.testTimeoutMs, files, {
      withServices: options.withServices === true,
      only: true,
    });
  const llm = await progress(options.onProgress, { phase: 'assist', package: pack.name }, () =>
    sdkAgent
      ? assistWithSdk({
          root,
          workspaces,
          sites,
          pack: sitePack,
          context: packContext,
          model: selection.model,
          maxCostUsd,
          // Reuse the post-install program; final verification still checks independently.
          diagnostics: checkTarget,
          tests: (files) =>
            services.tests(root, workspaces, options.testTimeoutMs, files, {
              withServices: options.withServices === true,
              related: true,
            }),
          ...(narrowCheck ? { checkTests: agentCheckTests } : {}),
          rerun: rerunTests,
          ...(services.lint
            ? {
                lint: (files: string[], b?: LintResult[]) =>
                  services.lint?.(root, files, b) ?? Promise.resolve([]),
              }
            : {}),
          baselineTests,
          baselineLint,
          affected: [...affected],
          ...(options.onProgress ? { onProgress: options.onProgress } : {}),
          ...(services.format
            ? { format: (files: string[]) => services.format?.(root, files) ?? Promise.resolve([]) }
            : {}),
          ...(services.agentRunner ? { runner: services.agentRunner } : {}),
        })
      : assist(
          root,
          sites,
          sitePack,
          fixer,
          () => services.diagnostics(root, workspaces),
          packContext,
          options.fixer === null,
          options.onProgress,
          { maxCostUsd },
        ),
  );
  if (estimate) llm.estimate = estimate;
  // The SDK enforces the limit inside its session: the sites it left are what the limit cost.
  const left = sites.filter((s) => s.outcome === 'manual').length;
  if (
    sdkAgent &&
    !llm.costLimit &&
    left &&
    (llm.tasks?.some((t) => t.stop === 'error_max_budget_usd') ||
      sites.some((s) => s.reason.includes('not attempted: --max-cost reached')))
  )
    llm.costLimit = { limitUsd: maxCostUsd, notAttempted: left };
  const agentSpend = llm.costUsd;
  lap('agent', agentSpend);
  for (const site of sites)
    for (const file of site.editedFiles ?? []) if (!affected.includes(file)) affected.push(file);
  const followed: Followed[] = [];
  // Edits no compiler error points at: a test asserting the old value of a changed constant.
  for (const site of [...sites]) {
    if (site.outcome === 'manual' || !pack.followUps) continue;
    applyFollowUps({
      root,
      pack: pack.name,
      edits: pack.followUps({ root, workspaces, finding: site.finding, context: packContext }),
      base: site.finding,
      rule: site.rule,
      origin: `${site.finding.usage.file}:${site.finding.usage.line}`,
      sites,
      followed,
      affected,
    });
  }
  // Release cached programs before final verification builds independent ones.
  targetChecker?.clear();
  // The consumed builds ran right after the bump: what is reported, and what feedback and the
  // fallback decide on, is the head the edits left (UPT-104). They run again only when the tree
  // changed since, and never beside a verification build that built the same workspaces.
  const rebuildConsumed = async (): Promise<void> => {
    if (consumed.every((c) => build.some((b) => b.workspace === c.workspace))) consumed = [];
    if (!consumed.length || treeState() === consumedAt) return;
    consumed = await keepClean(
      async () => (await prepareWorkspace(root, workspaces, consumedBuilds)).builds,
    );
    consumedAt = treeState();
  };
  // The same clone at the parent commit, with the parent's own install and generated clients;
  // the branch's are restored after. A parent that cannot be checked out, installed or built
  // says why, never that it passed. ponytail: the build output left in the clone is the
  // parent's; nothing after this reads it, and `verify` builds again.
  const buildAtParent = async (): Promise<{ builds: BuildResult[] } | { unchecked: string }> => {
    const generate = services.generate ?? generateClients;
    const firstLine = (text: string): string =>
      text
        .split('\n')
        .find((l) => l.trim())
        ?.trim()
        .slice(0, 160) ?? 'no output';
    let step = 'checkout';
    try {
      git(root, 'switch', '-q', '--detach', baseHead);
      step = 'install';
      await services.install(root);
      step = 'client generation';
      await generate(root, workspaces);
      const builds = await runBuild(true);
      const stopped = builds.find((b) => b.cause === 'build could not run');
      return stopped
        ? { unchecked: `build could not run: ${firstLine(stopped.output)}` }
        : { builds };
    } catch (error) {
      return {
        unchecked: `${step} failed: ${firstLine(error instanceof Error ? error.message : String(error))}`,
      };
    } finally {
      if (step !== 'checkout') {
        git(root, 'checkout', '--', '.');
        git(root, 'clean', '-fdq');
        git(root, 'switch', '-q', branch);
        await services.install(root);
        await generate(root, workspaces);
      }
    }
  };
  let build = await runBuild();
  await rebuildConsumed();
  let {
    tests: ran,
    after,
    lint,
    formatted,
  } = await settle({
    root,
    pack,
    context: packContext,
    workspaces,
    sites,
    followed,
    affected,
    from: initialContext.from,
    target,
    baselineLint,
    services,
    fullSuite: true,
    withServices: options.withServices === true,
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.testTimeoutMs ? { testTimeoutMs: options.testTimeoutMs } : {}),
  });
  const unverified = typeResolutionFailure(root, baseline);
  if (unverified && canAssist) fallback.push(`Unknown baseline: ${unverified}`);
  // Build reasons are the head's: recomputed after each build, so a fixed build drops its own.
  const headIndependent = fallback.length;
  const buildFallback = (): void => {
    fallback.length = headIndependent;
    // A workspace build that could not prepare consumed declarations is reported, not thrown.
    for (const b of canAssist ? [...workspaceBuilds, ...consumed] : [])
      if (b.status !== 'passed')
        fallback.push(`Build cannot run (${b.workspace}): ${b.cause ?? trimOutput(b.output)}`);
    for (const b of canAssist ? build : []) {
      if (
        baselineBuild.some(
          (p) =>
            p.workspace === b.workspace &&
            p.command === b.command &&
            (p.status === 'failed' || p.status === 'timeout'),
        )
      )
        continue;
      if ((pack.requiresBuild && b.status === 'missing') || b.cause || b.status === 'timeout')
        fallback.push(`Build cannot run (${b.workspace}): ${b.cause ?? trimOutput(b.output)}`);
    }
  };
  buildFallback();
  const feedbackFinding: Finding = {
    severity: 'breaking',
    confidence: 1,
    fixability: 'assisted',
    reason: 'verification feedback',
    change: {
      package: pack.name,
      from: initialContext.from,
      to: target,
      path: 'verification',
      kind: 'type',
      severity: 'breaking',
      confidence: 1,
      source: 'types',
    },
    usage: {
      file: '',
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 1,
      symbolPath: '',
      access: 'read',
      snippet: '',
      via: 'inferred',
    },
  };
  lap('verify');
  const feedbackRunner = sdkAgent
    ? services.agentRunner
    : fixer
      ? feedbackPatchRunner(fixer, feedbackFinding)
      : undefined;
  const feedbackLimits: NonNullable<FixReport['llm']['feedback']> = {
    roundsUsed: 0,
    maxRounds: 3,
    maxCostUsd,
  };
  llm.feedback = feedbackLimits;
  let previousAttempt = '';
  for (let round = 1; canAssist && round <= feedbackLimits.maxRounds; round++) {
    const feedback = verificationFeedback(
      newDiagnostics(baseline, after, gitLineMoves(root, baseHead)),
      ran,
      baselineTests,
      build,
      baselineBuild,
    );
    if (!feedback && !(round === 1 && fallback.length)) break;
    const remaining =
      (nanos(maxCostUsd) - nanos(llm.costUsd) - nanos(llm.unreportedCostUsd ?? 0)) / 1e9;
    if (remaining < 0.02 || llm.unreportedCostUsd) break;
    // A session that would likely cross the limit is not started: one that does stops at the
    // limit mid-edit, and its spend buys nothing (UPT-111).
    // ponytail: the mean of this run's sessions; a per-pack history if sessions vary widely.
    const sessions = (llm.tasks ?? []).filter((t) => t.costUsd > 0);
    const typicalUsd = sessions.length
      ? sessions.reduce((n, t) => n + t.costUsd, 0) / sessions.length
      : 0;
    if (remaining < typicalUsd) {
      feedbackLimits.stopped = { remainingUsd: remaining, typicalUsd };
      break;
    }
    // Never let a rejected agent task reset files written by a check.
    if (git(root, 'status', '--porcelain', '--untracked-files=all')) break;
    const files = feedbackFiles(root);
    const task = { id: `verification-${round}`, rule: 'verification feedback', sites: [], files };
    const next = await assistWithSdk({
      root,
      workspaces,
      sites,
      pack,
      context: packContext,
      model: selection.model,
      maxCostUsd: remaining,
      task,
      feedback: [
        fallback.length ? `Agent-led fallback: ${fallback.join('; ')}` : '',
        'Failures at the target that passed at the parent (repair production code, preserve behavior):',
        feedback,
        previousAttempt,
      ].join('\n'),
      diagnostics: () => services.diagnostics(root, workspaces),
      tests: () =>
        services.tests(root, workspaces, options.testTimeoutMs, affected, {
          fullSuite: true,
          withServices: options.withServices === true,
        }),
      rerun: rerunTests,
      baselineTests,
      baselineLint,
      affected,
      ...(services.format
        ? { format: (f: string[]) => services.format?.(root, f) ?? Promise.resolve([]) }
        : {}),
      ...(services.lint
        ? {
            lint: (f: string[], b?: LintResult[]) =>
              services.lint?.(root, f, b) ?? Promise.resolve([]),
          }
        : {}),
      ...(feedbackRunner ? { runner: feedbackRunner } : {}),
    });
    feedbackLimits.roundsUsed++;
    const lastAttempt = next.tasks?.at(-1);
    previousAttempt = lastAttempt?.rejection ?? lastAttempt?.stop ?? '';
    llm.inputTokens += next.inputTokens;
    llm.outputTokens += next.outputTokens;
    llm.costUsd = (nanos(llm.costUsd) + nanos(next.costUsd)) / 1e9;
    if (next.unreportedCostUsd)
      llm.unreportedCostUsd =
        (nanos(llm.unreportedCostUsd ?? 0) + nanos(next.unreportedCostUsd)) / 1e9;
    llm.tasks = [...(llm.tasks ?? []), ...(next.tasks ?? [])];
    for (const task of next.tasks ?? [])
      for (const file of Object.keys(task.diffs ?? {}))
        if (!affected.includes(file)) affected.push(file);
    build = await runBuild();
    await rebuildConsumed();
    buildFallback();
    lint = await (services.lint ?? lintFiles)(root, affected, baselineLint);
    after = await verify('types after feedback', () => services.diagnostics(root, workspaces));
    ran = await verify('tests after feedback', () =>
      services.tests(root, workspaces, options.testTimeoutMs, affected, {
        fullSuite: true,
        withServices: options.withServices === true,
      }),
    );
  }
  if (feedbackLimits.roundsUsed) lap('feedback', (nanos(llm.costUsd) - nanos(agentSpend)) / 1e9);
  // The repository's own build on the final head, reported where the pack does not gate on it:
  // the PR names its result, never "not required" in its place (UPT-110). A workspace the
  // consumed builds already built on this head is not built again.
  let headBuild: BuildResult[] = [];
  let parentBuild: BuildResult[] | undefined;
  let parentUnchecked: string | undefined;
  if (!needsBuild) {
    await rebuildConsumed();
    headBuild = await runBuild(
      true,
      workspaces.filter((w) => !consumed.some((c) => c.workspace === w)),
    );
    // Only a failing head is built again at the parent: already failing, or broken by the upgrade.
    if (
      [...consumed, ...headBuild].some((b) => b.status === 'failed' || b.status === 'timeout') &&
      !git(root, 'status', '--porcelain', '--untracked-files=all')
    ) {
      const parent = await buildAtParent();
      if ('builds' in parent) parentBuild = parent.builds;
      else parentUnchecked = parent.unchecked;
    }
    lap('build');
  }
  assertInstalledVersions(root, [{ name: pack.name, to: target }, ...companions]);
  const tests = markPreexisting(ran, baselineTests);
  // An agent-led draft must still install from scratch, as the repository's CI would (UPT-102).
  const cleanInstall = fallback.length ? await cleanInstallCheck(root, services) : undefined;
  if (cleanInstall) lap('clean-install');
  const pending = git(root, 'status', '--porcelain', '--untracked-files=all');
  const newErrors = newDiagnostics(baseline, after, gitLineMoves(root, baseHead));
  const behavior = pack.name === 'zod' ? behaviorCheck(root, originals, sites) : undefined;
  const typed = packages.filter((p) => p.typeCoverage);
  const typeCoverage = typed.length
    ? {
        checked: typed.reduce((n, p) => n + (p.typeCoverage?.checked ?? 0), 0),
        affected: typed.reduce((n, p) => n + (p.typeCoverage?.affected ?? 0), 0),
      }
    : undefined;
  const checksPassed =
    !unverified &&
    !fallback.some((reason) => /incomplete check|Unknown baseline|Planner refused/.test(reason)) &&
    newErrors.length === 0 &&
    cleanInstall?.passed !== false &&
    !pending &&
    tests.every((t) => t.status === 'passed' || t.status === 'missing' || t.preexisting) &&
    (!pack.requiresBuild || (build.length > 0 && build.every((b) => b.status === 'passed'))) &&
    build.every((b) => b.status === 'passed' || b.status === 'missing') &&
    testsOrBuildVouch(typeCoverage, tests, build) &&
    lint.every((l) => l.status !== 'failed');
  // A head build that fails where the parent's could not be checked fails the run too.
  const broken = upgradeBrokeBuild(parentBuild) || !!parentUnchecked;
  const result: FixReport = {
    ...(pins.length ? { rootPins: pins } : {}),
    ...(fallback.length ? { agentFallback: fallback } : {}),
    ...(cleanInstall ? { cleanInstall } : {}),
    ...(pending ? { verificationPending: true } : {}),
    ...(artifacts.length ? { testArtifacts: artifacts } : {}),
    ...(lockfile ? { lockfile } : {}),
    ...(generated.length ? { generated } : {}),
    repo: root,
    package: pack.name,
    tier: generic ? 'generic' : 'verified',
    ...(candidatePack(pack) || companionPacks.some((c) => candidatePack(c.pack))
      ? { packWarning: CANDIDATE_WARNING }
      : {}),
    from: initialContext.from,
    target,
    targetSource: resolved.source,
    ...(resolved.releaseAge ? { releaseAge: resolved.releaseAge } : {}),
    ...(companions.length ? { companions } : {}),
    ...(stays.length ? { companionStays: stays } : {}),
    ...(blockers.length ? { companionBlockers: blockers } : {}),
    ...(removals.length ? { companionRemovals: removals } : {}),
    ...(peerPlan?.conflicts.length ? { peerConflicts: groupPeerBlockers(peerPlan.conflicts) } : {}),
    ...(report.importersNotAnalyzed?.length
      ? { importersNotAnalyzed: report.importersNotAnalyzed }
      : {}),
    ...(typeCoverage ? { typeCoverage } : {}),
    ...tool,
    verifiedAt: new Date().toISOString(),
    head: git(root, 'rev-parse', 'HEAD'),
    verifiedTree: git(root, 'rev-parse', 'HEAD^{tree}'),
    baseHead,
    changedFiles: git(root, 'diff', '--name-only', baseHead, 'HEAD').split('\n').filter(Boolean),
    branch,
    sites,
    verification: {
      baseline,
      target: targetErrors,
      after,
      newErrors,
      baselineTests,
      tests,
      ...(needsBuild || workspaceBuilds.length || consumed.length || headBuild.length
        ? {
            build: [...workspaceBuilds, ...consumed, ...build, ...headBuild],
            ...(needsBuild ? { baselineBuild } : {}),
          }
        : {}),
      ...(pack.requiresBuild ? { buildRequired: true } : {}),
      ...(lint.length ? { lint } : {}),
      ...(formatted.length ? { formatted } : {}),
      ...(unverified ? { typesUnverified: unverified } : {}),
      baselineHealth: baselineHealth(baseline, baselineTests),
      ...(parentBuild ? { parentBuild } : {}),
      ...(parentUnchecked ? { parentUnchecked } : {}),
      // A build the upgrade broke fails the run; alone, it still publishes, as a draft (UPT-110).
      ...(broken && checksPassed ? { buildBroken: true as const } : {}),
      passed: checksPassed && !broken,
    },
    llm: {
      ...llm,
      ...(sdkAgent ? { executor: 'sdk' } : fixer ? { executor: 'patch' } : {}),
    },
    ...(behavior ? { behavior } : {}),
    timingMs: Date.now() - started,
    phases,
    buildRuns,
    prBody: join(root, '.uptide/pr-body.md'),
    notes: [
      ...pins.map((pin) => describeRootPin(pin).replace('it will be updated', 'updated')),
      ...fallback.map((reason) => `Agent-led fallback: ${reason}`),
      ...pack.reviewNotes(packContext),
      ...bumps.flatMap((b) =>
        b.alreadyCompatible.map((w) => `${w}: already compatible; range left unchanged.`),
      ),
      ...(pending ? ['Tests/install left uncommitted files; review them before publication.'] : []),
    ],
  };
  // Review material is scoped to this run: only the rules its own sites have. The context it
  // is made from is kept, so a later build can render the same run with what it has learned.
  const rules = [...new Set(sites.map((s) => s.rule).filter((r): r is string => !!r))];
  result.packContext = packContext;
  refreshReview(result, sitePack);
  // A pack that says something first reads the branch as the edits left it, not the base.
  const settled = pack.headline
    ? { ...packContext, ...pack.scanContext?.(root, workspaces) }
    : packContext;
  const headline = pack.headline?.(settled);
  if (headline) result.headline = headline;
  // A record site the edit reached no longer matches on the branch: kept. ponytail: matched by
  // file and snippet, so an edit that rewrites the line without the fix reads as kept.
  const before = packContext.recordSites ?? [];
  if (before.length) {
    const open = workspaces.flatMap((workspace) =>
      recordSites(records, { root, workspace, phase: 'after' }),
    );
    const same = (a: RecordSite, b: RecordSite) => a.file === b.file && a.record === b.record;
    packContext = {
      ...packContext,
      recordSites: before.map((site) => {
        const still = open.filter((o) => same(o, site));
        const kept =
          !still.length ||
          (!still.some((o) => o.snippet === site.snippet) &&
            still.length < before.filter((b) => same(b, site)).length);
        return { ...site, kept };
      }),
    };
    result.packContext = packContext;
  }
  const decisions = [
    ...recordDecisions(records, packContext.recordSites ?? []),
    ...packDecisions(pack, packContext, rules, followed),
  ];
  if (decisions.length) result.decisions = decisions;
  const decided = [
    ...decidedRules(pack, packContext, rules, followed),
    ...new Set(before.map((s) => s.record)),
  ];
  if (decided.length) result.decidedRules = decided;
  const remote = originOf(root);
  if (remote) result.remote = remote;
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: run } = process.env;
  if (server && repo && run) result.runUrl = `${server}/${repo}/actions/runs/${run}`;
  mkdirSync(dirname(result.prBody), { recursive: true });
  const storedRun = join(root, '.uptide/report.json');
  writeFileSync(storedRun, JSON.stringify(result, null, 2));
  writeFileSync(result.prBody, prBody(result));
  if (options.pr) {
    await publishVerified(result, { tool, ...(options.yes ? { yes: true } : {}) });
    writeFileSync(result.prBody, prBody(result));
    writeFileSync(storedRun, JSON.stringify(result, null, 2));
  }
  return result;
}

/**
 * The publish step of a `--pr` run, on a run that is already where it belongs. A refused
 * publication (unverified, dirty build) is recorded with its reasons; without `--yes` the
 * plan is printed and the run stands; a failing push or `gh` call is recorded as `failed`
 * and never thrown, because the verified run it belongs to must survive it.
 */
export async function publishVerified(
  result: FixReport,
  options: { tool: { uptideDirty: boolean }; yes?: boolean; cwd?: string },
  io?: Parameters<typeof import('./publish.js').publish>[2],
): Promise<void> {
  const blockers = publicationBlockers(result, options.tool);
  if (blockers.length) {
    // No --yes and no --no-llm changes this: the branch stays local and the report says why.
    result.publication = { refused: blockers };
    result.notes.push(`PR not opened: ${blockers.join('; ')}`);
    return;
  }
  const { publish } = await import('./publish.js');
  // The plan and any warning are kept on the run: the caller prints them when its progress
  // line is gone, instead of this step writing into the middle of a spinner.
  const log: string[] = [];
  const collect = (text: string): void => void log.push(text);
  try {
    result.prUrl = await publish(
      result,
      options.yes,
      io ? { ...io, print: collect } : { git, command, print: collect },
      options.cwd ? { cwd: options.cwd } : {},
    );
  } catch (error) {
    if (log.length) result.publicationLog = log.join('\n');
    const message = error instanceof Error ? error.message : String(error);
    if (!options.yes && /requires --yes/.test(message)) {
      // Without --yes the plan is the point: printed, and the run stands as verified.
      result.notes.push(
        `Publication plan printed, nothing pushed (no --yes): \`${UPTIDE_COMMAND} pr --branch ${result.branch} --yes\` opens the PR.`,
      );
      return;
    }
    if (error instanceof UptideError && error.code === 'VERIFIED_TREE_MISMATCH') {
      result.exportError = message;
      result.verification = { ...result.verification, passed: false };
      result.publication = { refused: [message] };
      result.notes.push(message);
      return;
    }
    result.publication = { refused: [], failed: message.split('\n')[0] ?? message };
    result.notes.push(
      `PR not opened: ${result.publication.failed}. The verified run is stored; \`${UPTIDE_COMMAND} pr --branch ${result.branch} --yes\` retries the publish step alone.`,
    );
    return;
  }
  if (log.length) result.publicationLog = log.join('\n');
}

/** Marks the evidence that sits where a selected finding has a compiler error. */
export function confirmedEvidence(
  evidence: NonNullable<PackContext['evidence']>,
  findings: Finding[],
): NonNullable<PackContext['evidence']> {
  const rejected = new Set(
    findings
      .filter((f) => f.usage.compileError !== undefined || f.usage.compileCode !== undefined)
      .map((f) => `${f.usage.file}:${f.usage.line}`),
  );
  return evidence.map((e) => (rejected.has(`${e.file}:${e.line}`) ? { ...e, compiler: true } : e));
}

/**
 * The pack's review material for a run, from the context the run stored: sections and the
 * changelog counts. A stored run is rendered with the current build's knowledge of what is
 * relevant, not with what the build that made it knew.
 */
export function refreshReview(
  result: FixReport,
  lead: MigrationPack | undefined = activePack(result.package),
): void {
  const pack =
    lead && result.companions?.length
      ? withCompanionPacks(
          lead,
          result.companions.flatMap((c) => activePack(c.name) ?? []),
        )
      : lead;
  if (!pack || !result.packContext) return;
  const rules = [...new Set(result.sites.map((s) => s.rule).filter((r): r is string => !!r))];
  try {
    const sections = pack.reviewSections?.(result.packContext, rules);
    if (sections) result.reviewSections = sections;
    const apiChanges = pack.apiChanges?.(result.packContext);
    if (apiChanges) result.apiChanges = apiChanges;
  } catch {
    // What the run stored stands.
  }
}

export { selectedFindings } from './select.js';

export { safeFile } from './settle.js';

/** The frozen install (`npm ci`, `pnpm install --frozen-lockfile`, …) on the branch as committed. */
async function cleanInstallCheck(
  root: string,
  services: FixServices,
): Promise<NonNullable<FixReport['cleanInstall']>> {
  const pm = packageManager(root);
  const command = [pm.bin, ...pm.args].join(' ');
  try {
    await services.install(root);
    return { command, passed: true };
  } catch (error) {
    return {
      command,
      passed: false,
      output: trimOutput(error instanceof Error ? error.message : String(error)),
    };
  }
}
