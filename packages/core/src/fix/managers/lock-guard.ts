import { compareVersions, parseVersion } from '../../check/version.js';
import { UptideError } from '../../errors.js';

export interface LockRecord {
  name: string;
  dependencies: string[];
  data: Record<string, unknown>;
  identity: Record<string, unknown>;
  edges: Record<string, string | undefined>;
}
export interface LockGraph {
  records: Map<string, LockRecord>;
  metadata: unknown;
  /** pnpm exposes named importer/catalog specifier-resolution pairs, not manager metadata. */
  resolutionMetadata?: boolean;
  roots?: Record<string, Record<string, string | undefined>>;
  /** npm placements can disappear when a copy is hoisted to an ancestor. */
  relocate?(key: string, previous: LockGraph): string | undefined;
}
const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
/** What an upgrade moves: one package, or a package and the companions that move with it. */
export type Targets = string | readonly string[];
export const targetNames = (targets: Targets): readonly string[] =>
  typeof targets === 'string' ? [targets] : targets;
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function withoutTarget(
  value: Record<string, unknown>,
  target: Targets,
): Record<string, unknown> {
  const result = structuredClone(value);
  for (const section of sections) {
    if (result[section] && typeof result[section] === 'object')
      for (const name of targetNames(target))
        delete (result[section] as Record<string, unknown>)[name];
  }
  return result;
}
/** Content identity plus fields which affect execution or platform selection. */
export function lockedIdentity(
  name: string,
  version: unknown,
  integrity: unknown,
  data: Record<string, unknown>,
): Record<string, unknown> {
  return {
    name,
    version,
    integrity,
    // Without a content hash, a changed locator is not evidence of identical contents.
    source: integrity == null ? (data.resolved ?? data.resolution) : undefined,
    ...Object.fromEntries(
      [
        'scripts',
        'bin',
        'os',
        'cpu',
        'libc',
        'engines',
        'hasInstallScript',
        'requiresBuild',
        'hasBin',
        'hasShrinkwrap',
        'link',
        'inBundle',
      ].map((k) => [k, data[k]]),
    ),
  };
}
export interface LockHousekeeping {
  deduped: { from: string; to: string; name: string; version: string }[];
  metadata: string[];
  /**
   * An unmoved package's dependency the manager moved onto the copy the upgrade installs,
   * within the same major and never older (a client's qs 6.12.0 → express 5's 6.16.1): the
   * old copy goes when nothing else needs it (UPT-135).
   */
  onto?: { name: string; from: string; to: string }[];
}
export interface PeerReresolution {
  name: string;
  from: string;
  to: string;
  peers: string[];
  ranges: Record<string, string>;
  records: string[];
}
/** One dependency version a moved package's subtree lost (`from`), gained (`to`), or both. */
export interface TransitiveChange {
  name: string;
  from?: string;
  to?: string;
}
/** A moved package and what its own subtree changed: why entries outside its name moved. */
export interface MovedSubtree {
  name: string;
  from: string[];
  to: string[];
  changes: TransitiveChange[];
}
/** A lockfile entry outside the upgrade's subtree; no version on a side: absent there. */
export interface OutOfScopeChange {
  name: string;
  from?: string;
  to?: string;
}
export const describeOutOfScope = (c: OutOfScopeChange): string =>
  `${c.name} ${c.from ?? 'none'} → ${c.to ?? 'none'}${c.from && c.from === c.to ? ' (same version, different resolution)' : ''}`;
export interface LockDiff {
  added: string[];
  removed: string[];
  changed: string[];
  allowed: string[];
  housekeeping?: LockHousekeeping;
  peerReresolved?: PeerReresolution[];
  /** Per moved package, the transitive changes its own subtree accounts for. */
  transitive?: MovedSubtree[];
  /** Agent-led runs only: resolutions outside the subtree, kept for review instead of refused. */
  outOfScope?: OutOfScopeChange[];
  /** Resolutions the same install already changes at the parent commit: reported, never refused. */
  parentChurn?: OutOfScopeChange[];
}
function closure(graph: LockGraph, roots: Iterable<string>): Set<string> {
  const queue = [...roots];
  const visited = new Set<string>();
  for (const key of queue) {
    if (visited.has(key)) continue;
    visited.add(key);
    queue.push(...(graph.records.get(key)?.dependencies ?? []));
  }
  return visited;
}
/**
 * Placements reachable from the authorized roots in either lockfile: an entry a moved package
 * reached before may go, one it reaches after may come, and one it reaches in either may
 * change. What only unmoved packages reach is not in scope.
 */
