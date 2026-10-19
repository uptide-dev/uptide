import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { workspacePackagesOf } from '../adapters/typescript/repo.js';
import type { ProgressListener } from '../domain/progress.js';
import { UptideError } from '../errors.js';
import { decidedRules, packDecisions } from '../packs/decisions.js';
import { activePack } from '../packs/index.js';
import type { MigrationPack, PackContext } from '../packs/types.js';
import { uptideVersionInfo } from '../version.js';
import { markPreexistingBuilds, testsOrBuildVouch, upgradeBrokeBuild } from './baseline.js';
import { buildWorkspaces, configuredBuildScript } from './build.js';
import { git } from './process.js';
import { prBody } from './report.js';
import { confirmServices } from './run.js';
import { type Followed, settle } from './settle.js';
import type { FixReport, LintResult, TestResult } from './types.js';
import {
  clearing,
  diagnostics,
  excludeArtifacts,
  gitLineMoves,
  newDiagnostics,
  type TestOptions,
  testWorkspaces,
  typeResolutionFailure,
} from './verify.js';
import { assertInstalledVersions } from './versions.js';

export interface ReverifyOptions {
  cwd: string;
  onProgress?: ProgressListener;
  testTimeoutMs?: number;
  /** The stored run to continue. Default: `.uptide/report.json` in `cwd`. */
  run?: string;
  pack?: MigrationPack;
  tool?: ReturnType<typeof uptideVersionInfo>;
  /** Also run tests that need services; `yes` confirms the printed services and targets. */
  withServices?: boolean;
  yes?: boolean;
  /** The package.json script a required build runs (`verify.build`); default: the clone's uptide.yml. */
  buildScript?: string;
}
export interface ReverifyServices {
  build?: typeof buildWorkspaces;
  diagnostics(root: string, workspaces: string[]): ReturnType<typeof diagnostics>;
  tests(
    root: string,
    workspaces: string[],
    timeoutMs?: number,
    files?: string[],
    options?: TestOptions,
  ): Promise<TestResult[]>;
  format?(root: string, files: string[]): Promise<string[]>;
  lint?(root: string, files: string[], baseline?: LintResult[]): Promise<LintResult[]>;
}

/**
 * Verifies a migration branch again where it stands, and refreshes its stored run. A branch
 * that is already a pull request is never rebuilt from scratch: that would rewrite history
 * under its reviewers. Whatever is still to do is added as new commits on top (a test the
 * migrated code made fail, the formatting of the edited files), the new HEAD is verified
 * against the run's original baseline, and the run records that HEAD. Nothing is pushed.
 */
