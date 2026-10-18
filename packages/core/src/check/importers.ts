import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { ts } from 'ts-morph';

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const SKIPPED = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.next', '.turbo']);

/** `from 'pkg'`, `require('pkg')`, `import('pkg')`, with or without a subpath; group 1 is the name. */
function importPattern(names: readonly string[]): RegExp {
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(
    `(?:\\bfrom\\s*|\\bimport\\s*\\(?\\s*|\\brequire\\s*\\(\\s*|\\bimport\\s+)["'](${escaped})(?:\\/[^"']*)?["']`,
    'g',
  );
}

/** Every source file under `dir` (not declarations, not build output or `exclude`d directories), until `visit` returns true. */
function eachSource(
  dir: string,
  exclude: ReadonlySet<string>,
  visit: (path: string, text: string) => boolean | undefined,
): void {
  const walk = (at: string): boolean => {
    let entries: string[];
    try {
      entries = readdirSync(at);
    } catch {
      return false;
    }
    for (const name of entries) {
      if (SKIPPED.has(name)) continue;
      const path = join(at, name);
      if (exclude.has(path)) continue;
      let directory = false;
      try {
        directory = statSync(path).isDirectory();
      } catch {
        continue;
      }
      if (directory) {
        if (walk(path)) return true;
        continue;
      }
      if (!SOURCE.test(name) || /\.d\.[cm]?ts$/.test(name)) continue;
      let text: string;
      try {
        text = readFileSync(path, 'utf8');
      } catch {
        continue;
      }
      if (visit(path, text)) return true;
    }
    return false;
  };
  walk(dir);
}

/**
 * Which of `names` a workspace's own sources import, by reading the files: `from 'pkg'`,
 * `require('pkg')`, `import('pkg')`, with or without a subpath. Only the workspace's own
 * directory counts, not nested workspaces: a package pulled into a program through another
 * workspace's files is that workspace's import, not this one's. Cheap enough to run for every
 * workspace in the main thread, which is what lets every workspace know who else imports.
 */
export function importedByText(
  root: string,
  workspace: string,
  names: readonly string[],
  nested: readonly string[] = [],
): string[] {
  if (names.length === 0) return [];
  const dir = resolve(root, workspace);
  const exclude = new Set(
    nested
      .filter((w) => w !== workspace)
      .map((w) => resolve(root, w))
      .filter((other) => other.startsWith(`${dir}/`)),
  );
  const pattern = importPattern(names);
  const found = new Set<string>();
  eachSource(dir, exclude, (_, text) => {
    for (const match of text.matchAll(pattern)) if (match[1]) found.add(match[1]);
    return found.size === names.length;
  });
  return [...found].sort();
}

/**
 * The files under `dir` that import one of `names`, relative to it, read as text: the
 * JavaScript a tsconfig without `allowJs` leaves out of the program counts too. The
 * denominator of type coverage (`check/verdict.ts`).
 */
export function filesImporting(
  dir: string,
  names: readonly string[],
  exclude: readonly string[] = [],
): string[] {
  if (names.length === 0) return [];
  const pattern = importPattern(names);
  const files: string[] = [];
  eachSource(dir, new Set(exclude), (path, text) => {
    pattern.lastIndex = 0;
    if (pattern.test(text)) files.push(relative(dir, path));
    return undefined;
  });
  return files.sort();
}

/**
 * In how many of the repository's own source files each of `names` is imported: the cheap
 * stand-in for call sites that ranks dependencies before any of them is analyzed.
 */
export function importFileCounts(root: string, names: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>(names.map((n) => [n, 0]));
  if (names.length === 0) return counts;
  const pattern = importPattern(names);
  eachSource(resolve(root), new Set(), (_, text) => {
    const inFile = new Set<string>();
    for (const match of text.matchAll(pattern)) if (match[1]) inFile.add(match[1]);
    for (const name of inFile) counts.set(name, (counts.get(name) ?? 0) + 1);
    return undefined;
  });
  return counts;
}

const stem = (file: string): string => basename(file).replace(/\.[cm]?[jt]sx?$/, '');

const parseFile = (file: string): ts.SourceFile | undefined => {
  try {
    return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false);
  } catch {
    return undefined;
  }
};

