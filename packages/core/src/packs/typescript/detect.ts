import { ts } from 'ts-morph';
import type { Finding } from '../../domain/report.js';
import { replaceAtSite, type SourceSite } from '../contract.js';
import type { TransformResult } from '../types.js';

/**
 * TypeScript 6 sites the compiler reports in a tsconfig file (TS5101, TS5107), found where the
 * option is set: in the file that sets it, not the leaf that inherits it, which is where the
 * compiler points. Every tsconfig in the repository is read, so an `extends` chain inside the
 * repository is covered file by file. Read with the JSON parser, comments and trailing commas
 * included, as the compiler reads them.
 */

export const isTsconfig = (file: string): boolean => /(?:^|\/)tsconfig[^/]*\.json$/.test(file);

interface Option {
  name: string;
  /** The value as written: a string lowercased, a boolean, or undefined for anything else. */
  value: string | boolean | undefined;
  node: ts.PropertyAssignment;
}

function compilerOptions(
  text: string,
  file: string,
): { source: ts.JsonSourceFile; options: Option[] } | undefined {
  const source = ts.parseJsonText(file, text);
  const root = source.statements[0]?.expression;
  if (!root || !ts.isObjectLiteralExpression(root)) return undefined;
  const block = root.properties.find(
    (p): p is ts.PropertyAssignment =>
      ts.isPropertyAssignment(p) && nameOf(p) === 'compilerOptions',
  )?.initializer;
  if (!block || !ts.isObjectLiteralExpression(block)) return { source, options: [] };
  const options = block.properties.filter(ts.isPropertyAssignment).map((node) => {
    const init = node.initializer;
    const value = ts.isStringLiteral(init)
      ? init.text.toLowerCase()
      : init.kind === ts.SyntaxKind.TrueKeyword
        ? true
        : init.kind === ts.SyntaxKind.FalseKeyword
          ? false
          : undefined;
    return { name: nameOf(node), value, node };
  });
  return { source, options };
}

function nameOf(p: ts.PropertyAssignment): string {
  return ts.isStringLiteral(p.name) || ts.isIdentifier(p.name) ? p.name.text : '';
}

function siteOf(source: ts.JsonSourceFile, option: Option): SourceSite {
  const { line, character } = source.getLineAndCharacterOfPosition(option.node.getStart(source));
  return {
    line: line + 1,
    column: character + 1,
    snippet: (source.text.split('\n')[line] ?? '').trim(),
    name: option.name,
  };
}

/** The sites of one option in a tsconfig, when its value is one of `values` (any value when omitted). */
export function optionSites(
  name: string,
  values?: readonly (string | boolean)[],
): (text: string, file: string) => SourceSite[] {
  return (text, file) => {
    if (!isTsconfig(file) || !text.includes(name)) return [];
    const parsed = compilerOptions(text, file);
    if (!parsed) return [];
    return parsed.options
      .filter(
        (o) =>
          o.name === name &&
          (values === undefined || (o.value !== undefined && values.includes(o.value))),
      )
      .map((o) => siteOf(parsed.source, o));
  };
}

/**
 * `downlevelIteration` only ever changed ES5 emit (the 6.0 notes), so with a target of ES2015 or
 * later in the same file the property goes, with its line. Declined when the file targets ES3 or
 * ES5, or silences deprecations: there it still changes the output.
 */
export function removeDownlevelIteration(
  text: string,
  finding: Pick<Finding, 'usage'>,
): TransformResult {
  const parsed = compilerOptions(text, finding.usage.file);
  if (!parsed) return { text, applied: false, reason: 'the tsconfig cannot be read' };
  const target = parsed.options.find((o) => o.name === 'target')?.value;
  if (target === 'es3' || target === 'es5')
    return { text, applied: false, reason: `target ${target} still uses downlevelIteration` };
  if (parsed.options.some((o) => o.name === 'ignoreDeprecations'))
    return { text, applied: false, reason: 'ignoreDeprecations is set: the option still applies' };
  const option = parsed.options.find(
    (o) => o.name === 'downlevelIteration' && siteOf(parsed.source, o).line === finding.usage.line,
  );
  if (!option)
    return { text, applied: false, reason: 'the reported site is not downlevelIteration' };
  const lines = text.split('\n');
  const index = finding.usage.line - 1;
  const line = lines[index] ?? '';
  const start = parsed.source.getLineAndCharacterOfPosition(option.node.getStart(parsed.source));
  const end = parsed.source.getLineAndCharacterOfPosition(option.node.end);
  // Only a property alone on its line is removed: anything sharing the line is left to a person.
  const rest = line.slice(end.character).replace(/^\s*,?\s*(\/\/.*)?$/, '');
  if (start.line !== end.line || line.slice(0, start.character).trim() !== '' || rest !== '')
    return {
      text,
      applied: false,
      reason: 'downlevelIteration shares its line with other settings',
    };
  lines.splice(index, 1);
  // A removed last property leaves the one before it with a trailing comma, which tsconfig allows.
  return {
    text: lines.join('\n'),
    applied: true,
    reason: 'downlevelIteration only affected ES5 output',
  };
}

