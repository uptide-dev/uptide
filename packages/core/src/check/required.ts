import { satisfies, validRange } from '../fetch/range.js';
import type { Manifest } from '../list/evidence.js';
import type { Companion, InstalledDependency } from './companions.js';
import { compareVersions, parseVersion } from './version.js';

type Manifests = Record<string, Pick<Manifest, 'dependencies' | 'peerDependencies'>>;

/** A move the target version requires, as opposed to one its release group makes. */
export interface RequiredPlan {
  moves: Companion[];
  /**
   * Required moves that only a new major makes, never made: `openai 7.9.0 needs zod ^4.0.0;
   * installed 3.25.76, and only a new major satisfies it (zod 4.0.0)`.
   */
  blockers: string[];
  /**
   * Direct dependencies whose own dependency range rejects the lead's target, left with a
   * nested copy of the lead: `@openai/agents 0.1.11 keeps its own openai ^5.20.2; only a new
   * major accepts openai 7.9.0 (@openai/agents 0.15.0)`. Information, never a blocker.
   */
  stays: string[];
}

const stable = (version: string): boolean => {
  const parsed = parseVersion(version);
  return parsed !== undefined && parsed.pre === undefined;
};
/** A range a registry would resolve: `workspace:`, `npm:` aliases and git URLs say nothing here. */
const semverRange = (range: string | undefined): range is string => {
  try {
    return range !== undefined && validRange(range);
  } catch {
    return false;
  }
};
const accepts = (range: string, version: string): boolean => {
  try {
    return satisfies(version, range);
  } catch {
    return false;
  }
};
/**
 * The releases a caret range of `installed` reaches: one major, and for 0.x one minor
 * (`^0.1.11` is `<0.2.0`), the line semver promises compatible. Anything past it is a new major.
 */
const sameLine = (installed: string, version: string): boolean => {
  const a = parseVersion(installed);
  const b = parseVersion(version);
  if (!a || !b || a.major !== b.major) return false;
  if (a.major > 0) return true;
  return a.minor === b.minor && (a.minor > 0 || a.patch === b.patch);
};
/** Stable releases above `installed`, lowest first. */
const newer = (versions: Manifests, installed: string): string[] =>
  Object.keys(versions)
    .filter((v) => stable(v) && compareVersions(v, installed) >= 0)
    .sort(compareVersions);

/** Whether a workspace of `dep` serves a workspace of `host`: the same one, or an ancestor. */
const visibleFrom = (dep: InstalledDependency, host: InstalledDependency): boolean =>
  dep.workspaces.some((d) =>
    host.workspaces.some((h) => h === d || d === '.' || h.startsWith(`${d}/`)),
  );

/**
 * What the planned versions require of the rest of the install, beyond their release group
 * (`companions.ts`): a package the lead's target, or any package the plan moves, declares as a
 * peer or dependency at a range the installed copy does not satisfy, when the installed host
 * accepted it; and a direct dependency whose own dependency range rejects the lead's target.
 * Each moves to the lowest release of its
 * line that agrees. One that only a new major satisfies is never moved: a peer is a blocker,
 * with the exact range; a plain dependency, of a planned version or of a dependent, gets its
 * own nested copy, so the repository's stays (a dependent's is reported as a stay).
 */
