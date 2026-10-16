import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { readInstalled } from '../adapters/typescript/repo.js';
import { workspaceSourceMap } from '../adapters/typescript/workspace-source.js';
import { type ProgressListener, progress } from '../domain/progress.js';
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

interface Plan {
  /** Workspaces whose consumed output must be built, with the entries that need it. */
  needed: Map<string, string[]>;
  /** Each requested workspace, with the needed workspaces it consumes (directly or not). */
  consumers: Map<string, Set<string>>;
}

function plan(root: string, workspaces: string[], moved: string[] = []): Plan {
  const packages = new Map<string, Manifest>();
  for (const workspace of workspacePackagesOf(root)) {
    const file = join(root, workspace, 'package.json');
    if (existsSync(file)) packages.set(workspace, JSON.parse(readFileSync(file, 'utf8')));
  }
  const named = new Map([...packages].flatMap(([dir, pkg]) => (pkg.name ? [[pkg.name, dir]] : [])));
  // Propagate through the whole graph before ordering builds, including dependency cycles.
  const affected = new Set(moved);
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
  const reach = new Map<string, Set<string>>();
  const visit = (workspace: string, consumed: boolean): Set<string> => {
    const pkg = packages.get(workspace);
    if (!pkg) return new Set();
    if (!visited.has(workspace)) {
      visited.add(workspace);
      const below = new Set<string>();
      reach.set(workspace, below);
      for (const name of dependencies(pkg)) {
        const dependency = named.get(name);
        if (dependency === undefined || dependency === workspace) continue;
        for (const dir of visit(dependency, true)) below.add(dir);
        if (needed.has(dependency)) below.add(dependency);
      }
    }
    const below = reach.get(workspace) ?? new Set();
    if (!consumed || needed.has(workspace)) return below;
    const dir = join(root, workspace);
    // What the type-check reads: a runtime-only `default: ./dist/index.js` does not need a build here.
    const typed = targets(pkg.exports).filter((target) => /\.[cm]?tsx?$/.test(target));
    const entries = [...new Set([pkg.types, pkg.typings, ...typed])].filter(
      (target): target is string => typeof target === 'string',
    );
    const required = entries.filter(
      (target) =>
        !present(dir, target) ||
        (rebuild.has(workspace) &&
          (!/\.(?:[cm]?tsx?|json)$/.test(target) || /\.d\.[cm]?ts$/.test(target))),
    );
    if (required.length) needed.set(workspace, required);
    return below;
  };
  const consumers = new Map<string, Set<string>>();
  for (const workspace of workspaces) {
    const below = new Set([...visit(workspace, false)].filter((dir) => dir !== workspace));
    if (below.size) consumers.set(workspace, below);
  }
  for (const workspace of rebuild) visit(workspace, true);
  return { needed, consumers };
}

/** A consumed workspace whose build output is missing. */
export interface Unbuilt {
  dir: string;
  name?: string;
}

/**
 * The workspaces whose consumed build output is missing, by the requested workspace that
 * consumes them. Standalone check runs no repository scripts: it reports these instead.
 */
export function unbuiltWorkspaces(root: string, workspaces: string[]): Record<string, Unbuilt[]> {
  const { consumers } = plan(root, workspaces);
  const unbuilt: Record<string, Unbuilt[]> = {};
  for (const [workspace, dirs] of consumers) {
    // A linked package whose declarations map to its source compiles without its build.
    const dir = join(root, workspace);
    const mapped = Object.keys(workspaceSourceMap(dir, readInstalled(dir).installed).paths);
    const missing = [...dirs]
      .map((dep) => ({ dir: dep, name: nameOf(root, dep) }))
      .filter(
        ({ name }) => !name || !mapped.some((key) => key === name || key.startsWith(`${name}/`)),
      );
    if (missing.length) unbuilt[workspace] = missing;
  }
  return unbuilt;
}

/**
 * The files (relative to `dir`) that import one of the unbuilt packages: their types are
 * judged against declarations that do not exist. The rest of the workspace compiles as usual.
 */
export function importersOf(dir: string, files: string[], unbuilt: Unbuilt[]): string[] {
  const names = unbuilt.flatMap((u) => (u.name ? [u.name] : []));
  if (!names.length) return [];
  const specifier = new RegExp(
    `(?:from|import|require\\()\\s*['"](?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})(?:/[^'"]*)?['"]`,
  );
  return files.filter((file) => {
    try {
      return specifier.test(readFileSync(join(dir, file), 'utf8'));
    } catch {
      return false;
    }
  });
}

function nameOf(root: string, workspace: string): string | undefined {
  try {
    return (JSON.parse(readFileSync(join(root, workspace, 'package.json'), 'utf8')) as Manifest)
      .name;
  } catch {
    return undefined;
  }
}

/** `needs build of packages/internal`: why a consumer's types were not verified. */
export function needsBuildReason(unbuilt: Unbuilt[]): string {
  return `needs build of ${unbuilt.map((u) => u.dir).join(', ')}`;
}

/**
 * Build consumed workspace outputs with fix's verification runner. A build that cannot run
 * or fails is returned as a result, never thrown: the caller reports it and falls back.
 */
export async function prepareWorkspace(
  root: string,
  workspaces: string[],
  options: {
    build: typeof buildWorkspaces;
    buildScript?: string;
    onProgress?: ProgressListener;
    moved?: string[];
  },
): Promise<BuildResult[]> {
  const { needed } = plan(root, workspaces, options.moved);
  if (!needed.size) return [];
  const detail = `workspace build needed: ${[...needed].map(([dir, files]) => `${dir} (${files.join(', ')})`).join('; ')}`;
  let results: BuildResult[];
  try {
    results = await progress(options.onProgress, { phase: 'verify', detail }, () =>
      options.build(
        root,
        [...needed.keys()],
        undefined,
        options.buildScript ?? configuredBuildScript(root),
      ),
    );
  } catch (error) {
    return [
      {
        workspace: '.',
        status: 'failed',
        output: `${detail}; build could not run: ${error instanceof Error ? error.message : String(error)}`,
      },
    ];
  }
  // A build that passed without writing what the consumer reads did not prepare it.
  const missing = [...needed].filter(([dir, files]) =>
    files.some((file) => !present(join(root, dir), file)),
  );
  return [
    ...results,
    ...(results.every((result) => result.status === 'passed')
      ? missing.map(([workspace, files]) => ({
          workspace,
          status: 'failed' as const,
          output: `build passed but required output is still missing: ${files.join(', ')}`,
        }))
      : []),
  ];
}