/** `module Foo {` is `namespace Foo {`: TS1540 points at the name, the keyword is just before it. */
export function moduleToNamespace(text: string, finding: Pick<Finding, 'usage'>): TransformResult {
  const lines = text.split('\n');
  const index = finding.usage.line - 1;
  const line = lines[index];
  if (line === undefined) return { text, applied: false, reason: 'the reported line is gone' };
  const before = line.slice(0, Math.max(0, finding.usage.column - 1));
  // A quoted name (`declare module "x"`) is an ambient module, which stays as it is.
  if (!/^[A-Za-z_$]/.test(line.slice(before.length)))
    return { text, applied: false, reason: 'the reported name is not an identifier' };
  const keyword = /(?<![\w$.])module(\s+)$/.exec(before);
  if (!keyword)
    return { text, applied: false, reason: 'no `module` keyword right before the reported name' };
  lines[index] =
    `${before.slice(0, keyword.index)}namespace${keyword[1]}${line.slice(before.length)}`;
  return { text: lines.join('\n'), applied: true, reason: '`module` is `namespace`' };
}

/** `assert { type: "json" }` (or `{ assert: {` in a dynamic import) is `with`, at the reported keyword only. */
export function assertToWith(text: string, finding: Pick<Finding, 'usage'>): TransformResult {
  const line = text.split('\n')[finding.usage.line - 1] ?? '';
  if (!/^assert\s*[{:]/.test(line.slice(Math.max(0, finding.usage.column - 1))))
    return { text, applied: false, reason: 'the reported site is not an import assertion' };
  return replaceAtSite(text, finding, 'assert', 'with');
}

/** The property names a tsconfig sets in `compilerOptions`, and what it `extends`. */
function declared(text: string, file: string): { names: Set<string>; extends: string[] } {
  const parsed = compilerOptions(text, file);
  const root = parsed?.source.statements[0]?.expression;
  const base =
    root && ts.isObjectLiteralExpression(root)
      ? root.properties.find(
          (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && nameOf(p) === 'extends',
        )?.initializer
      : undefined;
  const extended = !base
    ? []
    : ts.isStringLiteral(base)
      ? [base.text]
      : ts.isArrayLiteralExpression(base)
        ? base.elements.filter(ts.isStringLiteral).map((e) => e.text)
        : [];
  return { names: new Set(parsed?.options.map((o) => o.name)), extends: extended };
}

/**
 * `rootDir` now defaults to the tsconfig's directory instead of the common directory of the
 * inputs, so a project that emits to `outDir` from one source directory (`include: ["src"]`)
 * would write `dist/src/index.js`: the compiler stops with TS5011 at `outDir`. Found from this
 * file alone: `outDir` set, `rootDir` and `noEmit` not, every `include` entry under the same
 * directory. A `rootDir` an extended config sets is not seen (RESEARCH.md, known limits).
 */
export function rootDirSites(text: string, file: string): SourceSite[] {
  if (!isTsconfig(file) || !text.includes('outDir')) return [];
  const parsed = compilerOptions(text, file);
  if (!parsed) return [];
  const option = (name: string) => parsed.options.find((o) => o.name === name);
  const outDir = option('outDir');
  if (!outDir || option('rootDir') || option('noEmit')?.value === true) return [];
  if (option('composite')?.value === true) return [];
  const root = parsed.source.statements[0]?.expression;
  const include =
    root && ts.isObjectLiteralExpression(root)
      ? root.properties.find(
          (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && nameOf(p) === 'include',
        )?.initializer
      : undefined;
  if (!include || !ts.isArrayLiteralExpression(include)) return [];
  const dirs = new Set(
    include.elements.map((e) =>
      ts.isStringLiteral(e) ? (e.text.replace(/^\.\//, '').split('/')[0] ?? '') : '',
    ),
  );
  const [only] = [...dirs];
  if (dirs.size !== 1 || !only || /[*?.]/.test(only)) return [];
  return [siteOf(parsed.source, outDir)];
}

const DEFAULTS = [
  ['strict', 'strict is on (it was off): `"strict": false` keeps 5.x checking'],
  ['types', 'types is [] (every @types package was included): list the ones the code uses'],
  [
    'noUncheckedSideEffectImports',
    'noUncheckedSideEffectImports is on: `import "./x.css"` needs a declaration',
  ],
] as const;

/**
 * The defaults 6.0 changed that a tsconfig of the repository leaves unset, through the
 * `extends` chain inside the repository (a package's config, `@tsconfig/node20`, is not read):
 * one line per tsconfig, for "Decisions for you".
 */
export function unsetDefaults(inventory: readonly { file: string; text: string }[]): string[] {
  const configs = new Map(
    inventory.filter((f) => isTsconfig(f.file)).map((f) => [f.file, declared(f.text, f.file)]),
  );
  const setIn = (file: string, name: string, seen = new Set<string>()): boolean | undefined => {
    const config = configs.get(file);
    if (!config || seen.has(file)) return undefined;
    seen.add(file);
    if (config.names.has(name)) return true;
    let unknown = false;
    for (const base of config.extends) {
      if (!base.startsWith('.')) {
        unknown = true;
        continue;
      }
      const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.';
      const target = normalize(`${dir}/${base.endsWith('.json') ? base : `${base}.json`}`);
      const found = setIn(target, name, seen);
      if (found) return true;
      if (found === undefined) unknown = true;
    }
    return unknown ? undefined : false;
  };
  const lines: string[] = [];
  for (const file of [...configs.keys()].sort()) {
    const unset = DEFAULTS.filter(([name]) => setIn(file, name) === false).map(([, what]) => what);
    if (unset.length) lines.push(`${file}: ${unset.join('; ')}`);
  }
  return lines;
}

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}
