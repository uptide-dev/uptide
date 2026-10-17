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

  const equivalent = (a: string, b: string, seen = new Set<string>()): boolean => {
    const left = before.records.get(a),
      right = after.records.get(b);
    if (!left || !right || stable(left.identity) !== stable(right.identity)) return false;
    const pair = JSON.stringify([a, b]);
    if (seen.has(pair)) return true;
    seen.add(pair);
    return sameEdges(left.edges, right.edges, seen);
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
      return equivalent(a, b, seen);
    });
  for (const key of new Set([
    ...Object.keys(before.roots ?? {}),
    ...Object.keys(after.roots ?? {}),
  ]))
    if (!sameEdges(before.roots?.[key] ?? {}, after.roots?.[key] ?? {}, new Set(), true))
      unexpected.add(`importer ${key || '.'} resolutions`);

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
  for (const key of keys) {
    const a = before.records.get(key),
      b = after.records.get(key);
    const changed = stable(a?.data) !== stable(b?.data);
    if (changed)
      diff[a === undefined ? 'added' : b === undefined ? 'removed' : 'changed'].push(key);
    if (allowed.has(key)) continue;
    // What only a removed stub reached goes with it; an outside dependent's edge to it still compares.
    if (b === undefined && dropped.has(key)) continue;
    const other = a
      ? counterpart(key, before, after)
      : (counterpart(key, after, before, true) ?? relocated.get(key));
    if (other === undefined || !(a ? equivalent(key, other) : equivalent(other, key))) {
      unexpected.add(key);
      continue;
    }
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
    if (acceptOutOfScope)
      diff.outOfScope = [...unexpected].map((key) => {
        const name = (before.records.get(key) ?? after.records.get(key))?.name ?? key;
        const [from, to] = [versionOf(before, key), versionOf(after, key)];
        return { name, ...(from ? { from } : {}), ...(to ? { to } : {}) };
      });
    else
      throw new UptideError(
        'LOCKFILE_OUT_OF_SCOPE',
        `Install changed resolutions outside ${names.join(', ')}'s dependency subtree: ${described.join('; ')}. No upgrade will be committed.`,
      );
  }
  if (housekeeping.deduped.length || housekeeping.metadata.length) diff.housekeeping = housekeeping;
  const transitive = transitiveChanges(before, after, target).filter((m) => m.changes.length);
  if (transitive.length) diff.transitive = transitive;
  return diff;
}
