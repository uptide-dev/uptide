import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

declare const __UPTIDE_BUILD_VERSION__: string;
export const version: string =
  typeof __UPTIDE_BUILD_VERSION__ !== 'undefined'
    ? __UPTIDE_BUILD_VERSION__
    : JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
declare const __UPTIDE_BUILD_COMMIT__: string;
declare const __UPTIDE_BUILD_DIRTY__: boolean;
declare const __UPTIDE_CLI_VERSION__: string | undefined;
/**
 * The version a user installed and runs: the CLI's. Its build defines
 * `__UPTIDE_CLI_VERSION__` when it bundles this engine; run from source, the CLI package of
 * the checkout says. The engine's own package is never published, so its version (0.1.0)
 * says nothing to a reader of a report or a PR.
 */
export const published: string =
  typeof __UPTIDE_CLI_VERSION__ === 'string' ? __UPTIDE_CLI_VERSION__ : sourceCliVersion();
function sourceCliVersion(): string {
  if (typeof __UPTIDE_BUILD_VERSION__ !== 'undefined') return version;
  try {
    return JSON.parse(readFileSync(new URL('../../cli/package.json', import.meta.url), 'utf8'))
      .version;
  } catch {
    return version;
  }
}

/**
 * What `git status --porcelain` reports, minus the bundler's own scratch file: tsup writes
 * `tsup.config.bundled_<id>.mjs` next to the config while it loads it, which is exactly when
 * the build asks whether the tree is clean. Counting it made every build "dirty".
 */
export function dirtyLines(porcelain: string): string[] {
  return porcelain
    .split('\n')
    .filter((line) => line.trim() !== '')
    .filter((line) => !/(?:^|\/)tsup\.config\.bundled_[\w-]+\.[cm]?js$/.test(line.slice(3)));
}

/**
 * The dirty-tree guard is about reproducing a run from Uptide's source: it applies to a
 * source checkout (development, the eval scripts), never to a published build. A release
 * builds after `changeset version` wrote the new version into the tree, so CI stamps that
 * build clean by saying so (`UPTIDE_BUILD_CLEAN=1`) and fails if the stamp is dirty anyway.
 */
export function uptideVersionInfo(env: NodeJS.ProcessEnv = process.env): {
  uptideVersion: string;
  uptideCommit: string;
  uptideDirty: boolean;
} {
  if (typeof __UPTIDE_BUILD_COMMIT__ !== 'undefined')
    return {
      uptideVersion: published,
      uptideCommit: __UPTIDE_BUILD_COMMIT__,
      uptideDirty: __UPTIDE_BUILD_DIRTY__,
    };
  const clean = env.UPTIDE_BUILD_CLEAN === '1';
  // Source execution resolves the tool's checkout, never the consumer's working directory.
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  try {
    if (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name !== 'uptide-monorepo')
      throw new Error('not the Uptide source checkout');
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', root, ...args], {
        encoding: 'utf8',
        // shortcut: buffers up to 256 MiB, stream if larger repository status is needed.
        maxBuffer: 256 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 30_000,
        killSignal: 'SIGKILL',
      }).trim();
    return {
      uptideVersion: published,
      uptideCommit: git('rev-parse', 'HEAD'),
      uptideDirty:
        !clean && dirtyLines(git('status', '--porcelain', '--untracked-files=all')).length > 0,
    };
  } catch {
    // No checkout to ask (the Uptide Action is downloaded as an archive): the Action passes
    // the commit it is pinned to.
    const commit = /^[0-9a-f]{40}$/.test(env.UPTIDE_BUILD_COMMIT ?? '')
      ? (env.UPTIDE_BUILD_COMMIT as string)
      : 'unknown';
    return { uptideVersion: published, uptideCommit: commit, uptideDirty: false };
  }
}

/** Portable commands retain the release channel of the running CLI. */
export function uptideCommand(cliVersion: string): string {
  const tag = /^\d+\.\d+\.\d+-([a-z]+)/.exec(cliVersion)?.[1];
  return tag ? `npx uptide@${tag}` : 'npx uptide';
}

export function uptideInvocation(cliVersion: string): string {
  const portable = uptideCommand(cliVersion);
  if (!process.argv[1] || process.env.npm_command === 'exec') return portable;
  try {
    const binary = realpathSync(process.argv[1]);
    const names = process.platform === 'win32' ? ['uptide', 'uptide.cmd'] : ['uptide'];
    for (const dir of process.env.PATH?.split(delimiter) ?? []) {
      // Only a real global install counts: package managers prepend project-local
      // (often relative) node_modules/.bin entries that are not on the user's own PATH.
      if (!isAbsolute(dir) || /(^|[\\/])node_modules[\\/]\.bin[\\/]?$/.test(dir)) continue;
      for (const name of names) {
        try {
          return realpathSync(join(dir, name)) === binary ? 'uptide' : portable;
        } catch {
          // This PATH entry has no matching launcher.
        }
      }
    }
  } catch {
    // An unknown running binary needs a portable command.
  }
  return portable;
}

export const UPTIDE_COMMAND = uptideCommand(published);
