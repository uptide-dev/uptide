import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { defaultCacheDir, packagePathSegments } from '../cache/paths.js';
import type { PackageDir } from '../domain/adapter.js';
import type { PackageFetcher } from '../domain/io.js';
import { errorCode, IntegrityError } from '../errors.js';
import { authHeaders, loadRegistryConfig, type RegistryConfig, registryFor } from './npmrc.js';
import {
  downloadTarball,
  type FetchFn,
  listManifests,
  listVersions,
  manifestUrl,
  packumentUrl,
  publishTimes,
  type ResolvedVersion,
  resolveVersion,
  withRetry,
} from './registry.js';
import {
  allowedVersions,
  type HeldBack,
  newestAllowed,
  releaseAgeError,
  windowStart,
} from './release-age.js';
import { extractTgz } from './tar.js';

export interface NpmFetcherOptions {
  /** Where tarballs, extracted packages and registry answers are cached. Defaults to ~/.cache/uptide. */
  cacheDir?: string;
  /** Parent of the per-package extraction directories. Defaults to `<cacheDir>/extracted`. */
  extractRoot?: string;
  /** How long a dist-tag resolution or a version list is trusted. Default one hour. */
  metadataTtlMs?: number;
  /** Registry configuration; loaded from .npmrc when omitted. */
  config?: RegistryConfig;
  /** Injected for tests. */
  fetch?: FetchFn;
  /** How retries wait; injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Per request attempt, body included (default `REQUEST_TIMEOUT_MS`). */
  timeoutMs?: number;
}

export function tarballCachePath(root: string, name: string, version: string): string {
  return join(root, 'tarballs', ...packagePathSegments(name), `${version}.tgz`);
}

export function extractedPath(root: string, name: string, version: string): string {
  return join(root, ...packagePathSegments(name), version);
}

/** Written last, so a half-extracted directory (a crash, a full disk) is never trusted. */
const COMPLETE_MARKER = '.uptide-complete';

const EXACT_VERSION = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function verify(tgz: Buffer, resolved: ResolvedVersion): void {
  if (resolved.integrity) {
    const [algo, expected] = resolved.integrity.split('-', 2) as [string, string];
    const actual = createHash(algo).update(tgz).digest('base64');
    if (actual !== expected) {
      throw new IntegrityError(
        resolved.name,
        resolved.version,
        resolved.integrity,
        `${algo}-${actual}`,
      );
    }
    return;
  }
  if (resolved.shasum) {
    const actual = createHash('sha1').update(tgz).digest('hex');
    if (actual !== resolved.shasum) {
      throw new IntegrityError(resolved.name, resolved.version, resolved.shasum, actual);
    }
  }
}

/**
 * Downloads a published tarball and extracts it. Nothing in the package is ever executed:
 * no install, no lifecycle scripts. Tarballs are cached by name and version; the registry
 * is still consulted once per fetch to resolve the version and learn the tarball URL, so a
 * dist-tag like `latest` always means what it means today.
 */