export async function requiredMoves(input: {
  lead: InstalledDependency;
  target: string;
  targetManifest: Manifests[string];
  installed: InstalledDependency[];
  manifests: (name: string) => Promise<Manifests>;
  /** What the release-group plan already decided, moved or not: never planned twice. */
  planned: readonly Companion[];
  /** Packages the plan reports on (conflicts, peer conflicts, stays): left to that report. */
  reported: ReadonlySet<string>;
}): Promise<RequiredPlan> {
  const { lead } = input;
  const decided = new Map<string, { version: string; manifest: Manifests[string] }>([
    [lead.name, { version: input.target, manifest: input.targetManifest }],
  ]);
  for (const c of input.planned)
    decided.set(c.name, { version: c.to, manifest: (await input.manifests(c.name))[c.to] ?? {} });
  const moves: Companion[] = [];
  let blockers = new Set<string>();
  let stays = new Set<string>();
  const open = (d: InstalledDependency) =>
    d.name !== lead.name && !decided.has(d.name) && !input.reported.has(d.name);
  const move = async (d: InstalledDependency, to: string, reason: string) => {
    moves.push({ name: d.name, from: d.version, to, reason, required: true });
    decided.set(d.name, { version: to, manifest: (await input.manifests(d.name))[to] ?? {} });
  };
  /** `zod ^4.0.0; installed 3.25.76` for each peer of `manifest` the install rejects. */
  const unmetPeers = (manifest: Manifests[string]): string[] =>
    Object.entries(manifest.peerDependencies ?? {}).flatMap(([name, range]) => {
      if (!semverRange(range)) return [];
      const planned = decided.get(name)?.version;
      const dep = input.installed.find((d) => d.name === name && visibleFrom(d, lead));
      const version = planned ?? dep?.version;
      return version === undefined || accepts(range, version)
        ? []
        : [`${name} ${range}; ${planned ? 'planned' : 'installed'} ${version}`];
    });

  // Until nothing new: a package moved for one requirement can declare the next.
  // The last pass, which moved nothing, is the one whose blockers stand.
  for (let grew = true; grew; ) {
    grew = false;
    blockers = new Set<string>();
    stays = new Set<string>();
    // What a planned version declares, and what the install has.
    for (const [host, at] of [...decided]) {
      for (const peer of [true, false]) {
        const ranges = (peer ? at.manifest.peerDependencies : at.manifest.dependencies) ?? {};
        for (const [name, range] of Object.entries(ranges)) {
          if (!semverRange(range)) continue;
          const dep = input.installed.find(
            (d) => d.name === name && open(d) && visibleFrom(d, lead),
          );
          if (!dep || accepts(range, dep.version)) continue;
          // Broken already by the installed host (morphic's react 19.2.0 under @ai-sdk/react 3's
          // `~19.1.2 || ^19.2.1`): the repository lives with it today, so it is not this upgrade's.
          const today = input.installed.find((d) => d.name === host && visibleFrom(d, lead));
          const before = (peer ? today?.manifest.peerDependencies : today?.manifest.dependencies)?.[
            name
          ];
          if (semverRange(before) && !accepts(before, dep.version)) continue;
          const versions = await input.manifests(name);
          const candidates = newer(versions, dep.version).filter((v) => accepts(range, v));
          const within = candidates.find((v) => sameLine(dep.version, v));
          if (within) {
            await move(dep, within, `${host} ${at.version} requires ${name} ${range}`);
            grew = true;
          } else if (peer)
            blockers.add(
              `${host} ${at.version} needs ${name} ${range}; installed ${dep.version}, and ${candidates[0] ? `only a new major satisfies it (${name} ${candidates[0]})` : 'no release satisfies it'}`,
            );
        }
      }
    }
    // A direct dependency whose own dependency range rejects the lead's target: the package
    // the user asked to move, which that dependency keeps a second, nested copy of (prompty's
    // @azure/ai-projects with openai 6, netlify's verdaccio pinning express 4).
    for (const dep of input.installed) {
      if (!open(dep) || !dep.workspaces.some((w) => lead.workspaces.includes(w))) continue;
      for (const [host, at] of [[lead.name, decided.get(lead.name)]] as const) {
        if (!at) continue;
        const range = dep.manifest.dependencies?.[host];
        if (!semverRange(range) || accepts(range, at.version)) continue;
        const versions = await input.manifests(dep.name);
        const agrees = (v: string) => {
          const theirs = versions[v]?.dependencies?.[host] ?? versions[v]?.peerDependencies?.[host];
          return theirs === undefined || accepts(theirs, at.version);
        };
        const candidates = newer(versions, dep.version).filter(agrees);
        const within = candidates.find((v) => sameLine(dep.version, v));
        if (within) {
          await move(
            dep,
            within,
            `${dep.name} ${dep.version} depends on ${host} ${range}, which rejects ${host} ${at.version}`,
          );
          grew = true;
          break;
        }
        const first = candidates[0];
        const needs = first ? unmetPeers(versions[first] ?? {}) : [];
        stays.add(
          `${dep.name} ${dep.version} keeps its own ${host} ${range}; ${
            first
              ? `only a new major accepts ${host} ${at.version} (${dep.name} ${first}${needs.length ? `, which needs ${needs.join(', and ')}` : ''})`
              : `no release accepts ${host} ${at.version}`
          }`,
        );
      }
    }
  }
  return { moves, blockers: [...blockers].sort(), stays: [...stays].sort() };
}