const specifierOf = (node: ts.Node): string | undefined =>
  (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
  node.moduleSpecifier &&
  ts.isStringLiteral(node.moduleSpecifier)
    ? node.moduleSpecifier.text
    : undefined;

/**
 * What a root exports whose declaration depends on one of `packages`: it names a binding
 * imported from one, directly or through the file's other top-level declarations
 * (`const base = z.object(...); export const Schema = base.extend(...)`). `default` for the
 * default export, `*` for a wholesale re-export of the package.
 */
export function packageExports(file: string, packages: ReadonlySet<string>): Set<string> {
  const exports = new Set<string>();
  const source = parseFile(file);
  if (!source) return exports;
  const fromPackage = (specifier: string | undefined): boolean =>
    specifier !== undefined &&
    [...packages].some((p) => specifier === p || specifier.startsWith(`${p}/`));
  const tainted = new Set<string>();
  const declarations = new Map<string, ts.Statement>();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!fromPackage(specifierOf(statement))) continue;
      const clause = statement.importClause;
      if (clause?.name) tainted.add(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) tainted.add(bindings.name.text);
      else if (bindings) for (const e of bindings.elements) tainted.add(e.name.text);
      continue;
    }
    const named = (name: ts.Node | undefined): void => {
      if (name && ts.isIdentifier(name)) declarations.set(name.text, statement);
      // `const { a, b } = ...`: every name it binds.
      else if (name)
        ts.forEachChild(name, (child) => named(ts.isBindingElement(child) ? child.name : child));
    };
    if (ts.isVariableStatement(statement))
      for (const d of statement.declarationList.declarations) named(d.name);
    else if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isModuleDeclaration(statement)
    )
      named(statement.name);
  }
  if (tainted.size === 0 && !source.statements.some((s) => fromPackage(specifierOf(s))))
    return exports;
  const mentions = (node: ts.Node): boolean => {
    let hit = false;
    const visit = (n: ts.Node): void => {
      if (hit) return;
      if (ts.isIdentifier(n) && tainted.has(n.text)) hit = true;
      else ts.forEachChild(n, visit);
    };
    visit(node);
    return hit;
  };
  // To a fixed point: a declaration naming a tainted one is tainted.
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, statement] of declarations)
      if (!tainted.has(name) && mentions(statement)) {
        tainted.add(name);
        grew = true;
      }
  }
  for (const statement of source.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    const exported = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const isDefault = modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
    if (ts.isExportAssignment(statement)) {
      if (mentions(statement)) exports.add('default');
    } else if (ts.isExportDeclaration(statement)) {
      const reexport = fromPackage(specifierOf(statement));
      const clause = statement.exportClause;
      if (!clause) {
        if (reexport) exports.add('*');
      } else if (ts.isNamespaceExport(clause)) {
        if (reexport) exports.add(clause.name.text);
      } else
        for (const e of clause.elements)
          if (
            reexport ||
            (!statement.moduleSpecifier && tainted.has((e.propertyName ?? e.name).text))
          )
            exports.add(e.name.text);
    } else if (exported)
      for (const [name, declaration] of declarations)
        if (declaration === statement && tainted.has(name))
          exports.add(isDefault ? 'default' : name);
  }
  return exports;
}

/**
 * The repository files among `files` that import one of `roots`: direct importers only, never
 * their importers. Text first: only a specifier ending in a root's name (`@/lib/tools/fetch`,
 * `./tools`) is resolved. With `packages`, an importer counts only when what it imports from
 * a root depends on one of them (`packageExports`): a root's unrelated helpers cannot break
 * with the package.
 */
export function importersOf(
  files: string[],
  roots: string[],
  options: ts.CompilerOptions,
  packages?: readonly string[],
): string[] {
  const wanted = new Set(roots.map((f) => resolve(f)));
  const names = new Set(roots.map((f) => (stem(f) === 'index' ? basename(dirname(f)) : stem(f))));
  const dependent = new Map<string, Set<string>>();
  const exportsOf = (root: string): Set<string> => {
    let found = dependent.get(root);
    if (!found) {
      // Through the root's own re-exports too: a barrel root hands on its modules' exports.
      found = localExports(root, new Set(packages), options, new Map());
      dependent.set(root, found);
    }
    return found;
  };
  // Whether what `file` takes from the roots it imports (specifier → root) depends on the package.
  const takesDependent = (file: string, hits: Map<string, string>): boolean => {
    const source = parseFile(file);
    if (!source) return true;
    const seen = new Set<string>();
    for (const statement of source.statements) {
      const specifier = specifierOf(statement);
      const root = specifier === undefined ? undefined : hits.get(specifier);
      if (!root) continue;
      seen.add(specifier as string);
      const exported = exportsOf(root);
      if (exported.size === 0) continue;
      if (ts.isExportDeclaration(statement)) {
        const clause = statement.exportClause;
        if (!clause || ts.isNamespaceExport(clause)) return true;
        if (clause.elements.some((e) => exported.has((e.propertyName ?? e.name).text))) return true;
        continue;
      }
      const clause = (statement as ts.ImportDeclaration).importClause;
      if (clause?.name && exported.has('default')) return true;
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) return true;
      if (bindings?.elements.some((e) => exported.has((e.propertyName ?? e.name).text)))
        return true;
    }
    // `import('./root')`, `require('./root')`: what is used is out of reach, so it counts.
    return [...hits].some(([specifier, root]) => !seen.has(specifier) && exportsOf(root).size > 0);
  };
  return files.filter((file) => {
    if (wanted.has(file) || file.includes('/node_modules/') || /\.d\.[cm]?ts$/.test(file))
      return false;
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      return false;
    }
    const hits = new Map<string, string>();
    for (const [, specifier] of text.matchAll(
      /(?:\bfrom|\bimport|\brequire)\s*\(?\s*["']([^"'\n]+)["']/g,
    )) {
      if (!specifier || hits.has(specifier) || !names.has(stem(specifier))) continue;
      const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule;
      const target = resolved && resolve(resolved.resolvedFileName);
      if (target && wanted.has(target)) hits.set(specifier, target);
    }
    if (hits.size === 0) return false;
    return packages === undefined || takesDependent(file, hits);
  });
}