export function createNpmFetcher(opts: NpmFetcherOptions = {}): PackageFetcher {
  const cacheDir = opts.cacheDir ?? defaultCacheDir();
  const extractRoot = opts.extractRoot ?? join(cacheDir, 'extracted');
  const fetchFn = withRetry(opts.fetch ?? fetch, {
    ...(opts.sleep ? { sleep: opts.sleep } : {}),
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
  });
  const config = opts.config ?? loadRegistryConfig();
  const ttl = opts.metadataTtlMs ?? 60 * 60 * 1000;

  /**
   * Registry answers on disk: an exact version's manifest never changes, so it is kept for
   * good; a dist-tag or a version list is trusted for `ttl`. A run over a workspace asks the
   * same questions many times over, and so does the next run an hour later. When the
   * registry cannot answer (rate limit, outage, no network), the last answer it gave is
   * better than none: an expired entry is used rather than failing the run.
   */
  async function remembered<T>(key: string[], forever: boolean, ask: () => Promise<T>): Promise<T> {
    const path = join(cacheDir, 'registry', ...key.slice(0, -1), `${key.at(-1)}.json`);
    let expired: { value: T } | undefined;
    try {
      const entry = JSON.parse(await readFile(path, 'utf8')) as { at: number; value: T };
      if (forever || Date.now() - entry.at < ttl) return entry.value;
      expired = entry;
    } catch {
      // not cached, or unreadable: ask
    }
    let value: T;
    try {
      value = await ask();
    } catch (err) {
      const code = errorCode(err);
      if (
        expired &&
        (code === 'REGISTRY_UNREACHABLE' ||
          code === 'REGISTRY_TIMEOUT' ||
          code === 'REGISTRY_HTTP_ERROR')
      )
        return expired.value;
      throw err;
    }
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ at: Date.now(), value }));
    await rename(tmp, path);
    return value;
  }

  function resolved(name: string, requested: string): Promise<ResolvedVersion> {
    return remembered(
      [...packagePathSegments(name), `resolve-${requested}`],
      EXACT_VERSION.test(requested),
      async () => {
        const result = await resolveVersion(name, requested, config, fetchFn);
        const registry = registryFor(name, config);
        // Authenticated npm can serve private packages. Only the public, anonymous path
        // is evidence that this exact name/version may be included in optional telemetry.
        return {
          ...result,
          publicRegistry:
            registry === 'https://registry.npmjs.org' &&
            !authHeaders(manifestUrl(name, requested, registry), config).authorization &&
            !authHeaders(packumentUrl(name, registry), config).authorization,
        };
      },
    );
  }

  async function tarballFor(resolved: ResolvedVersion): Promise<Buffer> {
    const path = tarballCachePath(cacheDir, resolved.name, resolved.version);
    try {
      const cached = await readFile(path);
      verify(cached, resolved);
      return cached;
    } catch (err) {
      if (err instanceof IntegrityError) await rm(path, { force: true });
    }
    const tgz = await downloadTarball(resolved, config, fetchFn);
    verify(tgz, resolved);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, tgz);
    await rename(tmp, path);
    return tgz;
  }

  const allVersions = (name: string): Promise<string[]> =>
    remembered([...packagePathSegments(name), 'versions'], false, () =>
      listVersions(name, config, fetchFn),
    );
  /**
   * The release-age policy, when the repository has one: `latest` is the newest version old
   * enough, and versions and manifests leave out the younger ones, so no companion or peer
   * moves to one either. Publish dates are kept for this fetcher only: a cached `latest` is
   * then never newer than the dates it is judged by.
   */
  const policies = config.releaseAge ?? [];
  const held = new Map<string, HeldBack>();
  const times = new Map<string, Promise<Record<string, string>>>();
  const timesOf = (name: string): Promise<Record<string, string>> => {
    let request = times.get(name);
    if (!request) {
      request = publishTimes(name, config, fetchFn, windowStart(policies));
      times.set(name, request);
    }
    return request;
  };
  const allowed = async (name: string, versions: string[]): Promise<string[]> =>
    policies.length ? allowedVersions(policies, name, versions, await timesOf(name)) : versions;

  return {
    metadata: (name, version) =>
      remembered(
        // `manifest-`, not the `metadata-` entries kept before `ownTypes` was read.
        [...packagePathSegments(name), `manifest-${version}`],
        EXACT_VERSION.test(version),
        async () => {
          const manifest = await resolveVersion(name, version, config, fetchFn);
          return {
            ...(manifest.dependencies ? { dependencies: manifest.dependencies } : {}),
            peerDependencies: manifest.peerDependencies ?? {},
            bin: manifest.bin,
            ...(manifest.ownTypes ? { ownTypes: true } : {}),
          };
        },
      ),
    async resolve(name, requested) {
      const version = (await resolved(name, requested)).version;
      if (!policies.length || EXACT_VERSION.test(requested)) return version;
      const result = newestAllowed(
        policies,
        name,
        version,
        await allVersions(name),
        await timesOf(name),
      );
      if (result.held) held.set(name, result.held);
      else held.delete(name);
      if (!result.version) throw releaseAgeError(name, result.held as HeldBack);
      return result.version;
    },
    heldBack: (name) => held.get(name),
    async releaseAge(name, version) {
      if (!policies.length) return undefined;
      return newestAllowed(policies, name, version, await allVersions(name), await timesOf(name))
        .held;
    },
    async versions(name) {
      return allowed(name, await allVersions(name));
    },
    async manifests(name) {
      const all = await remembered([...packagePathSegments(name), 'manifests'], false, () =>
        listManifests(name, config, fetchFn),
      );
      const keep = new Set(await allowed(name, Object.keys(all)));
      return Object.fromEntries(Object.entries(all).filter(([version]) => keep.has(version)));
    },
    async fetch(name, version): Promise<PackageDir> {
      const target = await resolved(name, version);
      // The tarball is verified on every fetch, cached or not; the extraction is reused only then.
      const tgz = await tarballFor(target);
      const dir = extractedPath(extractRoot, name, target.version);
      if (!existsSync(join(dir, COMPLETE_MARKER))) {
        await rm(dir, { recursive: true, force: true });
        await mkdir(dir, { recursive: true });
        extractTgz(tgz, dir);
        await writeFile(join(dir, COMPLETE_MARKER), '');
      }
      return { name, version: target.version, dir };
    },
    async release() {
      // Extractions live in the cache; nothing to remove.
    },
  };
}

/** Hands a fetched directory back: the fetcher keeps it when it caches, otherwise it is removed. */
export async function releasePackage(fetcher: PackageFetcher, pkg: PackageDir): Promise<void> {
  if (fetcher.release) await fetcher.release(pkg);
  else await removePackageDir(pkg).catch(() => undefined);
}

/** Removes an extraction directory. Refuses paths that are not under the given root, so a bug can never delete user files. */
export async function removePackageDir(
  pkg: PackageDir,
  extractRoot: string = tmpdir(),
): Promise<void> {
  const dir = resolve(pkg.dir);
  const root = resolve(extractRoot);
  if (!dir.startsWith(`${root}/`) || dir === root) {
    throw new Error(`refusing to remove ${dir}: not under ${root}`);
  }
  await rm(dir, { recursive: true, force: true });
}
