import { createHash } from 'node:crypto';
import {
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { isMainThread } from 'node:worker_threads';
import { workspacePackagesOf } from '../adapters/typescript/repo.js';
import { errorCode, SafetyRefusal, UptideError } from '../errors.js';
import { ACCEPTED_KEYS, selectLlm } from '../llm/config.js';
import { activePack, assertCandidateLocal } from '../packs/index.js';
import { uptideVersionInfo } from '../version.js';
import { assistedPeerPreflight, assistedRootPins } from './feedback.js';
import { assertNpmLockSync } from './managers/npm-sync.js';
import { PeerPreflightError } from './peer-preflight.js';
import { git, projectRoot } from './process.js';
import { noPackPreflight, rangePreflight } from './range-preflight.js';
import { prBody } from './report.js';
import { type ReverifyOptions, type ReverifyServices, reverify } from './reverify.js';
import { planRootPins } from './root-pins.js';
import { confirmServices, type FixOptions, type FixServices, fix, publishVerified } from './run.js';
import type { FixReport } from './types.js';
import { assertVerifiedTree } from './verified-tree.js';
import { install } from './versions.js';

/** What must be the same in the user's checkout after a run as it was before. */
export interface SourceSnapshot {
  head: string;
  branch: string;
  status: string;
  hooks: string;
  config: string;
}

const tryGit = (cwd: string, ...args: string[]): string => {
  try {
    return git(cwd, ...args);
  } catch {
    return '';
  }
};

/** The repository's git directory, shared by its worktrees: hooks and stored runs live there. */
function gitDir(source: string): string {
  const dir = git(source, 'rev-parse', '--git-common-dir');
  return isAbsolute(dir) ? dir : resolve(source, dir);
}

function hooksDigest(source: string): string {
  const dir = join(gitDir(source), 'hooks');
  if (!existsSync(dir)) return '';
  const hash = createHash('sha256');
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    hash.update(name);
    if (statSync(path).isFile()) hash.update(readFileSync(path));
  }
  return hash.digest('hex');
}

export function snapshot(source: string): SourceSnapshot {
  return {
    head: tryGit(source, 'rev-parse', 'HEAD'),
    branch: tryGit(source, 'branch', '--show-current'),
    status: tryGit(source, 'status', '--porcelain', '--untracked-files=all'),
    hooks: hooksDigest(source),
    config: tryGit(source, 'config', '--local', '--list'),
  };
}

/** What changed in the user's checkout since the snapshot, in words; empty when nothing did. */
export function changedSince(source: string, before: SourceSnapshot): string[] {
  const now = snapshot(source);
  return [
    ...(now.head !== before.head ? ['HEAD moved'] : []),
    ...(now.branch !== before.branch ? ['another branch is checked out'] : []),
    ...(now.status !== before.status ? ['the working tree has different changes'] : []),
    ...(now.hooks !== before.hooks ? ['git hooks were added or changed'] : []),
    ...(now.config !== before.config ? ['the repository git config changed'] : []),
  ];
}

/**
 * A private copy of the repository to work in: a clone, not a worktree, because a worktree
 * shares `.git/hooks` and `.git/config` with the checkout it came from (that is how a hook
 * installer reached a real checkout). The clone pushes where the source pushes, knows the same
 * remote-tracking refs, commits as the same author, and gets the installed dependencies as a
 * copy (copy-on-write where the filesystem has it), so nothing it does lands in the source.
 */
