import type { PackageFetcher } from '../domain/io.js';
import { errorCode, UptideError } from '../errors.js';
import { createNpmFetcher } from '../fetch/npm-fetcher.js';
import { heldBackText } from '../fetch/release-age.js';
import type { MigrationPack } from '../packs/types.js';

export interface ResolvedTarget {
  version: string;
  /** Where the version came from, for the reader: `latest on npm`, `requested`, the pack's tested target. */
  source: 'requested' | 'latest on npm' | 'release-age policy' | "the pack's tested target";
  /** Why the target is older than the newest release, when the release-age policy chose it. */
  releaseAge?: string;
}

/**
 * One answer to "which version" for check and fix alike: what was asked for, else the npm
 * `latest` dist-tag, which is what check compares against, or the newest release the
 * repository's release-age policy allows (`policy`, the fetcher `resolve` belongs to). The
 * pack's tested target is only the fallback for a run that cannot reach the registry.
 */
export async function resolveTarget(
  pack: Pick<MigrationPack, 'name' | 'defaultTarget'>,
  requested: string | undefined,
  resolve: (name: string, tag: string) => Promise<string> = (name, tag) =>
    createNpmFetcher().resolve(name, tag),
  policy?: Pick<PackageFetcher, 'heldBack' | 'releaseAge'>,
): Promise<ResolvedTarget> {
  if (requested) {
    const version = requested.replace(new RegExp(`^${pack.name}@`), '');
    if (version !== 'latest') {
      // Asked for by name, still refused when the repository's own install would refuse it.
      const held = await policy?.releaseAge?.(pack.name, version);
      if (held)
        throw new UptideError(
          'RELEASE_AGE',
          `${pack.name}@${version} is ${held.age} old; your policy is ${held.policy} (${held.source}), so the install would refuse it.${held.allowed ? ` The newest release old enough is ${held.allowed}.` : ''} Nothing was changed.`,
        );
      return { version, source: 'requested' };
    }
  }
  try {
    const version = await resolve(pack.name, 'latest');
    const held = policy?.heldBack?.(pack.name);
    return held
      ? { version, source: 'release-age policy', releaseAge: heldBackText(held) }
      : { version, source: 'latest on npm' };
  } catch (err) {
    // Without a pack there is no tested target to fall back on: the registry has to answer.
    // Nothing old enough is an answer: the tested target may be just as young.
    if (!pack.defaultTarget || errorCode(err) === 'RELEASE_AGE') throw err;
    return { version: pack.defaultTarget, source: "the pack's tested target" };
  }
}
