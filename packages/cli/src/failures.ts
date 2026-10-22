import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ACCEPTED_KEYS, type CheckResult, errorCode, isIndependentProject } from '@uptide/core';
import type { PackageManager, Repo } from './detect.js';
import { CliError } from './errors.js';
import { invocation } from './invocation.js';
import type { DependencyStatus } from './status.js';

/**
 * Every way a first run goes wrong that the user can repair, in one place: what happened,
 * why uptide needs it, and the exact command to run next.
 */

const INSTALL: Record<PackageManager, { fresh: string; locked: string }> = {
  pnpm: { fresh: 'pnpm install', locked: 'pnpm install --frozen-lockfile' },
  npm: { fresh: 'npm install', locked: 'npm ci' },
  yarn: { fresh: 'yarn install', locked: 'yarn install --frozen-lockfile' },
  bun: { fresh: 'bun install', locked: 'bun install --frozen-lockfile' },
};

const names = (list: readonly string[]): string =>
  list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} or ${list.at(-1)}`;

export function noProject(cwd: string): CliError {
  return new CliError(`no package.json in ${resolve(cwd)} or any parent directory`, {
    why: 'uptide analyzes a TypeScript or JavaScript project; this directory is not one.',
    next: `cd path/to/your/project && ${invocation()}`,
  });
}

export function noLockfile(root: string, manager: PackageManager | undefined): CliError {
  return new CliError(`no lockfile found for ${root}`, {
    why: 'Installed versions are read from pnpm-lock.yaml, package-lock.json, yarn.lock or bun.lock.',
    next: INSTALL[manager ?? 'npm'].fresh,
  });
}

export function binaryBunLockfile(root: string): CliError {
  return new CliError(`${join(root, 'bun.lockb')} is a binary lockfile, which uptide cannot read`, {
    why: 'bun writes a text lockfile (bun.lock) since 1.2; that one is supported.',
    next: 'bun install --save-text-lockfile',
  });
}

export function yarnPlugAndPlay(root: string): CliError {
  return new CliError(`${root} uses Yarn Plug'n'Play, which is not supported`, {
    why: "The analysis compiles against packages in node_modules; Plug'n'Play keeps them in zip archives.",
    next: 'yarn config set nodeLinker node-modules && yarn install',
  });
}

/** Each missing dependency with a workspace that declares it. */
export function missingNodeModules(
  repo: Repo,
  missing: readonly { name: string; workspace: string }[],
): CliError {
  const and = (list: readonly string[]) => names(list).replace(' or ', ' and ');
  const one = missing.length === 1;
  const manifests = [...new Set(missing.map((m) => join(m.workspace, 'package.json')))];
  return new CliError(
    `${and(missing.map((m) => m.name))} ${one ? 'is' : 'are'} declared in ${and(manifests)} but not installed: ${
      existsSync(join(repo.root, 'node_modules'))
        ? `node_modules is there, without ${one ? 'it' : 'them'}`
        : 'nothing is installed (no node_modules)'
    }`,
    {
      code: 'PACKAGE_NOT_INSTALLED',
      why: 'Install the dependencies first, then run the same command again. The analysis compiles your code against the installed and the target version.',
      next:
        repo.manager === 'yarn' &&
        (existsSync(join(dirname(repo.lockfile), '.yarnrc.yml')) ||
          /^__metadata:/m.test(readFileSync(repo.lockfile, 'utf8')))
          ? 'yarn install --immutable'
          : INSTALL[repo.manager].locked,
    },
  );
}

export function notInLockfile(repo: Repo, name: string): CliError {
  return new CliError(`${name} is declared in package.json but missing from ${repo.lockfile}`, {
    why: 'The lockfile is out of date with package.json.',
    next: INSTALL[repo.manager].fresh,
  });
}

/** Explicitly asked for, and not there: that is an error, not an empty answer. */
export function notADependency(repo: Repo, missing: readonly string[]): CliError {
  return new CliError(
    `${names(missing).replace(' or ', ' and ')} ${missing.length === 1 ? 'is' : 'are'} not a dependency of ${repo.name ?? repo.root}`,
    {
      why:
        workspaceCount(repo) > 0
          ? `Looked in the root and ${workspaceCount(repo)} workspace packages.`
          : undefined,
      next: invocation(),
    },
  );
}

const workspaceCount = (repo: Repo): number => repo.workspaces.filter((w) => w !== '.').length;

const REGISTRY_FAILURES = ['REGISTRY_UNREACHABLE', 'REGISTRY_TIMEOUT', 'REGISTRY_HTTP_ERROR'];

/** The registry did not answer, or answered with an error after the retries. */
export function isNetworkError(error: unknown): boolean {
  return REGISTRY_FAILURES.includes(errorCode(error) ?? '');
}

export function noNetwork(detail: string): CliError {
  const first = detail.split('\n')[0] ?? detail;
  const http = /HTTP (\d+)(, rate limited)?/.exec(first);
  if (http) {
    const wait = /wait (\d+)s/.exec(first)?.[1];
    return new CliError(
      http[2]
        ? `the npm registry is rate limiting this machine (HTTP ${http[1]})`
        : `the npm registry answered HTTP ${http[1]}`,
      {
        why: `Target versions and their type declarations come from the registry, and it kept refusing after 3 retries (${first}). Nothing was analyzed, so there is no result to trust.`,
        next: wait
          ? `run the same command again in ${wait}s`
          : 'run the same command again in a minute',
      },
    );
  }
  return new CliError('cannot reach the npm registry', {
    why: `Target versions and their type declarations come from the registry (${first}). Behind a proxy, set HTTPS_PROXY; a custom registry is read from .npmrc.`,
    next: 'npm ping',
  });
}

/**
 * The engine reports a registry failure as a skipped package. When nothing at all could be
 * analyzed there is no report to show: the run says why and exits 2. When other
 * dependencies were analyzed, the report lists them and names the ones that failed.
 */
export function networkFailure(report: CheckResult): CliError | undefined {
  const failed = report.packages.filter((p) => REGISTRY_FAILURES.includes(p.skipReason ?? ''));
  const answered = report.packages.some(
    (p) => !['skipped', 'not-imported', 'workspace', 'private'].includes(p.status),
  );
  return failed.length > 0 && !answered
    ? noNetwork(failed[0]?.notes[0] ?? 'registry unavailable')
    : undefined;
}

/**
 * Whether `name` resolves from workspace `w` the way Node would look it up, up to the
 * project root: a copy above it (a stray `~/node_modules`) is not this repository's install
 * (UPT-136).
 */
function installedIn(repo: Repo, w: string, name: string): boolean {
  const top = resolve(repo.root);
  for (let current = join(top, w); ; current = dirname(current)) {
    if (existsSync(join(current, 'node_modules', name, 'package.json'))) return true;
    if (current === top || dirname(current) === current) return false;
  }
}

/** Before any analysis: the selected dependencies exist, are locked and are installed. */
export function requireInstalled(repo: Repo, dependencies: readonly DependencyStatus[]): void {
  for (const dep of dependencies)
    if (dep.workspaces.length > 0 && !dep.installed) throw notInLockfile(repo, dep.name);
  const missing = dependencies.flatMap((dep) => {
    const workspace = dep.workspaces.find((w) => !installedIn(repo, w, dep.name));
    return workspace === undefined ? [] : [{ name: dep.name, workspace }];
  });
  if (missing.length > 0) throw missingNodeModules(repo, missing);
}

/**
 * Before a check of everything: the repository has been installed at all. One optional or
 * platform-specific package missing is normal; every declared dependency missing means
 * `node_modules` is not there.
 */
export function requireNodeModules(repo: Repo, dependencies: readonly DependencyStatus[]): void {
  const declared = dependencies.filter((dep) => dep.workspaces.length > 0);
  const missing = declared.filter((dep) =>
    dep.workspaces.every((w) => !installedIn(repo, w, dep.name)),
  );
  if (declared.length > 0 && missing.length === declared.length)
    throw missingNodeModules(
      repo,
      missing.slice(0, 3).map((dep) => ({ name: dep.name, workspace: dep.workspaces[0] ?? '.' })),
    );
}

function git(root: string, ...args: string[]): string | undefined {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

/** What `fix` needs before it may touch anything: a supported manager, a git root, a clean tree. */
export function requireFixable(repo: Repo, only: string, target?: string): void {
  if (!['pnpm', 'npm', 'yarn'].includes(repo.manager))
    throw new CliError(`fix does not support ${repo.manager} repositories yet`, {
      why: 'It updates the lockfile and verifies the result, which is implemented for npm, pnpm and Yarn. `check` works here and lists every site to migrate.',
      next: `uptide check ${only} --details`,
    });
  const top = git(repo.root, 'rev-parse', '--show-toplevel');
  if (top === undefined)
    throw new CliError(`${repo.root} is not a git repository`, {
      why: 'fix commits the upgrade and each migration step on a new branch.',
      next: 'git init && git add -A && git commit -m "baseline"',
    });
  // The project may live below the git top level (`frontend/` next to a backend); a run from
  // inside one of its workspaces is what is refused.
  for (
    let dir = dirname(realpathSync(repo.root));
    dir.startsWith(realpathSync(top));
    dir = dirname(dir)
  ) {
    if (
      existsSync(join(dir, 'package.json')) &&
      !isIndependentProject(realpathSync(repo.root), dir)
    ) {
      const cwd = /^[\w./-]+$/.test(dir) ? dir : `'${dir.replaceAll("'", "'\"'\"'")}'`;
      throw new CliError('fix has to run at the project root', {
        why: 'Every workspace declaring the dependency is upgraded together.',
        next: `uptide fix ${only}${target ? ` --target ${target}` : ''} --cwd ${cwd}`,
        literalNext: true,
      });
    }
    if (dir === realpathSync(top)) break;
  }
  if (git(repo.root, 'status', '--porcelain', '--untracked-files=all'))
    throw new CliError('the working tree has uncommitted changes', {
      why: 'fix only commits its own edits, so it starts from a clean tree.',
      next: 'git stash --include-untracked',
    });
}