export function isolate(source: string, branch?: string, project = '.'): string {
  const root = realpathSync(resolve(source));
  mkdirSync(runsRoot(), { recursive: true });
  const run = mkdtempSync(join(runsRoot(), 'run-'));
  // The marker is what makes a directory uptide's to delete later.
  writeFileSync(
    join(run, MARKER),
    JSON.stringify({ source: root, created: new Date().toISOString() }),
  );
  const dir = join(run, 'repo');
  git(
    root,
    'clone',
    '--quiet',
    '--no-hardlinks',
    ...(branch ? ['--branch', branch] : []),
    root,
    dir,
  );
  const origin = tryGit(root, 'remote', 'get-url', 'origin');
  if (origin) {
    git(dir, 'remote', 'set-url', 'origin', origin);
    // The clone's `origin/*` were the source's local branches; make them the source's view of the remote.
    tryGit(
      dir,
      'fetch',
      '--quiet',
      '--prune',
      root,
      '+refs/remotes/origin/*:refs/remotes/origin/*',
    );
  } else git(dir, 'remote', 'remove', 'origin');
  for (const key of ['user.name', 'user.email']) {
    const value = tryGit(root, 'config', key);
    if (value) git(dir, 'config', key, value);
  }
  for (const workspace of workspacePackagesOf(join(root, project))) {
    const modules = join(root, project, workspace, 'node_modules');
    if (!existsSync(modules)) continue;
    mkdirSync(join(dir, project, workspace), { recursive: true });
    cpSync(modules, join(dir, project, workspace, 'node_modules'), {
      recursive: true,
      verbatimSymlinks: true,
      mode: constants.COPYFILE_FICLONE,
    });
  }
  return dir;
}

const MARKER = '.uptide-run';
/** Uptide's own temporary root. Nothing outside it is ever deleted. */
export function runsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.UPTIDE_RUNS_DIR
    ? resolve(env.UPTIDE_RUNS_DIR)
    : join(realpathSync(tmpdir()), 'uptide-runs');
}

/**
 * Removes one run directory (given as the run or as its `repo`), and only when it is uptide's:
 * directly inside the temporary root, named like a run, and carrying the marker `isolate`
 * wrote. Anything else is left alone, whatever asked for it. Returns whether it was removed.
 */
export function removeRun(path: string, root: string = runsRoot()): boolean {
  let run: string;
  let base: string;
  try {
    const real = realpathSync(resolve(path));
    run = basename(real) === 'repo' ? dirname(real) : real;
    base = realpathSync(root);
  } catch {
    return false;
  }
  if (dirname(run) !== base || !/^run-[\w-]+$/.test(basename(run))) return false;
  if (!existsSync(join(run, MARKER))) return false;
  rmSync(run, { recursive: true, force: true });
  return true;
}

/** Kept clones older than `days` are removed; younger ones are listed. Only uptide's own. */
export function cleanRuns(options: { days?: number; now?: number; root?: string } = {}): {
  removed: string[];
  kept: string[];
} {
  const root = options.root ?? runsRoot();
  const limit = (options.now ?? Date.now()) - (options.days ?? 7) * 24 * 60 * 60 * 1000;
  const removed: string[] = [];
  const kept: string[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(root).sort();
  } catch {
    return { removed, kept };
  }
  for (const name of entries) {
    const run = join(root, name);
    let created: number;
    try {
      const marker = JSON.parse(readFileSync(join(run, MARKER), 'utf8')) as { created?: string };
      created = Date.parse(marker.created ?? '');
      if (Number.isNaN(created)) created = statSync(run).mtimeMs;
    } catch {
      // No marker: not a run of ours, whatever it is called.
      continue;
    }
    if (created < limit && removeRun(run, root)) removed.push(run);
    else kept.push(run);
  }
  return { removed, kept };
}

const slug = (branch: string): string => branch.replaceAll('/', '__');
/** Where a branch's run is kept in the user's repository: inside `.git`, so `git status` never sees it. */
export function storedRunDir(source: string, branch: string): string {
  return join(gitDir(realpathSync(resolve(source))), 'uptide', slug(branch));
}

/** A run stored for this branch: the legacy `.uptide/report.json` in the checkout, else the one in `.git`. */
export function storedRunFile(source: string, branch: string): string | undefined {
  const legacy = join(source, '.uptide/report.json');
  if (existsSync(legacy)) return legacy;
  const kept = join(storedRunDir(source, branch), 'report.json');
  return existsSync(kept) ? kept : undefined;
}

