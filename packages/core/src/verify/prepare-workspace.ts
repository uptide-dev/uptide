import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { type ProgressListener, progress } from '../domain/progress.js';
import { UptideError } from '../errors.js';
import { type buildWorkspaces, configuredBuildScript } from '../fix/build.js';
import type { BuildResult } from '../fix/types.js';
import { globRegExp, workspacePackagesOf } from '../workspaces.js';

interface Manifest {
  name?: string;
  types?: string;
  typings?: string;
  exports?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function targets(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(targets);
}

function present(dir: string, target: string): boolean {
  if (!target.includes('*')) return existsSync(resolve(dir, target));
  const prefix = dirname(`${target.slice(0, target.indexOf('*'))}_`);
  const base = resolve(dir, prefix);
  if (!existsSync(base)) return false;
  const pattern = globRegExp(target.replace(/^\.\//, ''));
  return readdirSync(base, { recursive: true }).some((file) =>
    pattern.test(relative(dir, join(base, String(file)))),
  );
}

function dependencies(pkg: Manifest): string[] {
  return Object.keys({
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
    ...pkg.optionalDependencies,
  });
}

/** Prepare consumed workspace outputs; only fix's verification supplies a script runner. */
export async function prepareWorkspace(
  root: string,
  workspaces: string[],
  options: {
    buildScript?: string;
    onProgress?: ProgressListener;
    build?: typeof buildWorkspaces;
    moved?: string[];
  } = {},
): Promise<BuildResult[]> {
  const packages = new Map<string, Manifest>();
  for (const workspace of workspacePackagesOf(root)) {
    const file = join(root, workspace, 'package.json');
    if (existsSync(file)) packages.set(workspace, JSON.parse(readFileSync(file, 'utf8')));
  }
  const named = new Map([...packages].flatMap(([dir, pkg]) => (pkg.name ? [[pkg.name, dir]] : [])));
  // Propagate through the whole graph before ordering builds, including dependency cycles.
  const affected = new Set(options.moved);
  const rebuild = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [dir, pkg] of packages) {
      if (rebuild.has(dir) || !dependencies(pkg).some((name) => affected.has(name))) continue;
      rebuild.add(dir);
      if (pkg.name) affected.add(pkg.name);
      changed = true;
    }
  }
  const visited = new Set<string>();
  const needed = new Map<string, string[]>();
  const visit = (workspace: string, consumed: boolean): void => {
    const pkg = packages.get(workspace);
    if (!pkg) return;
    if (!visited.has(workspace)) {
      visited.add(workspace);
      for (const name of dependencies(pkg)) {
        const dependency = named.get(name);
        if (dependency !== undefined && dependency !== workspace) visit(dependency, true);
      }
    }
    if (!consumed || needed.has(workspace)) return;
    const dir = join(root, workspace);
    const entries = [...new Set([pkg.types, pkg.typings, ...targets(pkg.exports)])].filter(
      (target): target is string => typeof target === 'string',
    );
    const required = entries.filter(
      (target) =>
        !present(dir, target) ||
        (rebuild.has(workspace) &&
          (!/\.(?:[cm]?tsx?|json)$/.test(target) || /\.d\.[cm]?ts$/.test(target))),
    );
    if (required.length) needed.set(workspace, required);
  };
  for (const workspace of workspaces) visit(workspace, false);
  for (const workspace of rebuild) visit(workspace, true);
  if (!needed.size) return [];
  const detail = `workspace build needed: ${[...needed].map(([dir, files]) => `${dir} (${files.join(', ')})`).join('; ')}`;
  if (!options.build)
    throw new UptideError(
      'WORKSPACE_BUILD_FAILED',
      `${detail}; check does not run repository scripts. Build these workspaces first or run fix, which builds in its verification clone.`,
    );
  const build = options.build;
  const results = await progress(options.onProgress, { phase: 'verify', detail }, () =>
    build(root, [...needed.keys()], undefined, options.buildScript ?? configuredBuildScript(root)),
  );
  const failed = results.filter((result) => result.status !== 'passed');
  const missing = [...needed].filter(([dir, files]) =>
    files.some((file) => !present(join(root, dir), file)),
  );
  if (failed.length || missing.length)
    throw new UptideError(
      'WORKSPACE_BUILD_FAILED',
      `${detail}; cannot type-check: ${failed.length ? failed.map((result) => `${result.workspace}: ${result.status}${result.status === 'missing' ? ` (${result.output})` : result.cause ? ` (${result.cause})` : ''}`).join('; ') : 'build passed but required output is still missing'}. Run the workspace build or set verify.build in uptide.yml.`,
    );
  return results;
}
