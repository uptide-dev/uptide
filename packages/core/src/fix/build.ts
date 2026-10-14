import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseUptideConfig } from '../onboarding/config.js';
import { UPTIDE_CONFIG_FILE } from '../onboarding/schema.js';
import { command } from './process.js';
import type { BuildResult } from './types.js';

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

/** `verify.build` in the repository's own uptide.yml, at its root; undefined when unset or unreadable. */
export function configuredBuildScript(root: string): string | undefined {
  const file = join(root, UPTIDE_CONFIG_FILE);
  if (!existsSync(file)) return undefined;
  try {
    return parseUptideConfig(readFileSync(file, 'utf8'), file).config.verify?.build;
  } catch {
    // An invalid file is reported where settings are read; the default scripts apply here.
    return undefined;
  }
}

/** Scripts tried in order when `verify.build` names none: a CI build, then the build. */
export const BUILD_SCRIPTS = ['build:ci', 'build-ci', 'build'] as const;

function buildScript(
  dir: string,
  names: readonly string[],
): { name: string; script: string } | undefined {
  try {
    const scripts = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts ?? {};
    for (const name of names) {
      const script = scripts[name];
      if (typeof script === 'string' && script.trim()) return { name, script };
    }
  } catch {
    // No readable manifest: no script here.
  }
  return undefined;
}

/** The framework's own build began: a failure after this is the build's, not the setup's. */
const FRAMEWORK =
  /▲ Next\.js|Creating an optimized production build|vite v\d|building for production|Building client|astro build|nuxi build|Compiled (?:successfully|with)/i;
const ENV_VARIABLE = [
  /Environment variable not found: ([A-Z][A-Z0-9_]*)/,
  /Missing (?:required )?environment variables?:?\s*["'`]?([A-Z][A-Z0-9_]*)/i,
  /\b([A-Z][A-Z0-9]*_[A-Z0-9_]+) (?:is not set|is not defined|must be set|is required)\b/,
];
const DATABASE =
  /Can't reach database server|\bP1001\b|ECONNREFUSED[^\n]*:(?:5432|3306|6379|27017|1433)\b|database "[^"]+" does not exist/;

/**
 * Why a build failed before the framework's build started, from its output: an environment
 * variable or a database the repository's CI provides and a clone does not. Undefined when
 * the framework's build ran (that failure is the build's own) or nothing says.
 */
export function buildFailureCause(output: string): string | undefined {
  if (FRAMEWORK.test(output)) return undefined;
  for (const pattern of ENV_VARIABLE) {
    const name = pattern.exec(output)?.[1];
    if (name) return `needs ${name}`;
  }
  return DATABASE.test(output) ? 'needs a database' : undefined;
}

/**
 * The repository's own build script, per workspace: `script` (uptide.yml `verify.build`) when
 * set, else `build:ci`, `build-ci`, then `build`; the workspace's, else the root's (run once for
 * every workspace that falls back to it). Run as typed, like the test script, with the
 * repository's binaries on PATH and credentials left out (`command`). `missing` when neither
 * the workspace nor the root has one.
 */
export async function buildWorkspaces(
  root: string,
  workspaces: string[],
  timeoutMs = 600_000,
  script?: string,
): Promise<BuildResult[]> {
  const names = script ? [script] : BUILD_SCRIPTS;
  let realRoot = root;
  try {
    realRoot = realpathSync(root);
  } catch {
    // The path as given is all there is.
  }
  const plain = (text: string): string =>
    text
      .replace(ANSI, '')
      .split(realRoot)
      .join('<repo>')
      .split(root)
      .join('<repo>')
      .split('\n')
      .slice(-40)
      .join('\n')
      .trim();
  const results: BuildResult[] = [];
  const ran = new Set<string>();
  for (const workspace of workspaces.length ? workspaces : ['.']) {
    const own = buildScript(join(root, workspace), names);
    const dir = own ? join(root, workspace) : root;
    const found = own ?? buildScript(root, names);
    if (!found) {
      results.push({
        workspace,
        status: 'missing',
        output: script ? `no "${script}" script (verify.build in uptide.yml)` : 'no build script',
      });
      continue;
    }
    if (ran.has(dir)) continue;
    ran.add(dir);
    const bins: string[] = [];
    for (let d = dir; ; d = dirname(d)) {
      if (existsSync(join(d, 'node_modules/.bin'))) bins.push(join(d, 'node_modules/.bin'));
      if (d === root || dirname(d) === d) break;
    }
    const result = await command(
      dir,
      process.env.SHELL ?? '/bin/sh',
      ['-c', found.script],
      timeoutMs,
      { PATH: [...bins, process.env.PATH].join(':') },
    );
    const status = result.timeout ? 'timeout' : result.code ? 'failed' : 'passed';
    const output = plain(result.output);
    const cause = status === 'failed' ? buildFailureCause(output) : undefined;
    results.push({
      workspace: own ? workspace : '.',
      status,
      command: found.script,
      script: found.name,
      output,
      ...(cause ? { cause } : {}),
    });
  }
  return results;
}