/**
 * Hands the result back without touching the working tree: the run is stored inside `.git`,
 * and the branch becomes a ref in the user's repository when that needs no checkout change
 * (a new branch, or a fast-forward of one that is not checked out). A branch the user has
 * checked out is left alone. Fresh migrations use a numbered name when the tree differs.
 */
function deliver(
  source: string,
  clone: string,
  report: FixReport,
  before: SourceSnapshot,
  fresh = false,
): FixReport & { delivered: boolean } {
  const result: FixReport & { delivered: boolean } = {
    ...report,
    source,
    ...(fresh ? { base: before.branch || before.head } : {}),
    delivered: false,
  };
  const notes = [...report.notes];
  try {
    assertVerifiedTree(clone, report);
  } catch (error) {
    result.exportError = (error as Error).message;
  }
  try {
    if (!result.exportError) {
      const existingTree = tryGit(
        source,
        'rev-parse',
        '--verify',
        `refs/heads/${report.branch}^{tree}`,
      );
      if (fresh && existingTree && existingTree !== report.verifiedTree) {
        let suffix = 2;
        while (tryGit(source, 'rev-parse', '--verify', `refs/heads/${report.branch}-${suffix}`))
          suffix++;
        result.branch = `${report.branch}-${suffix}`;
        git(clone, 'branch', '-m', report.branch, result.branch);
      }
      if (fresh && existingTree === report.verifiedTree) {
        result.head = git(source, 'rev-parse', `refs/heads/${result.branch}`);
      } else if (fresh) {
        // Fetch objects, then create the ref atomically: a concurrent export must never be overwritten.
        git(source, 'fetch', '--quiet', clone, `refs/heads/${result.branch}`);
        result.head = git(clone, 'rev-parse', `refs/heads/${result.branch}`);
        git(source, 'update-ref', `refs/heads/${result.branch}`, result.head, '');
      } else if (before.branch !== result.branch) {
        git(
          source,
          'fetch',
          '--quiet',
          clone,
          `refs/heads/${result.branch}:refs/heads/${result.branch}`,
        );
      } else {
        notes.push(
          `${report.branch} is checked out in your repository, so it was not moved; the new commits are in ${clone}.`,
        );
      }
      assertVerifiedTree(source, result);
      result.delivered = true;
      if (result.branch !== report.branch) {
        result.branchRenamedFrom = report.branch;
        notes.push(
          `${report.branch} already exists with different content; created ${result.branch}.`,
        );
      }
    }
  } catch (error) {
    result.exportError = (error as Error).message;
  }
  if (result.exportError) notes.push(`Export failed: ${result.exportError}`);
  if (result.exportError) result.verification = { ...result.verification, passed: false };
  const changed = changedSince(source, before);
  if (changed.length) {
    result.sourceChanged = changed;
    notes.push(`Your checkout changed during the run: ${changed.join('; ')}.`);
  }
  result.notes = notes;
  return result;
}

/**
 * The clone goes away unless something still needs it: the user asked to keep it
 * (`--keep-temp`, `--debug`), the export failed, or it is the only place the commits exist;
 * then the report says where it is and why. A run that did not verify is no reason by itself:
 * its clone is removed like any other. The stored run and its PR body are written last.
 */
