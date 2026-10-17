import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { workspacePackagesOf } from '../adapters/typescript/repo.js';
import { hoistedPackageDir } from '../adapters/typescript/usages.js';
import { companionsOf, type InstalledDependency } from '../check/companions.js';
import { ownTypesFrom } from '../check/removed.js';
import { UptideError } from '../errors.js';
import { createNpmFetcher } from '../fetch/npm-fetcher.js';
import { loadRegistryConfig } from '../fetch/npmrc.js';
import { installedManifest, type Manifest } from '../list/evidence.js';
import { activePack } from '../packs/index.js';
import type { FixOptions, FixServices } from './run.js';
import { resolveTarget } from './target.js';
import { validateVersionRanges } from './versions.js';

/** Validate declarations against their planned targets before cloning or spending. */
export async function rangePreflight(
  options: FixOptions,
  services?: FixServices,
  load = (file: string) => readFileSync(join(options.cwd, file), 'utf8'),
): Promise<string | undefined> {
  if (options.pinCurrentApi) return;
  const root = options.cwd;
  const files = new Map<string, string>();
  const read = (file: string): string => {
    let text = files.get(file);
    if (text === undefined) {
      text = load(file);
      files.set(file, text);
    }
    return text;
  };
  const { installed, names } = fixDependencies(root, read);
  const fetcher = createNpmFetcher({ config: loadRegistryConfig({ cwd: root }) });
  const pack = options.pack ?? activePack(options.only, options.allowCandidate);
  const { version: target } = await resolveTarget(
    pack ?? { name: options.only, defaultTarget: '' },
    options.target,
    services?.resolve ?? fetcher.resolve,
    services?.resolve ? undefined : fetcher,
  );
  validateVersionRanges(root, [{ name: options.only, to: target }], read);
  if (names.size === 1) return target;
  const manifests = services?.manifests ?? fetcher.manifests;
  // Injected manifests come with their own metadata or none: never the network beside them.
  const metadata = services?.manifests ? services.metadata : fetcher.metadata;
  if (!manifests) throw new Error('Registry manifests are required to plan companions');
  const plan = await companionsOf({
    name: options.only,
    target,
    installed: [...installed.values()],
    manifests,
    lockstep: pack?.companions?.map((c) => c.name) ?? [],
    releaseGroup: pack?.releaseGroup?.map((c) => c.name),
    ...(metadata ? { ownTypes: ownTypesFrom(metadata) } : {}),
  });
  if (plan.conflicts.length)
    throw new UptideError('INCONSISTENT_UPGRADE', plan.conflicts.join('; '));
  validateVersionRanges(root, plan.companions, read);
  return target;
}

/** Direct installed dependencies, excluding local workspace links. */
export function fixDependencies(root: string, read: (file: string) => string) {
  const installed = new Map<string, InstalledDependency>();
  const names = new Set<string>();
  const workspaces = workspacePackagesOf(root);
  const workspaceDirs = new Set(workspaces.map((w) => realpathSync(join(root, w))));
  for (const workspace of workspaces) {
    const manifest = JSON.parse(read(join(workspace, 'package.json'))) as Manifest;
    for (const [name, spec] of Object.entries({
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    })) {
      if (/^(workspace|link|file):/.test(spec)) continue;
      const dir = hoistedPackageDir(join(root, workspace), name);
      if (dir && workspaceDirs.has(realpathSync(dir))) continue;
      names.add(name);
      const local = installedManifest(root, workspace, name);
      if (!local?.version) continue;
      const key = `${name}@${local.version}`;
      const known = installed.get(key);
      if (known) known.workspaces.push(workspace);
      else
        installed.set(key, {
          name,
          version: local.version,
          manifest: local,
          workspaces: [workspace],
        });
    }
  }
  return { installed, names };
}