export async function reverify(
  options: ReverifyOptions,
  services: ReverifyServices = { diagnostics, tests: testWorkspaces },
): Promise<FixReport> {
  const started = Date.now();
  const root = realpathSync(resolve(options.cwd));
  confirmServices(root, options);
  const file = resolve(options.run ?? join(root, '.uptide/report.json'));
  let report: FixReport;
  try {
    report = JSON.parse(readFileSync(file, 'utf8')) as FixReport;
  } catch {
    throw new UptideError('ANALYSIS_FAILED', `no stored migration run at ${file}`);
  }
  if (!Array.isArray(report.sites) || !report.verification || !report.package || !report.branch)
    throw new UptideError('ANALYSIS_FAILED', 'not a stored migration run');
  if (git(root, 'branch', '--show-current') !== report.branch)
    throw new UptideError(
      'ANALYSIS_FAILED',
      `check out ${report.branch} first: the stored run belongs to that branch`,
    );
  // The run's own files under .uptide are untracked by design; anything else must be committed.
  const pending = git(root, 'status', '--porcelain', '--untracked-files=all')
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.slice(3).startsWith('.uptide/'));
  if (pending.length)
    throw new UptideError('DIRTY_WORKING_TREE', 'uptide verify requires a clean working tree');
  // The run's test artifacts (a junit report) stay out of git and out of each test run here too.
  const artifacts = report.testArtifacts ?? [];
  excludeArtifacts(root, artifacts);
  services = clearing(services, root, artifacts);
  const pack = options.pack ?? activePack(report.package);
  if (!pack) throw new Error(`no migration pack for ${report.package}`);
  const workspaces = workspacePackagesOf(root).filter((w) => {
    const p = JSON.parse(readFileSync(join(root, w, 'package.json'), 'utf8'));
    return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].some(
      (s) => typeof p[s]?.[pack.name] === 'string',
    );
  });
  const moves = [{ name: report.package, to: report.target }, ...(report.companions ?? [])];
  assertInstalledVersions(root, moves);
  const from = report.from ?? report.sites[0]?.finding.change.from ?? '';
  const context: PackContext = {
    from,
    to: report.target,
    includeDeprecated: false,
    ...pack.scanContext?.(root, workspaces),
  };
  const sites = report.sites;
  const known = sites.length;
  const followed: Followed[] = [];
  const affected = [
    ...new Set(sites.flatMap((s) => [s.finding.usage.file, ...(s.editedFiles ?? [])])),
  ];
  const { tests, after, lint, formatted } = await settle({
    root,
    pack,
    context,
    workspaces,
    sites,
    followed,
    affected,
    from,
    target: report.target,
    // The files as they were before the migration are gone from this branch's tip: lint has
    // to pass outright.
    baselineLint: [],
    services,
    fullSuite: report.llm.agent === 'sdk',
    withServices: options.withServices === true,
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.testTimeoutMs ? { testTimeoutMs: options.testTimeoutMs } : {}),
  });
  const buildRequired = report.verification.buildRequired || pack.requiresBuild === true;
  // Rebuilt on this head even when the pack does not require it: a stored result is stale.
  const build = markPreexistingBuilds(
    await (services.build ?? buildWorkspaces)(
      root,
      workspaces,
      undefined,
      options.buildScript ?? configuredBuildScript(root),
    ),
    report.verification.baselineBuild,
  );
  assertInstalledVersions(root, moves);
  const left = git(root, 'status', '--porcelain', '--untracked-files=all')
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.slice(3).startsWith('.uptide/'));
  const newErrors = newDiagnostics(
    report.verification.baseline,
    after,
    report.baseHead ? gitLineMoves(root, report.baseHead) : undefined,
  );
  const unverified = typeResolutionFailure(root, report.verification.baseline);
  const rules = [...new Set(sites.map((s) => s.rule).filter((r): r is string => !!r))];
  // Said first only while it is true of this tree: a stored line may describe pins since aligned.
  const apiVersions =
    report.packContext?.apiVersions ??
    (report.apiChanges && { from: report.apiChanges.from, to: report.apiChanges.to });
  const headline = pack.headline?.({ ...context, ...(apiVersions ? { apiVersions } : {}) });
  const decisions = [
    ...new Set([
      ...(report.decisions ?? []),
      ...(packDecisions(pack, context, rules, followed) ?? []),
    ]),
  ];
  const decided = [
    ...new Set([...(report.decidedRules ?? []), ...decidedRules(pack, context, rules, followed)]),
  ];
  const { headline: _stored, ...kept } = report;
  // The parent commit is the run's own: its build stands for as long as this head's fails (UPT-110).
  const {
    parentBuild: storedParent,
    parentUnchecked: storedUnchecked,
    buildBroken: _broken,
    ...storedVerification
  } = report.verification;
  const headFails = build.some((b) => b.status === 'failed' || b.status === 'timeout');
  const parentBuild = headFails ? storedParent : undefined;
  const parentUnchecked = headFails ? storedUnchecked : undefined;
  const broken = upgradeBrokeBuild(parentBuild) || !!parentUnchecked;
  const checksPassed =
    !unverified &&
    newErrors.length === 0 &&
    left.length === 0 &&
    (!buildRequired ||
      (build.length > 0 && build.every((b) => b.status === 'passed' || b.preexisting))) &&
    tests.every((t) => t.status === 'passed' || t.status === 'missing') &&
    testsOrBuildVouch(report.typeCoverage, tests, build) &&
    lint.every((l) => l.status !== 'failed');
  const result: FixReport = {
    ...kept,
    ...(headline ? { headline } : {}),
    repo: root,
    ...(options.tool ?? uptideVersionInfo()),
    verifiedAt: new Date().toISOString(),
    verificationTimingMs: Date.now() - started,
    head: git(root, 'rev-parse', 'HEAD'),
    verifiedTree: git(root, 'rev-parse', 'HEAD^{tree}'),
    ...(report.baseHead
      ? {
          changedFiles: git(root, 'diff', '--name-only', report.baseHead, 'HEAD')
            .split('\n')
            .filter(Boolean),
        }
      : {}),
    sites,
    verification: {
      ...storedVerification,
      after,
      newErrors,
      tests,
      ...(buildRequired ? { buildRequired: true } : {}),
      build,
      ...(lint.length ? { lint } : {}),
      ...(formatted.length ? { formatted } : {}),
      ...(unverified ? { typesUnverified: unverified } : {}),
      ...(parentBuild ? { parentBuild } : {}),
      ...(parentUnchecked ? { parentUnchecked } : {}),
      ...(broken && checksPassed ? { buildBroken: true as const } : {}),
      passed: checksPassed && !broken,
    },
    ...(decisions.length ? { decisions } : {}),
    ...(decided.length ? { decidedRules: decided } : {}),
    notes: [
      ...report.notes.filter((n) => !n.startsWith('Verified again')),
      `Verified again at a new HEAD: ${sites.length - known} follow-up edit${sites.length - known === 1 ? '' : 's'} and ${formatted.length ? 'formatting' : 'no formatting'} were added as new commits; earlier commits are unchanged.`,
    ],
    prBody: join(root, '.uptide/pr-body.md'),
  };
  delete result.verificationPending;
  delete result.exportError;
  // Judged again from the stored baseline: a reason recorded by an earlier build may not hold.
  if (!unverified) delete result.verification.typesUnverified;
  delete result.publication;
  mkdirSync(dirname(result.prBody), { recursive: true });
  writeFileSync(result.prBody, prBody(result));
  writeFileSync(join(root, '.uptide/report.json'), JSON.stringify(result, null, 2));
  return result;
}