function finish(
  source: string,
  clone: string,
  delivered: FixReport & { delivered: boolean },
  options: { keep?: boolean; pushed: boolean },
): FixReport {
  const { delivered: inSource, ...result } = delivered;
  const reason = result.exportError
    ? 'export failed: the repository branch does not contain the verified tree'
    : options.keep
      ? 'kept on request (--keep-temp)'
      : result.sourceChanged?.length && result.verification.passed
        ? 'your checkout changed during the run'
        : !inSource && !options.pushed && result.verification.passed
          ? 'it holds commits that are not in your repository or on the remote yet'
          : undefined;
  if (reason) result.clone = { path: clone, kept: true, reason };
  else {
    removeRun(clone);
    result.clone = { path: clone, kept: false };
    // The commits now live in the user's repository (or on the remote): that is where to look.
    result.repo = source;
  }
  const dir = storedRunDir(source, result.branch);
  mkdirSync(dir, { recursive: true });
  result.prBody = join(dir, 'pr-body.md');
  writeFileSync(join(dir, 'report.json'), JSON.stringify(result, null, 2));
  writeFileSync(result.prBody, prBody(result));
  return result;
}

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
/**
 * Until the returned release is called, an interrupt (Ctrl-C, a CI timeout) removes the clones
 * `clones()` names, then raises the signal again so the exit status is the signal's. Signals
 * reach only the main thread: a run in a worker reports its clones there
 * (`watchInterruptibleClones`), and the main thread calls this.
 */
export function removeOnInterrupt(clones: () => Iterable<string>): () => void {
  const handlers = SIGNALS.map((signal) => {
    const handler = () => {
      release();
      for (const clone of clones()) removeRun(clone);
      process.kill(process.pid, signal);
    };
    process.once(signal, handler);
    return [signal, handler] as const;
  });
  const release = () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };
  return release;
}
type CloneWatcher = (clone: string, interruptible: boolean) => void;
let watcher: CloneWatcher | undefined;
/** In a worker thread: report each clone an interrupt must remove to the thread that gets signals. */
export function watchInterruptibleClones(watch: CloneWatcher | undefined): void {
  watcher = watch;
}

/**
 * A run that threw leaves nothing behind: its clone is removed, silently, and so is the clone
 * of a run interrupted while it works (nothing is verified or delivered yet). Asked to keep it
 * (`--keep-temp`, `--debug`), the clone stays and the error says where. Once the work returns,
 * nothing listens any more: a later interrupt cannot touch a finished or kept clone.
 */
async function keeping<T>(clone: string, keep: boolean, work: () => Promise<T>): Promise<T> {
  const release = keep || !isMainThread ? () => {} : removeOnInterrupt(() => [clone]);
  if (!keep) watcher?.(clone, true);
  try {
    return await work();
  } catch (error) {
    if (keep) {
      if (error instanceof Error) error.message += `\nTemporary clone kept: ${clone}`;
    } else removeRun(clone);
    throw error;
  } finally {
    release();
    if (!keep) watcher?.(clone, false);
  }
}

/**
 * `fix` as the CLI runs it: in a private clone, never in the user's checkout. The checkout
 * keeps its branch, its files, its hooks and its config; what it gains is a branch ref and a
 * stored run inside `.git`.
 */
/**
 * The branch a migration's PR is opened against: the remote's default branch as the repository
 * last saw it (`origin/HEAD`, else `origin/main` or `origin/master`). Undefined without a remote.
 */
