import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { ts } from 'ts-morph';

const SOURCE = /\.[cm]?[jt]sx?$/;
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(["'])([^"'\n]+)\1/g;

/** Module specifiers a file's imports name, as written. */
function specifiersIn(path: string): string[] {
  try {
    return [...readFileSync(path, 'utf8').matchAll(SPECIFIER)].map((m) => m[2] as string);
  } catch {
    return [];
  }
}

/** The compiler options of the tsconfig nearest to `dir` inside `root`, `extends` followed. */
function optionsFor(root: string, dir: string): ts.CompilerOptions | undefined {
  for (let at = dir; ; at = dirname(at)) {
    const config = join(at, 'tsconfig.json');
    if (existsSync(config)) {
      const parsed = ts.readConfigFile(config, (p) => readFileSync(p, 'utf8'));
      if (parsed.error) return undefined;
      return ts.parseJsonConfigFileContent(parsed.config, ts.sys, at).options;
    }
    if (at === root || dirname(at) === at) return undefined;
  }
}

/**
 * How `from` should import `to` (both repository-relative), written the way the repository
 * writes its imports:
 * - through a tsconfig `paths` alias when the file or its neighbours already import through
 *   that alias (`@/lib/stripe` next to an existing `@/lib/env`);
 * - else a relative path, extensionless unless the file's own relative imports (or its
 *   neighbours') carry `.js`, or `.ts` where the compiler allows it, or the module resolution
 *   requires an extension.
 * A suggestion, never a requirement: whatever the agent writes is accepted when it compiles.
 */
export function importSpecifier(root: string, from: string, to: string): string {
  const fromDir = dirname(join(root, from));
  const target = join(root, to).replace(SOURCE, '');
  const options = optionsFor(root, fromDir) ?? {};
  let neighbours: string[] = [];
  try {
    neighbours = readdirSync(fromDir)
      .filter((name) => SOURCE.test(name) && join(fromDir, name) !== join(root, from))
      .slice(0, 40)
      .map((name) => join(fromDir, name));
  } catch {
    // A file without a readable directory has only itself to go by.
  }
  const own = specifiersIn(join(root, from));
  const nearby = [...own, ...neighbours.flatMap(specifiersIn)];

  // A `paths` alias the file or its neighbours already import through.
  const base = options.baseUrl ?? (options as { pathsBasePath?: string }).pathsBasePath ?? root;
  for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
    const [aliasHead = '', aliasTail = ''] = pattern.split('*');
    const wildcard = pattern.includes('*');
    if (!nearby.some((s) => (wildcard ? s.startsWith(aliasHead) : s === pattern))) continue;
    for (const mapped of targets) {
      const [head = '', tail = ''] = resolve(base, mapped).replace(SOURCE, '').split('*');
      if (!wildcard) {
        if (resolve(base, mapped).replace(SOURCE, '') === target) return pattern;
        continue;
      }
      if (!target.startsWith(head) || !target.endsWith(tail)) continue;
      const middle = target.slice(head.length, target.length - tail.length);
      if (middle && !middle.startsWith('/')) return `${aliasHead}${middle}${aliasTail}`;
    }
  }

  let path = relative(fromDir, target).split('\\').join('/');
  if (!path.startsWith('.')) path = `./${path}`;
  const relatives = (list: string[]) => list.filter((s) => s.startsWith('.'));
  const style = relatives(own).length ? relatives(own) : relatives(nearby);
  const tsAllowed =
    options.allowImportingTsExtensions === true ||
    (options as { rewriteRelativeImportExtensions?: boolean }).rewriteRelativeImportExtensions ===
      true;
  if (tsAllowed && style.some((s) => /\.[cm]?tsx?$/.test(s))) return `${path}.ts`;
  if (style.some((s) => /\.[cm]?js$/.test(s))) return `${path}.js`;
  // `module: nodenext` implies its resolution when none is set.
  const { Node16, NodeNext } = ts.ModuleResolutionKind;
  const strict =
    options.moduleResolution === Node16 ||
    options.moduleResolution === NodeNext ||
    (options.moduleResolution === undefined &&
      options.module !== undefined &&
      options.module >= ts.ModuleKind.Node16 &&
      options.module <= ts.ModuleKind.NodeNext);
  if (strict && !style.some((s) => !/\.[cm]?[jt]sx?$/.test(s))) return `${path}.js`;
  return path;
}
