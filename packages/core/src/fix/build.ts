import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { command } from './process.js';
import type { BuildResult } from './types.js';

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

function buildScript(dir: string): string | undefined {
  try {
    const script = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts?.build;
    return typeof script === 'string' && script.trim() ? script : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The repository's own `build` script, per workspace: the workspace's, else the root's (run
 * once for every workspace that falls back to it). Run as typed, like the test script, with
 * the repository's binaries on PATH and credentials left out (`command`). `missing` when
 * neither the workspace nor the root has one.
 */
export async function buildWorkspaces(
  root: string,
  workspaces: string[],
  timeoutMs = 600_000,
): Promise<BuildResult[]> {
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
    const own = buildScript(join(root, workspace));
    const dir = own ? join(root, workspace) : root;
    const script = own ?? buildScript(root);
    if (!script) {
      results.push({ workspace, status: 'missing', output: 'no build script' });
      continue;
    }
    if (ran.has(dir)) continue;
    ran.add(dir);
    const bins: string[] = [];
    for (let d = dir; ; d = dirname(d)) {
      if (existsSync(join(d, 'node_modules/.bin'))) bins.push(join(d, 'node_modules/.bin'));
      if (d === root || dirname(d) === d) break;
    }
    const result = await command(dir, process.env.SHELL ?? '/bin/sh', ['-c', script], timeoutMs, {
      PATH: [...bins, process.env.PATH].join(':'),
    });
    results.push({
      workspace: own ? workspace : '.',
      status: result.timeout ? 'timeout' : result.code ? 'failed' : 'passed',
      command: script,
      output: plain(result.output),
    });
  }
  return results;
}