export function remoteDefaultBranch(root: string): { ref: string; name: string } | undefined {
  const head = tryGit(root, 'symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD');
  const candidates = head
    ? [head.replace(/^refs\/remotes\//, '')]
    : ['origin/main', 'origin/master'];
  for (const ref of candidates) {
    if (!tryGit(root, 'rev-parse', '--verify', '--quiet', ref)) continue;
    return { ref, name: ref.replace(/^origin\//, '') };
  }
  return undefined;
}

export interface PreflightOptions {
  /** A PR will be opened: it must contain the migration and nothing else. */
  pr?: boolean;
  /** `--base`: the branch on `origin` the PR is opened against; default: the remote's default branch. */
  base?: string;
  /** `--allow-dirty`: open the PR although the working tree has uncommitted changes. */
  allowDirty?: boolean;
  /** The caller already ran the preflight and showed its notes: the run does not repeat them. */
  preflightShown?: boolean;
}

const commits = (n: number): string => `${n} commit${n === 1 ? '' : 's'}`;

/**
 * What `fix` settles about the user's repository before any clone, install or LLM call. The
 * migration is made from the commit that is checked out, never from the remote: uncommitted
 * changes are left out and named, a branch that differs from its upstream is said to, and a
 * `--pr` run is refused when the PR would carry more than the migration.
 */
export function fixPreflight(
  cwd: string,
  options: PreflightOptions = {},
): { head: string; notes: string[] } {
  const { top: source, project } = projectRoot(cwd);
  const head = git(source, 'rev-parse', 'HEAD');
  const at = head.slice(0, 12);
  const name = tryGit(source, 'branch', '--show-current');
  const branch = name || `detached HEAD ${at}`;
  const notes: string[] = [];

  const manifest = project === '.' ? 'package.json' : `${project}/package.json`;
  if (!tryGit(source, 'cat-file', '-t', `${head}:${manifest}`))
    throw new UptideError(
      'NOT_REPOSITORY_ROOT',
      `${manifest} is not in commit ${at} (${branch}) of ${source}. fix clones that commit from the local repository, so the file must be committed first.`,
    );

  // `git()` trims, so the first line may have lost a leading space of its status columns.
  const dirty = git(source, 'status', '--porcelain', '--untracked-files=all')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.replace(/^\s*\S{1,2}\s+/, ''));
  if (dirty.length) {
    const files = `${dirty.slice(0, 10).join(', ')}${dirty.length > 10 ? `, and ${dirty.length - 10} more` : ''}`;
    if (options.pr && !options.allowDirty)
      throw new UptideError(
        'DIRTY_WORKING_TREE',
        `The working tree has uncommitted changes, and the PR is made from commit ${at}: ${files}. Commit or stash them, or pass --allow-dirty to leave them out.`,
      );
    notes.push(
      `Uncommitted changes are not part of the migration, made from commit ${at}: ${files}`,
    );
  }

  // The remote as this repository last fetched it: no network here.
  const base = !options.pr
    ? undefined
    : options.base
      ? { ref: `origin/${options.base}`, name: options.base }
      : remoteDefaultBranch(source);
  if (options.pr) {
    if (
      options.base &&
      !tryGit(source, 'rev-parse', '--verify', '--quiet', `origin/${options.base}`)
    )
      throw new UptideError(
        'PUBLICATION_REFUSED',
        `--base ${options.base}: origin/${options.base} is not known in this repository. Push or fetch it first.`,
      );
    const count = (range: string): number =>
      base ? Number(tryGit(source, 'rev-list', '--count', range)) || 0 : 0;
    const ahead = count(`${base?.ref}..${head}`);
    if (base && ahead > 0)
      throw new UptideError(
        'PUBLICATION_REFUSED',
        `${branch} is ${commits(ahead)} ahead of ${base.ref}. Push it first (\`git push origin ${name || 'HEAD:<branch>'}\`) so the PR only contains the migration, or pass --base <branch>. If you pushed from elsewhere, run \`git fetch origin\` and try again.`,
      );
    const behind = count(`${head}..${base?.ref}`);
    if (base && behind > 0)
      notes.push(
        `${branch} is ${commits(behind)} behind ${base.ref}; the PR will be based on an older commit. Consider \`git pull\` first.`,
      );
  }

  const upstream = tryGit(
    source,
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}',
  );
  // Against the PR's own base, the lines above already said it.
  if (upstream && upstream !== base?.ref) {
    const [behind = 0, ahead = 0] = tryGit(
      source,
      'rev-list',
      '--left-right',
      '--count',
      `${upstream}...${head}`,
    )
      .split(/\s+/)
      .map(Number);
    const how =
      ahead && behind
        ? `${commits(ahead)} ahead of ${upstream} and ${commits(behind)} behind it`
        : ahead
          ? `${commits(ahead)} ahead of ${upstream}`
          : behind
            ? `${commits(behind)} behind ${upstream}`
            : '';
    if (how) notes.push(`${branch} is ${how}; migrating your local state`);
  }
  return { head, notes };
}

export async function isolatedFix(
  options: FixOptions & PreflightOptions & { keep?: boolean },
  services?: FixServices,
): Promise<FixReport> {
  assertCandidateLocal(options);
  const selected = selectLlm(options.cwd, options);
  if (
    options.maxCostUsd !== undefined &&
    (!Number.isFinite(options.maxCostUsd) || options.maxCostUsd <= 0)
  )
    throw new Error('--max-cost must be a positive finite amount in USD');
  if (
    !options.fixer &&
    !activePack(options.only, options.allowCandidate) &&
    !options.pack?.rules.length &&
    (options.fixer === null || !selected.available)
  )
    throw new UptideError(
      'NO_FIXER',
      `No agent available. Set the selected provider's key in one of: ${ACCEPTED_KEYS}. Rule-based packs also work with --no-llm.`,
    );
  // Freeze selection before cloning.
  options = { ...options, provider: selected.provider, model: selected.model };
  // The whole repository is cloned; the run works in the project inside it. Everything that
  // can refuse the run does so here, before a clone exists.
  const { top: source, project } = projectRoot(options.cwd);
  const preflight = fixPreflight(options.cwd, options);
  confirmServices(source, options);
  const tool = options.tool ?? uptideVersionInfo();
  if (options.pr && tool.uptideDirty)
    throw new UptideError(
      'DIRTY_UPTIDE_TREE',
      `uptide fix --pr refuses to run from an Uptide checkout with uncommitted changes (at ${tool.uptideCommit.slice(0, 12)}); commit or stash them, rebuild, and run again`,
    );
  const committed = (file: string) =>
    git(source, 'show', `${preflight.head}:${join(project, file)}`);
  // An assisting agent continues past a planning refusal as an agent-led draft (UPT-78).
  const assist =
    options.fixer !== null &&
    !!(options.fixer || selected.available || (options.agent === 'sdk' && services?.agentRunner));
  const agentLed: string[] = [];
  const leadOnly = (error: unknown): void => {
    if (!assist || error instanceof SafetyRefusal) throw error;
    options = {
      ...options,
      plannerFailure: `Planner refused; upgrading the lead only: ${error instanceof Error ? error.message : String(error)}`,
    };
  };
  const target = await rangePreflight(options, services, committed).catch((error: unknown) => {
    // Companions that cannot move together: the lead alone, as a planner refusal in `fix`.
    if (errorCode(error) !== 'INCONSISTENT_UPGRADE') throw error;
    leadOnly(error);
    return undefined;
  });
  if (target) options = { ...options, target };
  if (!options.pinCurrentApi) assertNpmLockSync(options.cwd, committed);
  if (!options.plannerFailure)
    try {
      const planned = await assistedPeerPreflight(options, services, committed, assist);
      options = planned.options;
      if (planned.reason) agentLed.push(planned.reason);
      if (planned.plan)
        options = { ...options, target: planned.plan.target, peerPlan: planned.plan };
    } catch (error) {
      if (error instanceof PeerPreflightError) throw error;
      leadOnly(error);
    }
  if (options.target) noPackPreflight(options, options.target, assist, committed);
  if (!options.pinCurrentApi && options.target) {
    const lead = { name: options.only, to: options.target };
    const pins = assistedRootPins(
      options,
      (o) =>
        planRootPins(options.cwd, [lead, ...(o.peerPlan?.companions ?? [])], o, (file) => {
          const path = join(project, file);
          if (!git(source, 'ls-tree', '--name-only', preflight.head, '--', path)) return undefined;
          return git(source, 'show', `${preflight.head}:${path}`);
        }),
      assist,
    );
    options = pins.options;
    agentLed.push(...pins.reasons);
  }
  if (agentLed.length)
    options = { ...options, agentLed: [...(options.agentLed ?? []), ...agentLed] };
  const before = snapshot(source);
  const clone = isolate(source, undefined, project);
  const { keep, base: _base, allowDirty: _allowDirty, preflightShown, ...rest } = options;
  const report = await keeping(clone, keep === true, async () => {
    // The migration starts from the commit the user has checked out, whatever the remote has.
    git(clone, 'switch', '--quiet', '--detach', preflight.head);
    // Publishing is not part of the run in the clone: it happens below, after the verified
    // run has landed in the user's repository, so a failed publish can be retried alone.
    const result = await fix(
      { ...rest, pr: false, forPublication: options.pr === true, cwd: join(clone, project), tool },
      services,
    );
    if (!preflightShown) result.notes.push(...preflight.notes);
    return result;
  });
  const delivered = deliver(source, clone, report, before, true);
  if (options.base) delivered.prBase = options.base;
  const landed = delivered.delivered;
  // The branch ref and the stored run are in the repository before anything is published.
  const result = finish(source, clone, delivered, { ...(keep ? { keep } : {}), pushed: false });
  if (!options.pr || result.exportError) return result;
  // Publication only follows a successful export to the user's repository.
  await (services?.publish ?? publishVerified)(result, {
    tool,
    ...(options.yes ? { yes: true } : {}),
    ...(landed ? { cwd: source } : {}),
  });
  const dir = storedRunDir(source, result.branch);
  writeFileSync(result.prBody, prBody(result));
  writeFileSync(join(dir, 'report.json'), JSON.stringify(result, null, 2));
  return result;
}

/**
 * `verify` as the CLI runs it: the branch is cloned, verified and extended in the clone, and
 * pushed from there when asked. A fast-forward push only: this never rewrites a branch.
 */
export async function isolatedVerify(
  options: ReverifyOptions & { branch?: string; push?: boolean; keep?: boolean },
  // biome-ignore lint/suspicious/noConfusingVoidType: injected installers may deliberately return no report
  services?: ReverifyServices & { install?(root: string): Promise<unknown | void> },
): Promise<FixReport> {
  const { top: source, project } = projectRoot(options.cwd);
  const before = snapshot(source);
  const branch = options.branch ?? before.branch;
  if (!branch) throw new UptideError('ANALYSIS_FAILED', 'name the migration branch to verify');
  const stored = options.run ? resolve(options.run) : storedRunFile(source, branch);
  if (!stored)
    throw new UptideError(
      'ANALYSIS_FAILED',
      `no stored migration run for ${branch} in this repository`,
    );
  if (options.push && !options.yes)
    throw new UptideError(
      'PUBLICATION_REFUSED',
      `--push would push new commits to ${branch} on origin (fast-forward only); add --yes to confirm`,
    );
  const clone = isolate(source, branch, project);
  const { branch: _branch, push: _push, keep, ...rest } = options;
  const result = await keeping(clone, keep === true, async () => {
    // The checkout's installed dependencies are those of whatever branch it is on. The migration
    // branch has its own lockfile: install that, in the clone, with lifecycle scripts off.
    const root = join(clone, project);
    await (services?.install ?? install)(root);
    mkdirSync(join(root, '.uptide'), { recursive: true });
    writeFileSync(join(root, '.uptide/report.json'), readFileSync(stored));
    const report = await reverify(
      { ...rest, cwd: root, run: join(root, '.uptide/report.json') },
      services,
    );
    const delivered = deliver(source, clone, report, before);
    let pushed = false;
    if (options.push && delivered.verification.passed && !delivered.sourceChanged?.length) {
      // No force, ever: if the remote moved, the push fails and says so.
      assertVerifiedTree(source, delivered);
      assertVerifiedTree(clone, delivered);
      git(clone, 'push', 'origin', `${delivered.head}:refs/heads/${branch}`);
      delivered.notes.push(
        `Pushed ${delivered.head?.slice(0, 8)} to origin/${branch} (fast-forward).`,
      );
      pushed = true;
    }
    return { delivered, pushed };
  });
  return finish(source, clone, result.delivered, {
    ...(keep ? { keep } : {}),
    pushed: result.pushed,
  });
}
