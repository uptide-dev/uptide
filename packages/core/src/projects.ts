import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { UptideError } from './errors.js';
import { defaultSkip, directoryRules, type IgnoreRule, ignoredBy } from './list/ignore.js';
import { workspacePackagesOf } from './workspaces.js';

/** An independent install boundary, not just another manifest in a workspace. */
export function hasProjectLockfile(root: string): boolean {
  return [
    'pnpm-lock.yaml',
    'package-lock.json',
    'npm-shrinkwrap.json',
    'yarn.lock',
    'bun.lock',
    'bun.lockb',
  ].some((file) => existsSync(join(root, file)));
}

/** A child lockfile is independent only when the ancestor does not declare it as a workspace. */
export function isIndependentProject(root: string, ancestor: string): boolean {
  return (
    hasProjectLockfile(root) &&
    !workspacePackagesOf(ancestor).some(
      (workspace) => resolve(ancestor, workspace) === resolve(root),
    )
  );
}

function declares(root: string, names: string[]): boolean {
  return workspacePackagesOf(root).some((workspace) => {
    const file = join(root, workspace, 'package.json');
    if (!existsSync(file)) return false;
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    return names.some((name) =>
      ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].some(
        (field) => Object.hasOwn(pkg[field] ?? {}, name),
      ),
    );
  });
}

/**
 * Keep the requested project when it declares the dependency. Otherwise select the unique
 * nested install root that does. Independent projects are never combined into a workspace:
 * their package managers, lockfiles, configuration and verification remain separate.
 */
export function projectForDependency(cwd: string, names: string[]): string {
  const root = resolve(cwd);
  if (!existsSync(root) || declares(root, names)) return cwd;
  const matches: string[] = [];
  const walk = (dir: string, inherited: IgnoreRule[], members: Set<string>): void => {
    const entries = readdirSync(dir, { withFileTypes: true });
    const rules = [
      ...inherited,
      ...directoryRules(
        dir,
        entries.map((entry) => entry.name),
      ),
    ];
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.name.startsWith('.') ||
        defaultSkip(entry.name) ||
        entry.name === 'out'
      )
        continue;
      const child = join(dir, entry.name);
      if (ignoredBy(child, true, rules)) continue;
      let nestedMembers = members;
      if (
        !members.has(child) &&
        existsSync(join(child, 'package.json')) &&
        hasProjectLockfile(child)
      ) {
        if (declares(child, names)) matches.push(child);
        nestedMembers = new Set([
          ...members,
          ...workspacePackagesOf(child).map((w) => resolve(child, w)),
        ]);
      }
      walk(child, rules, nestedMembers);
    }
  };
  walk(root, [], new Set(workspacePackagesOf(root).map((w) => resolve(root, w))));
  if (matches.length > 1)
    throw new UptideError(
      'NO_PROJECT',
      `${names.join(' or ')} is declared in multiple independent projects: ${matches
        .map((dir) => `${relative(root, dir)}/package.json`)
        .sort()
        .join(', ')}; run from the intended directory or pass --cwd <directory>`,
    );
  return matches[0] ?? cwd;
}
