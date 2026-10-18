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
import { ACCEPTED_KEYS, selectLlm } from '../llm/config.js';
import {
  type CostSetting,
  costEstimate,
  DEFAULT_MAX_COST_USD,
  describeEstimate,
  overEstimateMessage,
  providerFixer,
} from '../llm/fixer.js';
import { nanos } from '../llm/pricing.js';
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
import { payloadApiVersions, stripeUsageContext } from '../packs/stripe/relevance.js';
import type { MigrationPack, PackContext } from '../packs/types.js';
import { resetSharedState } from '../shared-state.js';
import { prepareWorkspace } from '../verify/prepare-workspace.js';
import { UPTIDE_COMMAND, uptideVersionInfo } from '../version.js';
import { assist } from './assisted.js';
import { baselineHealth, testsOrBuildVouch } from './baseline.js';
import { behaviorCheck } from './behavior.js';
import { buildWorkspaces, configuredBuildScript } from './build.js';
import {
  assistedPeerPreflight,
  fallbackReport,
  feedbackFiles,
  feedbackPatchRunner,
  pinConsentFallback,
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
import { assistWithSdk, sdkInstalled, type TaskRunner } from './sdk-agent.js';
import { selectedFindings } from './select.js';
import { applyFollowUps, commit, type Followed, safeFile, settle } from './settle.js';
import { lintFiles } from './style.js';
import { type ResolvedTarget, resolveTarget } from './target.js';
import type {
  BuildResult,
  FixDiagnostic,
  Fixer,
  FixPhase,
  FixReport,
  FixSite,
  LintResult,
  TestResult,
} from './types.js';
import {
  describeServices,
  diagnostics,
  gitLineMoves,
  markPreexisting,
  newDiagnostics,
  type TestOptions,
  testWorkspaces,
  typeChecker,
  typeResolutionFailure,
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
  /** Whether the optional SDK peer can be imported; decides the default executor. */
  sdkInstalled?: () => Promise<boolean>;
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
  const lap = (name: FixPhase['name'], costUsd?: number): void => {
    const now = Date.now();
    phases.push({ name, ms: now - lapped, ...(costUsd !== undefined ? { costUsd } : {}) });
    lapped = now;
  };
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
  // The SDK is an optional peer: the default uses it only when it is installed.
  const sdkMissing =
    sdkDefault && !services.agentRunner && !(await (services.sdkInstalled ?? sdkInstalled)());
  const sdkAgent =
    options.fixer !== null && (options.agent === 'sdk' || (sdkDefault && !sdkMissing));
  if (sdkAgent && selection.provider !== 'anthropic')
    throw new UptideError(
      'NO_FIXER',
      `--agent sdk runs on Anthropic models only; ${selection.provider} keeps the default agent`,
    );
  if (sdkAgent && !selection.available && !services.agentRunner)
    throw new UptideError('NO_FIXER', '--agent sdk needs ANTHROPIC_API_KEY');
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
  try {
    planRootPins(root, [{ name: pack.name, to: target }, ...(peerPlan?.companions ?? [])], options);
  } catch (error) {
    agentLed.push(pinConsentFallback(error, canAssist));
    options = { ...options, updatePins: true };
  }
  // A peer blocker moved across a major its pack covers: that pack's rules run here too.
  const companionPacks = (peerPlan?.companions ?? []).flatMap((c) => {
    const companion =
      c.migration === 'pack' ? activePack(c.name, options.allowCandidate) : undefined;
    return companion ? [{ pack: companion, to: c.to }] : [];
  });
  const branch = `uptide/${pack.name}-${target}`;
  packageManager(root);
  if (services.install === install) await assertManagerAvailable(root);
  // Generated clients and consumed workspace builds, before the planner compiles anything.
  const prepared = await prepareWorkspace(root, workspacePackagesOf(root), {
    build: services.build ?? buildWorkspaces,
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
  const runBuild = async (): Promise<BuildResult[]> => {
    if (!needsBuild) return [];
    const clean = !git(root, 'status', '--porcelain', '--untracked-files=all');
    try {
      return await verify(`build (${names(workspaces)})`, () =>
        (services.build ?? buildWorkspaces)(
          root,
          workspaces,
          undefined,
          options.buildScript ?? configuredBuildScript(root),
        ),
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
    } finally {
      if (clean && git(root, 'status', '--porcelain', '--untracked-files=all')) {
        git(root, 'checkout', '--', '.');
        git(root, 'clean', '-fdq');
      }
    }
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
  const baselineTests = await verify(`tests (${names(workspaces)})`, () =>
    services.tests(root, workspaces, options.testTimeoutMs, affected, {
      withServices: options.withServices === true,
      fullSuite: true,
    }),
  );
  if (git(root, 'status', '--porcelain', '--untracked-files=all'))
    throw new Error('baseline tests modified the working tree; review their changes before fixing');
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
  const moved = companions.map((c) => `${c.name} ${c.to}`).join(', ');
  const dropped = removals.map((r) => r.name).join(', ');
  commit(
    root,
    `chore: upgrade ${pack.name} to ${target}${moved ? ` with ${moved}` : ''}${dropped ? `, remove ${dropped}` : ''}`,
    [...bump.files, join(root, packageManager(root).lockfile)],
  );
  // The install replaced node_modules, and what was generated into it with them.
  const rebuilt = await prepareWorkspace(root, workspaces, {
    build: services.build ?? buildWorkspaces,
    generate: services.generate ?? generateClients,
    moved: [pack.name, ...companions.map((c) => c.name), ...removals.map((r) => r.name)],
    buildScript: options.buildScript,
    onProgress: options.onProgress,
  });
  generated.push(...rebuilt.generated.map((g) => ({ ...g, phase: 'bump' as const })));
  workspaceBuilds.push(...rebuilt.builds);
  const targetChecker =
    sdkAgent && services.diagnostics === diagnostics ? typeChecker(root, workspaces) : undefined;
  const checkTarget = targetChecker?.check ?? (() => services.diagnostics(root, workspaces));
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
    ? costEstimate(selection.provider, selection.model, agentSites, maxCostUsd, options.costSetting)
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
  let build = await runBuild();
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
  // A workspace build that could not prepare consumed declarations is reported, not thrown.
  for (const b of canAssist ? workspaceBuilds : [])
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
  const feedbackLimits = {
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
  assertInstalledVersions(root, [{ name: pack.name, to: target }, ...companions]);
  const tests = markPreexisting(ran, baselineTests);
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
  const result: FixReport = {
    ...(pins.length ? { rootPins: pins } : {}),
    ...(fallback.length ? { agentFallback: fallback } : {}),
    ...(pending ? { verificationPending: true } : {}),
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
      ...(needsBuild || workspaceBuilds.length
        ? { build: [...workspaceBuilds, ...build], ...(needsBuild ? { baselineBuild } : {}) }
        : {}),
      ...(pack.requiresBuild ? { buildRequired: true } : {}),
      ...(lint.length ? { lint } : {}),
      ...(formatted.length ? { formatted } : {}),
      ...(unverified ? { typesUnverified: unverified } : {}),
      baselineHealth: baselineHealth(baseline, baselineTests),
      passed:
        !unverified &&
        !fallback.some((reason) =>
          /incomplete check|Unknown baseline|Planner refused/.test(reason),
        ) &&
        newErrors.length === 0 &&
        !pending &&
        tests.every((t) => t.status === 'passed' || t.status === 'missing' || t.preexisting) &&
        (!pack.requiresBuild || (build.length > 0 && build.every((b) => b.status === 'passed'))) &&
        build.every((b) => b.status === 'passed' || b.status === 'missing') &&
        testsOrBuildVouch(typeCoverage, tests, build) &&
        lint.every((l) => l.status !== 'failed'),
    },
    llm: sdkMissing ? { ...llm, sdkMissing: true } : llm,
    ...(behavior ? { behavior } : {}),
    timingMs: Date.now() - started,
    phases,
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
  const decisions = packDecisions(pack, packContext, rules, followed);
  if (decisions?.length) result.decisions = decisions;
  const decided = decidedRules(pack, packContext, rules, followed);
  if (decided.length) result.decidedRules = decided;
  const remote = originOf(root);
  if (remote) result.remote = remote;
  mkdirSync(dirname(result.prBody), { recursive: true });
  const storedRun = join(root, '.uptide/report.json');
  // First: a body that cannot fit refuses, and points at this report.
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
