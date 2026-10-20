import type { DependencyEdit } from './types.js';

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;
/** Fields that steer resolution: only Uptide's install writes them. */
const RESOLUTION_FIELDS = ['overrides', 'resolutions', 'pnpm'] as const;

export const isManifest = (file: string): boolean => /(?:^|\/)package\.json$/.test(file);

/** Lockfiles, package-manager configuration and hooks: Uptide's install owns them, never the agent. */
export const packageManagerFile = (file: string): boolean =>
  /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|\.npmrc|\.yarnrc(?:\.yml)?|\.pnpmfile\.cjs|pnpm-workspace\.yaml)$/.test(
    file,
  );

type Json = Record<string, unknown>;
const text = (value: unknown): string | undefined =>
  value === undefined ? undefined : typeof value === 'string' ? value : JSON.stringify(value);

/**
 * What an agent's edit of an existing `package.json` did to its dependencies (UPT-126). Changing
 * or removing an existing declaration, and any edit to overrides, resolutions or the `pnpm`
 * field, is `refused`: the agent's stated reason is not evidence. `scope` (the upgraded package
 * and its planned companions) is the engine's to set and exempt. A new declaration is `added`.
 */
export function dependencyEdits(
  file: string,
  before: string,
  after: string,
  scope: readonly string[],
): { refused: DependencyEdit[]; added: DependencyEdit[] } {
  const refused: DependencyEdit[] = [];
  const added: DependencyEdit[] = [];
  let old: Json;
  let now: Json;
  try {
    old = JSON.parse(before) as Json;
    now = JSON.parse(after) as Json;
  } catch {
    return { refused: [{ file, reverted: true }], added };
  }
  const diff = (fields: readonly string[], keep: (name: string, from?: string) => boolean) => {
    for (const field of fields) {
      const was = (old[field] ?? {}) as Json;
      const is = (now[field] ?? {}) as Json;
      for (const name of new Set([...Object.keys(was), ...Object.keys(is)])) {
        const from = text(was[name]);
        const to = text(is[name]);
        if (from === to || keep(name, from)) continue;
        refused.push({
          file,
          field,
          name,
          ...(from !== undefined ? { before: from } : {}),
          ...(to !== undefined ? { after: to } : {}),
          reverted: true,
        });
      }
    }
  };
  diff(DEPENDENCY_FIELDS, (name, from) => scope.includes(name) || from === undefined);
  diff(RESOLUTION_FIELDS, () => false);
  for (const field of DEPENDENCY_FIELDS) {
    const was = (old[field] ?? {}) as Json;
    for (const [name, range] of Object.entries((now[field] ?? {}) as Json))
      if (was[name] === undefined) added.push({ file, field, name, after: text(range) });
  }
  return { refused, added };
}

/** The feedback a refused dependency edit sends back: each package, and that it is out of scope. */
export function dependencyObjection(refused: readonly DependencyEdit[]): string | undefined {
  if (!refused.length) return undefined;
  const one = (e: DependencyEdit) =>
    e.name
      ? `${e.file} ${e.field} ${e.name}: ${e.before ?? '(none)'} → ${e.after ?? '(removed)'}`
      : `${e.file}: lockfiles, package-manager configuration and new package.json files are read-only`;
  return `dependency edits refused, outside this upgrade's scope (the upgraded package and its planned companions); only adding a new dependency is allowed, and a stated reason does not change that: ${refused.map(one).join('; ')}`;
}
