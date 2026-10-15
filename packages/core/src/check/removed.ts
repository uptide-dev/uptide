import type { PackageFetcher } from '../domain/io.js';
import type { Companion } from './companions.js';
import { typedPackageOf } from './types-release.js';
import { parseVersion } from './version.js';

/** A `@types` stub taken out instead of upgraded: `@types/ioredis`, `ioredis 5 ships its own types`. */
export interface Removal {
  name: string;
  from: string;
  reason: string;
}

/**
 * The `@types/<pkg>` companions to remove rather than upgrade. Once a package ships its own
 * types, DefinitelyTyped publishes a last `@types` release that only depends on it, and npm
 * deprecates it as a stub (`@types/ioredis` 5.0.0, `@types/stripe` 8.0.417). A companion is
 * removed when the release the plan moves it to is deprecated **and** the version its package
 * moves to declares its own types (`types`, `typings` or a `types` export). Either alone keeps
 * the upgrade: a deprecation can mean something else, and a package's own types without a stub
 * leave the `@types` release the one that types it.
 */
export async function stubRemovals(input: {
  lead: string;
  target: string;
  companions: readonly Companion[];
  manifests: (name: string) => Promise<Record<string, { deprecated?: string }>>;
  ownTypes: (name: string, version: string) => Promise<boolean>;
}): Promise<{ companions: Companion[]; removals: Removal[] }> {
  const planned = new Map([
    [input.lead, input.target],
    ...input.companions.map((c) => [c.name, c.to] as const),
  ]);
  const companions: Companion[] = [];
  const removals: Removal[] = [];
  for (const c of input.companions) {
    const host = typedPackageOf(c.name);
    const version = host === undefined ? undefined : planned.get(host);
    const stub =
      host !== undefined &&
      version !== undefined &&
      (await input.manifests(c.name))[c.to]?.deprecated !== undefined &&
      (await input.ownTypes(host, version));
    if (!stub) {
      companions.push(c);
      continue;
    }
    // `ioredis 5`, as the line a caret range reaches; a 0.x version is named in full.
    const major = parseVersion(version)?.major;
    removals.push({
      name: c.name,
      from: c.from,
      reason: `${host} ${major ? major : version} ships its own types`,
    });
  }
  return { companions, removals };
}

/**
 * Whether a version declares its own types, from its full manifest; a registry that cannot
 * answer says no, so the `@types` package is upgraded as before rather than removed.
 */
export const ownTypesFrom =
  (metadata: NonNullable<PackageFetcher['metadata']>) =>
  async (name: string, version: string): Promise<boolean> =>
    (await metadata(name, version).catch(() => undefined))?.ownTypes === true;
