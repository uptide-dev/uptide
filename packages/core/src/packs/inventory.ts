import { readdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { globRegExp } from '../glob.js';

function expand(pattern: string): string[] {
  const match = /\{([^{}]+)\}/.exec(pattern);
  return match
    ? (match[1] ?? '')
        .split(',')
        .flatMap((part) =>
          expand(
            pattern.slice(0, match.index) + part + pattern.slice(match.index + match[0].length),
          ),
        )
    : [pattern];
}

/** Workspace-relative, declared files only; generated stores and symlinks are never traversed. */
export function packInventory(
  root: string,
  workspace: string,
  patterns: readonly string[] = [],
): string[] {
  const expanded = patterns.flatMap(expand);
  for (const pattern of expanded)
    if (isAbsolute(pattern) || pattern.split(/[\\/]/).includes('..') || pattern.includes('\0'))
      throw new Error(`Invalid pack inventory path: ${pattern}`);
  if (!expanded.length) return [];
  const matchers = expanded.map(globRegExp);
  const files: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(root, workspace, relative), { withFileTypes: true })) {
      if (
        entry.isSymbolicLink() ||
        ['node_modules', '.git', '.next', '.uptide'].includes(entry.name)
      )
        continue;
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && matchers.some((re) => re.test(file))) files.push(file);
    }
  };
  walk('');
  return files.sort();
}
