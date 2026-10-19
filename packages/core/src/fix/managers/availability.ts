import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UptideError } from '../../errors.js';
import { command } from '../process.js';
import { berrySkipBuild, type PackageManager, packageManager } from './manager.js';

export function repairCommand(pm: PackageManager): string {
  const wanted =
    pm.requestedVersion ??
    (pm.kind === 'yarn-classic' ? '1.22.22' : pm.kind === 'yarn-berry' ? 'stable' : 'latest');
  return `corepack enable ${pm.bin} && corepack prepare ${pm.bin}@${wanted} --activate`;
}

/** The environment corepack runs with: no prompt, no edit to the repository's `packageManager`. */
export const COREPACK_ENV: Record<string, string> = {
  COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
  COREPACK_ENABLE_AUTO_PIN: '0',
};

const versionOf = (output: string): string => output.trim().split('\n').at(-1) ?? '';
const majorOf = (version: string): number => Number(/^(\d+)\./.exec(version)?.[1]);

function matches(pm: PackageManager, version: string): boolean {
  const major = majorOf(version);
  const family =
    pm.kind === 'yarn-classic' ? major === 1 : pm.kind === 'yarn-berry' ? major >= 2 : major >= 7;
  return family && (!pm.requestedVersion || version === pm.requestedVersion);
}

/**
 * Whether the repository pins Yarn 2 or later (`packageManager`, a Berry lockfile) while the
 * `yarn` on PATH is classic 1.x, another version, or absent: the pinned one has to run
 * through corepack, which reads the pin itself. `probe` is `yarn --version` as it answered.
 */
export function needsCorepack(
  pm: PackageManager,
  probe: { code: number; output: string },
): boolean {
  if (pm.kind !== 'yarn-berry') return false;
  return probe.code !== 0 || !matches(pm, versionOf(probe.output));
}

/**
 * The same install, run as `corepack npm …` or `corepack yarn …`: corepack resolves and caches the pinned
 * version on its own, with the download prompt off and without `corepack enable`, so
 * nothing on the user's machine changes outside corepack's cache. `COREPACK_NPM_REGISTRY`
 * from the environment is passed through as it is.
 */
export function throughCorepack(pm: PackageManager): PackageManager {
  return {
    ...pm,
    bin: 'corepack',
    args: [pm.kind === 'npm' ? 'npm' : 'yarn', ...pm.args],
    env: { ...pm.env, ...COREPACK_ENV },
    via: 'corepack',
  };
}

export async function assertManagerAvailable(
  root: string,
  probe = command,
): Promise<PackageManager> {
  let pm = packageManager(root);
  const result = await probe(root, pm.bin, ['--version'], 15000, {
    ...pm.env,
    COREPACK_ENABLE_NETWORK: '0',
    COREPACK_ENABLE_AUTO_PIN: '0',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
  });
  const next = repairCommand(pm);
  let actual = versionOf(result.output);
  if (pm.kind === 'npm' && pm.requestedVersion && (result.code || !matches(pm, actual))) {
    const corepack = await probe(root, 'corepack', ['--version'], 15000, COREPACK_ENV);
    if (!corepack.code) {
      const pinned = throughCorepack(pm);
      const run = await probe(root, pinned.bin, ['npm', '--version'], 120_000, pinned.env);
      if (!run.code && matches(pm, versionOf(run.output)))
        return { ...pinned, actualVersion: versionOf(run.output) };
    }
    // npm 9+ writes v3 by default. A frozen install must still leave every byte intact.
    const format = JSON.parse(readFileSync(join(root, pm.lockfile), 'utf8')).lockfileVersion;
    if (!result.code && majorOf(actual) >= 9 && format === 3)
      return {
        ...pm,
        actualVersion: actual,
        note: `Using local npm@${actual} instead of the repository's npm@${pm.requestedVersion}: Corepack could not run the pin. The repository uses lockfileVersion 3; frozen installs must leave the lockfile unchanged.`,
      };
  }
  if (needsCorepack(pm, result)) {
    const pinned = `yarn@${pm.requestedVersion ?? '2 or later'}`;
    const found = result.code ? 'no yarn is on PATH' : `the yarn on PATH is ${actual || 'unknown'}`;
    const corepack = await probe(root, 'corepack', ['--version'], 15000, COREPACK_ENV);
    if (corepack.code)
      throw new UptideError(
        'PACKAGE_MANAGER_UNAVAILABLE',
        `This repository pins ${pinned} (packageManager), but ${found} and corepack is not available to run the pinned version. Nothing was cloned or installed.\nNext: corepack enable`,
      );
    const viaCorepack = throughCorepack(pm);
    const run = await probe(root, 'corepack', ['yarn', '--version'], 120_000, viaCorepack.env);
    if (run.code)
      throw new UptideError(
        'PACKAGE_MANAGER_UNAVAILABLE',
        `This repository pins ${pinned} (packageManager), but ${found} and corepack could not run the pinned version${run.timeout ? ' (timed out)' : ''}: ${versionOf(run.output) || 'no output'}. Behind a corporate registry, set COREPACK_NPM_REGISTRY to your npm mirror. Nothing was cloned or installed.\nNext: ${next}`,
      );
    pm = viaCorepack;
    actual = versionOf(run.output);
  } else if (result.code)
    throw new UptideError(
      'PACKAGE_MANAGER_UNAVAILABLE',
      `${pm.bin}${pm.requestedVersion ? `@${pm.requestedVersion}` : ''} is not available in this environment. Enable Corepack and activate the repository's package manager.\nNext: ${next}`,
    );
  if (!matches(pm, actual))
    throw new UptideError(
      'PACKAGE_MANAGER_VERSION',
      `Found ${pm.via === 'corepack' ? 'corepack yarn' : pm.bin}@${actual || 'unknown'}, but this repository requires ${pm.requestedVersion ? `${pm.kind === 'npm' ? 'npm' : pm.kind === 'pnpm' ? 'pnpm' : 'yarn'}@${pm.requestedVersion}` : pm.kind}. No files were installed.\nNext: ${next}`,
    );
  if (pm.kind === 'yarn-berry')
    pm.args = pm.args.map((a) =>
      a.startsWith('--mode=') || a === '--skip-builds' ? berrySkipBuild(majorOf(actual)) : a,
    );
  return { ...pm, actualVersion: actual };
}