export function lockScope(
  before: LockGraph,
  after: LockGraph,
  target: Targets,
  extraRoots: readonly string[] = [],
): Set<string> {
  const names = targetNames(target);
  const allowed = new Set<string>();
  for (const graph of [before, after])
    for (const key of closure(
      graph,
      [...graph.records]
        .filter(([key, r]) => names.includes(r.name) || extraRoots.includes(key))
        .map(([k]) => k),
    ))
      allowed.add(key);
  return allowed;
}

/**
 * What each moved package's own subtree changed, by package and version: `cmdk` 0.2.1 → 1.0.1
 * replaced `@radix-ui/react-dialog` 1.0.0 with 1.2.0. Versions are compared as sets per name,
 * so a placement or descriptor moving at the same version is no change. Moved packages are
 * reported under their own name, never under one another.
 */
export function transitiveChanges(
  before: LockGraph,
  after: LockGraph,
  target: Targets,
): MovedSubtree[] {
  const names = targetNames(target);
  const versions = (graph: LockGraph, keys: Iterable<string>) => {
    const out = new Map<string, Set<string>>();
    for (const key of keys) {
      const record = graph.records.get(key);
      const version = record?.identity.version;
      if (!record || version === undefined || version === null) continue;
      const set = out.get(record.name) ?? new Set<string>();
      set.add(String(version));
      out.set(record.name, set);
    }
    return out;
  };
  const sorted = (set: Set<string> | undefined) =>
    [...(set ?? [])].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const result: MovedSubtree[] = [];
  for (const name of names) {
    const rootsOf = (graph: LockGraph) =>
      [...graph.records].filter(([, r]) => r.name === name).map(([k]) => k);
    const was = versions(before, closure(before, rootsOf(before)));
    const is = versions(after, closure(after, rootsOf(after)));
    const changes: TransitiveChange[] = [];
    for (const dependency of [...new Set([...was.keys(), ...is.keys()])].sort()) {
      if (names.includes(dependency)) continue;
      const old = sorted(was.get(dependency)).filter((v) => !is.get(dependency)?.has(v));
      const next = sorted(is.get(dependency)).filter((v) => !was.get(dependency)?.has(v));
      if (old.length === 1 && next.length === 1)
        changes.push({ name: dependency, from: old[0] as string, to: next[0] as string });
      else {
        for (const from of old) changes.push({ name: dependency, from });
        for (const to of next) changes.push({ name: dependency, to });
      }
    }
    const from = sorted(was.get(name)),
      to = sorted(is.get(name));
    if (changes.length || from.join() !== to.join()) result.push({ name, from, to, changes });
  }
  return result;
}
/** `replaced a 1.0.0 with 1.2.0`, `removed b 1.0.0`, `added c 2.0.0`. */
export function describeTransitive(change: TransitiveChange): string {
  return change.from !== undefined && change.to !== undefined
    ? `replaced ${change.name} ${change.from} with ${change.to}`
    : change.from !== undefined
      ? `removed ${change.name} ${change.from}`
      : `added ${change.name} ${change.to}`;
}
/**
 * Union authorized subtrees, then protect every outside dependent's actual resolution.
 * `removed` names the `@types` stubs the plan takes out (`check/removed.ts`): an importer's
 * edge to one may disappear, and so may an entry only it reached; nothing about it may be
 * added or changed. Build both graphs with them among the targets, so the importers'
 * declarations of them are not compared.
 */