/** Not a failure: the migration still runs, with the rules alone. */
/** `fix` for a package without a pack, and no agent to do the fixing: nothing happens. */
export function noAgentForGeneric(only: string, disabled: boolean): CliError {
  return new CliError(
    `${only} has no migration pack, so every fix would come from the agent, and ${disabled ? 'assisted fixes are off (--no-llm)' : `no selected-provider API key is set (accepted: ${ACCEPTED_KEYS})`}`,
    {
      why: 'Without a pack there are no rules to apply. Nothing was changed: no clone, no branch, no install.',
      next: disabled
        ? `uptide check ${only} --details   (every site, to migrate by hand)`
        : `uptide fix ${only}   (set ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY in your environment first)`,
    },
  );
}

export function noApiKeyNote(only: string, suggest?: (command: string) => string): string {
  const next = `${invocation()} fix ${only}`;
  return [
    `note: no selected-provider API key is set (${ACCEPTED_KEYS}); assisted fixes are off.`,
    '  Rule-based fixes still run; sites they cannot migrate are listed for manual work.',
    `  Next: ${suggest?.(next) ?? next}   (set ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY in your environment first)`,
    '  (or pass --no-llm to keep it that way without this note)',
    '',
  ].join('\n');
}

/** Said before any code is sent, every time it can be. `sdk`: the SDK executor may run. */
export const assistedNote = (provider: string, sdk: boolean): string =>
  [
    'note: assisted fixes are on. For sites the rules cannot migrate, the finding, the',
    '  enclosing code, compiler-linked repository declarations and compiler error',
    `  are sent to ${provider} with your key.`,
    ...(sdk
      ? [
          '  The Agent SDK can also send files throughout the temporary clone',
          '  and the output of type-checks, lint and tests.',
        ]
      : []),
    '',
  ].join('\n');
