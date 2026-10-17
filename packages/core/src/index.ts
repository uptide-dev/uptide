export { consumerCompilerDir, unresolvedConfig } from './adapters/typescript/compiler.js';
export {
  createTypescriptAdapter,
  type TypescriptAdapterOptions,
  typescriptAdapter,
} from './adapters/typescript/index.js';
export { projectScope } from './adapters/typescript/project-scope.js';
export { createFsSurfaceCache } from './cache/fs-surface-cache.js';
export { defaultCacheDir } from './cache/paths.js';
export { requireFindUsages } from './check/capabilities.js';
export {
  type CheckOptions,
  type CheckResult,
  check,
  isFailure,
  planPackages,
  workerHeapMb,
} from './check/check.js';
export { resolveDirection } from './check/direction.js';
export { deprecationReplacement, fixabilityOf } from './check/fixability.js';
export { match } from './check/match.js';
export { type MergedSignals, mergeSignals, symbolFromMessage } from './check/merge.js';
export { callSitesLine } from './check/root-cause.js';
export { NO_PACK, noPackVerdict, TIER_LEGEND } from './check/tier.js';
export {
  formatTruthTable,
  scoreAgainstTruth,
  type TruthCase,
  type TruthScore,
} from './check/truth.js';
export { coverageLine, type Verdict, verdictOf } from './check/verdict.js';
export { compareVersions, majorsBehind, parseVersion } from './check/version.js';
export { classify, type UnclassifiedChange } from './diff/classify.js';
export { diffSurfaces, rawDiff } from './diff/diff.js';
export { depthOf, type Folded, foldForDisplay } from './diff/fold.js';
export { refineWithTypes } from './diff/refine.js';
export {
  type DetailedDiff,
  type DiffDirsOptions,
  type DiffPackageOptions,
  diffDirs,
  diffPackage,
  diffPackageDetailed,
  type SurfaceOptions,
  surfaceOf,
} from './diff-package.js';
export type {
  CompareTypesInput,
  CompileOptions,
  LanguageAdapter,
  PackageDir,
  ParameterComparison,
  RepoDir,
  SignatureComparison,
  TypeComparison,
  TypeRelation,
} from './domain/adapter.js';
export type { Change, ChangeKind, Severity } from './domain/change.js';
export type { PackageFetcher, SurfaceCache, SurfaceCacheKey } from './domain/io.js';
export * as symbolPath from './domain/path.js';
export type { ProgressEvent, ProgressListener } from './domain/progress.js';
export type {
  CheckReport,
  Finding,
  Fixability,
  Importer,
  ImportersNotAnalyzed,
  PackageReport,
  PackageStatus,
  PlanGroup,
} from './domain/report.js';
export type {
  RuntimeChange,
  RuntimeChangeKind,
  RuntimeDiff,
  RuntimeSurface,
} from './domain/runtime.js';
export { isNativeProbeSkip } from './domain/runtime.js';
export type { ApiSurface, ApiSymbol, SymbolKind } from './domain/surface.js';
export { SURFACE_SCHEMA_VERSION } from './domain/surface.js';
export {
  type CompileDiagnostic,
  type CompileSignal,
  type FindUsagesResult,
  type Unanalyzed,
  USAGE_CERTAINTY,
  type Usage,
  type UsageAccess,
  type UsageVia,
  usagePaths,
} from './domain/usage.js';
export { BY } from './domain/wording.js';
export {
  AdapterCapabilityError,
  type ErrorCode,
  errorCode,
  IntegrityError,
  NoTypesError,
  PackageNotFoundError,
  RegistryAuthError,
  UptideError,
  VersionNotFoundError,
} from './errors.js';
export {
  createNpmFetcher,
  type NpmFetcherOptions,
  releasePackage,
  removePackageDir,
} from './fetch/npm-fetcher.js';
export { loadRegistryConfig, type RegistryConfig } from './fetch/npmrc.js';
export { maxSatisfying, satisfies, validRange } from './fetch/range.js';
export {
  type BaselineHealth,
  baselineHeadline,
  baselineHealth,
  baselineHealthOf,
  fixVerdict,
} from './fix/baseline.js';
export {
  cleanRuns,
  fixPreflight,
  isolatedFix,
  isolatedVerify,
  type PreflightOptions,
  removeOnInterrupt,
  removeRun,
  runsRoot,
  storedRunFile,
  watchInterruptibleClones,
} from './fix/isolate.js';
export {
  describeOutOfScope,
  describeTransitive,
  type MovedSubtree,
  type OutOfScopeChange,
  type TransitiveChange,
} from './fix/managers/lock-guard.js';
export {
  groupPeerBlockers,
  type PeerBlockerGroup,
  PeerPreflightError,
} from './fix/peer-preflight.js';
export { planPackage } from './fix/plan.js';
export { openPr, type PrOptions } from './fix/pr.js';
export { updatePrBody } from './fix/pr-body.js';
export {
  PublishError,
  type PublishTarget,
  publicationBlockers,
  publicationFailureReason,
  publishTarget,
} from './fix/publish.js';
export {
  describePhases,
  fixCounts,
  formatFix,
  migrationBody,
  migrationRisk,
  prBody,
  renderMigration,
  summaryCells,
} from './fix/report.js';
export { type ReverifyOptions, reverify } from './fix/reverify.js';
export { type FixOptions, fix } from './fix/run.js';
export { detectStyle } from './fix/style.js';
export type { Fixer, FixPhase, FixReport, FixRequest, FixResponse } from './fix/types.js';
export { buildToolMajor } from './list/evidence.js';
export {
  type ListedDependency,
  type ListGroup,
  type ListOptions,
  type ListReport,
  listDependencies,
} from './list/list.js';
export type { PackageSignals, Priority, Signal } from './list/priorities.js';
export { ACCEPTED_KEYS, KEY_ENV, selectLlm } from './llm/config.js';
export {
  type CostEstimate,
  type CostSetting,
  costEstimate,
  costStopMessage,
  DEFAULT_MAX_COST_USD,
  describeEstimate,
  overEstimateMessage,
  providerFixer,
} from './llm/fixer.js';
export { DEFAULT_MODELS, PRICE_DATE, PRICE_SOURCES, PRICES, priceFor } from './llm/pricing.js';
export type { Provider } from './llm/types.js';
export * from './onboarding/index.js';
export * from './onboarding/node.js';
export {
  type BehaviorNote,
  definePack,
  type GateResult,
  type GroundTruth,
  type GroundTruthFinding,
  type GroundTruthRepo,
  type Pack,
  type PackMeta,
  type PackRule,
  type PackStatus,
  type PackVerification,
  type RegisteredPack,
  RULE_PRECISION_WARNING,
  rateLabel,
  replaceAtSite,
  rulePrecision,
  VERIFIED_MIN_BEHAVIOR_SITES,
  VERIFIED_MIN_BREAKING_SITES,
  VERIFIED_MIN_REPOS,
  type VerificationTally,
  verifiedGate,
} from './packs/contract.js';
export { activePacks, packStatus, registeredPacks } from './packs/index.js';
export { leadName, leadNames, packLeading } from './packs/leads.js';
export { sdkApiVersion, stripeConcerns, stripePack } from './packs/stripe/index.js';
export { type FixtureResult, runFixtures } from './packs/tooling/fixtures.js';
export {
  GENERIC_RULE,
  type PackTestOptions,
  type PackTestReport,
  type RepoScore,
  type Tally,
  testPack,
  unfinishedPack,
} from './packs/tooling/pack-test.js';
export {
  type ScaffoldOptions,
  type ScaffoldResult,
  scaffoldPack,
} from './packs/tooling/scaffold.js';
export {
  cachedRepoDir,
  ensureRepo,
  type PinnedRepo,
  pinnedRepo,
  truthCacheDir,
} from './packs/tooling/truth.js';
export {
  type ChangedLine,
  diffLines,
  enclosingLiteral,
  type InsertedLine,
  type InsertionAnchor,
  insertionAnchors,
} from './packs/tooling/truth-diff.js';
export type { MigrationPack, MigrationRule } from './packs/types.js';
export { zodPack } from './packs/zod/index.js';
export { type PlanOptions, type PlanServices, upgradePlan } from './plan/gather.js';
export {
  type Effort,
  effortOf,
  type PeerConstraint,
  type PeerLookup,
  type PlannedPackage,
  planUpgrades,
  type UpgradePlan,
  type UpgradeStep,
} from './plan/plan.js';
export { diffRuntime, probeRuntime } from './runtime/runtime.js';
export {
  UPTIDE_COMMAND,
  uptideCommand,
  uptideInvocation,
  uptideVersionInfo,
  version,
} from './version.js';