export function assertLockScope(
  before: LockGraph,
  after: LockGraph,
  target: Targets,
  extraRoots: readonly string[] = [],
  removed: readonly string[] = [],
  acceptOutOfScope = false,
): LockDiff {
  const names = targetNames(target);
  const originalScope = lockScope(before, after, target);
  const allowed = lockScope(before, after, target, extraRoots);
  const dropped = closure(
    before,
    [...before.records].filter(([, r]) => removed.includes(r.name)).map(([k]) => k),
  );
  const diff: LockDiff = { added: [], removed: [], changed: [], allowed: [...allowed].sort() };
  const housekeeping: LockHousekeeping = { deduped: [], metadata: [] };
  const unexpected = new Set<string>();
  if (stable(before.metadata) !== stable(after.metadata)) {
    if (before.resolutionMetadata && after.resolutionMetadata) {
      const left = before.metadata as Record<string, unknown>;
      const right = after.metadata as Record<string, unknown>;
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)]))
        if (stable(left[key]) !== stable(right[key]))
          unexpected.add(`${key} (${stable(left[key])} → ${stable(right[key])})`);
    } else unexpected.add('lockfile metadata/importers');
  }

  // The packages the upgrade installs, by content: Yarn keys `qs@npm:^6.10.0` apart from the
  // `qs@npm:^6.14.0` express 5 reaches, though both resolve to the same qs 6.16.1. Only in a
  // logical lockfile: an npm placement with the same content is another copy on disk.
  const upgradeCopies = new Set(
    after.relocate
      ? []
      : [...after.records]
          .filter(([key]) => originalScope.has(key))
          .map(([, r]) => stable(r.identity)),
  );
  // Moves onto the upgrade's copy the comparison in progress relied on; dropped when it fails.
  const onto: string[] = [];
  const ontoUpgrade = (a: string, b: string): boolean => {
    const left = before.records.get(a),
      right = after.records.get(b);
    const [from, to] = [left?.identity.version, right?.identity.version].map((v) =>
      parseVersion(String(v ?? '')),
    );
    if (!left || !right || left.name !== right.name || !from || !to) return false;
    return (
      (originalScope.has(b) || upgradeCopies.has(stable(right.identity))) &&
      !originalScope.has(a) &&
      from.major === to.major &&
      (from.major > 0 || from.minor === to.minor) &&
      compareVersions(String(right.identity.version), String(left.identity.version)) > 0
    );
  };
  const equivalent = (a: string, b: string, seen = new Set<string>()): boolean => {
    const left = before.records.get(a),
      right = after.records.get(b);
    if (!left || !right || stable(left.identity) !== stable(right.identity)) return false;
    const pair = JSON.stringify([a, b]);
    if (seen.has(pair)) return true;
    seen.add(pair);
    const mark = onto.length;
    const same = sameEdges(left.edges, right.edges, seen);
    if (!same) onto.length = mark;
    return same;
  };
  const sameEdges = (
    left: Record<string, string | undefined>,
    right: Record<string, string | undefined>,
    seen = new Set<string>(),
    declared = false,
  ): boolean =>
    [...new Set([...Object.keys(left), ...Object.keys(right)])].every((name) => {
      if (!Object.hasOwn(left, name) || !Object.hasOwn(right, name))
        return declared && removed.includes(name) && !Object.hasOwn(right, name);
      const a = left[name],
        b = right[name];
      if (a === undefined || b === undefined) return a === b;
      // Intended upgrades stay authorized; dedupe from an outside copy must still compare.
      // A package an importer declares moves only when the plan names it: npm resolves a
      // moved package's peer to the root copy, and reaching it is no consent to move it.
      if (originalScope.has(a) && originalScope.has(b) && (!declared || names.includes(name)))
        return true;
      // Admitted peers may move; their transitive upgrades cannot change an outside consumer.
      if (extraRoots.includes(a) && extraRoots.includes(b)) return true;
      if (equivalent(a, b, seen)) return true;
      // A dependency's, never an importer's: what the repository declares moves only by the plan.
      if (declared || !ontoUpgrade(a, b)) return false;
      onto.push(JSON.stringify([a, b]));
      return true;
    });
  const moves = new Set<string>();
  for (const key of new Set([
    ...Object.keys(before.roots ?? {}),
    ...Object.keys(after.roots ?? {}),
  ])) {
    onto.length = 0;
    if (!sameEdges(before.roots?.[key] ?? {}, after.roots?.[key] ?? {}, new Set(), true))
      unexpected.add(`importer ${key || '.'} resolutions`);
    else for (const move of onto) moves.add(move);
  }

  const counterpart = (
    key: string,
    from: LockGraph,
    to: LockGraph,
    reverse = false,
  ): string | undefined => {
    if (to.records.has(key)) return key;
    if (to.relocate) {
      const placed = to.relocate(key, from);
      if (placed !== undefined && (reverse ? equivalent(placed, key) : equivalent(key, placed)))
        return placed;
      // npm can move an identical copy down into several dependents as well as hoist it.
      // Root/edge checks above still require every outside dependent to resolve identically.
    }
    // Logical lockfiles address descriptors/snapshots rather than physical placements.
    return [...to.records.keys()].find((other) =>
      reverse ? equivalent(other, key) : equivalent(key, other),
    );
  };
  const keys = new Set([...before.records.keys(), ...after.records.keys()]);
  const relocated = new Map<string, string>();
  const orphans: string[] = [];
  for (const key of keys) {
    const a = before.records.get(key),
      b = after.records.get(key);
    const changed = stable(a?.data) !== stable(b?.data);
    if (changed)
      diff[a === undefined ? 'added' : b === undefined ? 'removed' : 'changed'].push(key);
    if (allowed.has(key)) continue;
    // What only a removed stub reached goes with it; an outside dependent's edge to it still compares.
    if (b === undefined && dropped.has(key)) continue;
    onto.length = 0;
    const other = a
      ? counterpart(key, before, after)
      : (counterpart(key, after, before, true) ?? relocated.get(key));
    if (other === undefined || !(a ? equivalent(key, other) : equivalent(other, key))) {
      // Yarn moves a descriptor in place onto the upgrade's copy.
      if (a && b && ontoUpgrade(key, key)) {
        moves.add(JSON.stringify([key, key]));
        continue;
      }
      // A copy that left may have left because its dependents moved onto the upgrade's: below.
      if (b === undefined) orphans.push(key);
      else unexpected.add(key);
      continue;
    }
    for (const move of onto) moves.add(move);
    if (!a || !b) {
      // Old records are visited first; a newly hoisted copy can replace a removed one.
      if (a) relocated.set(other, key);
      const record = a ?? b;
      if (!record) continue;
      const from = a ? key : other,
        to = a ? other : key;
      if (!housekeeping.deduped.some((d) => d.from === from && d.to === to))
        housekeeping.deduped.push({
          from,
          to,
          name: record.name,
          version: String(record.identity.version ?? ''),
        });
    } else if (changed) housekeeping.metadata.push(key);
  }
  // A removed copy is in scope when everything that reached it is: the upgrade's subtree, a
  // dependent accepted above (moved onto the upgrade's copy), or another such removed copy.
  const reachedBy = (key: string) =>
    [...before.records].filter(([, r]) => r.dependencies.includes(key)).map(([k]) => k);
  const excused = new Set<string>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const key of orphans) {
      const by = reachedBy(key);
      if (
        !excused.has(key) &&
        by.length &&
        by.every(
          (p) =>
            allowed.has(p) ||
            dropped.has(p) ||
            excused.has(p) ||
            (!unexpected.has(p) && !orphans.includes(p)),
        )
      ) {
        excused.add(key);
        grew = true;
      }
    }
  }
  for (const key of orphans) if (!excused.has(key)) unexpected.add(key);
  const ontoChanges = new Map<string, { name: string; from: string; to: string }>();
  for (const move of moves) {
    const [a, b] = JSON.parse(move) as [string, string];
    const [left, right] = [before.records.get(a), after.records.get(b)];
    if (!left || !right) continue;
    const change = {
      name: left.name,
      from: String(left.identity.version),
      to: String(right.identity.version),
    };
    ontoChanges.set(stable(change), change);
  }
  if (ontoChanges.size)
    housekeeping.onto = [...ontoChanges.values()].sort((x, y) => x.name.localeCompare(y.name));
  if (unexpected.size) {
    const versionOf = (graph: LockGraph, key: string): string | undefined => {
      const version = graph.records.get(key)?.identity.version;
      return version === undefined ? undefined : String(version);
    };
    const described = [...unexpected].map((key) => {
      if (!keys.has(key)) return key;
      const [a, b] = [versionOf(before, key), versionOf(after, key)];
      return a === undefined
        ? `${key} (added${b ? ` at ${b}` : ''})`
        : b === undefined
          ? `${key} (removed, was ${a})`
          : a !== b
            ? `${key} (${a} → ${b})`
            : `${key} (same version, different resolution, dependencies or execution fields)`;
    });
    if (acceptOutOfScope) {
      // pnpm keeps a package and a snapshot record per version: list each change once.
      const changes = new Map<string, OutOfScopeChange>();
      for (const key of unexpected) {
        const name = (before.records.get(key) ?? after.records.get(key))?.name ?? key;
        const [from, to] = [versionOf(before, key), versionOf(after, key)];
        const change = { name, ...(from ? { from } : {}), ...(to ? { to } : {}) };
        changes.set(stable(change), change);
      }
      diff.outOfScope = [...changes.values()];
    } else
      throw new UptideError(
        'LOCKFILE_OUT_OF_SCOPE',
        `Install changed resolutions outside ${names.join(', ')}'s dependency subtree: ${described.join('; ')}. No upgrade will be committed.`,
      );
  }
  if (housekeeping.deduped.length || housekeeping.metadata.length || housekeeping.onto)
    diff.housekeeping = housekeeping;
  const transitive = transitiveChanges(before, after, target).filter((m) => m.changes.length);
  if (transitive.length) diff.transitive = transitive;
  return diff;
}