/** Whether `file` hands on another repository module's exports (`export * from './client'`). */
export function isBarrel(file: string, options: ts.CompilerOptions): boolean {
  return (parseFile(file)?.statements ?? []).some(
    (s) =>
      ts.isExportDeclaration(s) &&
      !s.isTypeOnly &&
      s.moduleSpecifier !== undefined &&
      ts.isStringLiteral(s.moduleSpecifier) &&
      localModule(s.moduleSpecifier.text, file, options) !== undefined,
  );
}

/** The repository file a specifier names, the way the compiler resolves it; never a package. */
function localModule(
  specifier: string,
  from: string,
  options: ts.CompilerOptions,
): string | undefined {
  const target = ts.resolveModuleName(specifier, from, options, ts.sys).resolvedModule
    ?.resolvedFileName;
  return target && !target.includes('/node_modules/') && !/\.d\.[cm]?ts$/.test(target)
    ? resolve(target)
    : undefined;
}

/**
 * What a repository module exports that depends on `packages` (`packageExports`), through its
 * own re-exports too: `export * from './schema'` is how a `lib/zod/index.ts` hands on its schemas.
 */
function localExports(
  file: string,
  packages: ReadonlySet<string>,
  options: ts.CompilerOptions,
  seen: Map<string, Set<string>>,
): Set<string> {
  const known = seen.get(file);
  if (known) return known;
  const exported = packageExports(file, packages);
  seen.set(file, exported);
  for (const statement of parseFile(file)?.statements ?? []) {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.isTypeOnly ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    )
      continue;
    const target = localModule(statement.moduleSpecifier.text, file, options);
    if (!target) continue;
    const inner = localExports(target, packages, options, seen);
    const clause = statement.exportClause;
    if (!clause) {
      for (const name of inner) if (name !== 'default') exported.add(name);
    } else if (ts.isNamespaceExport(clause)) {
      if (inner.size) exported.add(clause.name.text);
    } else
      for (const e of clause.elements)
        if (inner.has((e.propertyName ?? e.name).text)) exported.add(e.name.text);
  }
  return exported;
}

/**
 * The names `file` imports from the repository's own modules that depend on one of `packages`
 * there (a zod schema behind `@/lib/zod`, a redis client behind `../config/redis`), resolved the
 * way the compiler resolves them. Type-only imports are left out: they hold no value.
 */
export function packageImports(
  file: string,
  packages: ReadonlySet<string>,
  options: ts.CompilerOptions,
): Set<string> {
  const names = new Set<string>();
  const seen = new Map<string, Set<string>>();
  for (const statement of parseFile(file)?.statements ?? []) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const target = localModule(statement.moduleSpecifier.text, file, options);
    if (!target) continue;
    const exported = localExports(target, packages, options, seen);
    if (exported.size === 0) continue;
    if (clause.name && exported.has('default')) names.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
    else if (bindings)
      for (const e of bindings.elements)
        if (!e.isTypeOnly && (exported.has((e.propertyName ?? e.name).text) || exported.has('*')))
          names.add(e.name.text);
  }
  return names;
}

/**
 * A workspace's own TypeScript files (workspace-relative; no declarations, nothing under
 * `node_modules` or outside it) and compiler options, from its `tsconfig.json`.
 */
export function projectFiles(dir: string): { files: string[]; options: ts.CompilerOptions } {
  const config = join(dir, 'tsconfig.json');
  const parsed = existsSync(config)
    ? ts.getParsedCommandLineOfConfigFile(
        config,
        {},
        { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
      )
    : undefined;
  const files = (parsed?.fileNames ?? [])
    .map((f) => relative(dir, resolve(f)))
    .filter((f) => !f.startsWith('..') && !f.includes('node_modules/') && !/\.d\.[cm]?ts$/.test(f));
  return { files, options: parsed?.options ?? {} };
}
