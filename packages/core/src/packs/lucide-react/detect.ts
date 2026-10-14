import { type Expression, Node, Project, type SourceFile, SyntaxKind } from 'ts-morph';
import type { Finding } from '../../domain/report.js';
import type { SourceSite } from '../contract.js';
import type { TransformResult } from '../types.js';
import { BRAND_ICONS, BRAND_NAMES, LEGACY_EXPORTS, RENAMED_KEBAB, RENAMES } from './names.js';

const PACKAGE = 'lucide-react';
const DIST = /^lucide-react\/dist\//;

function parse(text: string): SourceFile {
  return new Project({ useInMemoryFileSystem: true }).createSourceFile('consumer.tsx', text, {
    overwrite: true,
  });
}

function site(source: SourceFile, node: Node, name?: string): SourceSite {
  const { line, column } = source.getLineAndColumnAtPos(node.getStart());
  const snippet = source.getFullText().split('\n')[line - 1]?.trim() ?? '';
  return { line, column, snippet, ...(name ? { name } : {}) };
}

/** `lucide-react`, `lucide-react/dynamic`, `lucide-react/dynamicIconImports`: the package's typed entry points. */
function isEntry(specifier: string): boolean {
  return (
    specifier === PACKAGE ||
    /^lucide-react\/(?:dynamic|dynamicIconImports)(?:\.m?js)?$/.test(specifier)
  );
}

/**
 * The names a file imports from lucide's entry points: named imports by their imported name, the
 * `icons` map, a namespace import, `dynamicIconImports` and `DynamicIcon`. A name that is not
 * imported from lucide (a local `icons`, `Chart.SquareGantt`) is never matched.
 */
interface Bindings {
  /** Local name → imported name, for named imports of the package's entry points. */
  named: Map<string, string>;
  /** Locals whose members are icons by name: a namespace import, `icons`, `dynamicIconImports`. */
  maps: Set<string>;
  /** Locals bound to `DynamicIcon`. */
  dynamic: Set<string>;
}

function bindings(source: SourceFile): Bindings {
  const named = new Map<string, string>();
  const maps = new Set<string>();
  const dynamic = new Set<string>();
  for (const declaration of source.getImportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    if (!isEntry(specifier)) continue;
    const namespace = declaration.getNamespaceImport();
    if (namespace) maps.add(namespace.getText());
    const fallback = declaration.getDefaultImport();
    if (fallback && /dynamicIconImports/.test(specifier)) maps.add(fallback.getText());
    for (const element of declaration.getNamedImports()) {
      const local = (element.getAliasNode() ?? element.getNameNode()).getText();
      const imported = element.getName();
      named.set(local, imported);
      if (imported === 'icons' || imported === 'dynamicIconImports') maps.add(local);
      if (imported === 'DynamicIcon') dynamic.add(local);
    }
  }
  return { named, maps, dynamic };
}

/**
 * Through parentheses, `satisfies`, `!`, `as` and `<T>x`, to the expression underneath; `cast`
 * when an `as` or `<T>` replaced its type, so the compiler no longer checks the name.
 */
function unwrap(expression: Expression): { inner: Expression; cast: boolean } {
  let inner = expression;
  let cast = false;
  for (;;) {
    if (
      Node.isParenthesizedExpression(inner) ||
      Node.isSatisfiesExpression(inner) ||
      Node.isNonNullExpression(inner)
    )
      inner = inner.getExpression();
    else if (Node.isAsExpression(inner) || Node.isTypeAssertion(inner)) {
      cast = true;
      inner = inner.getExpression();
    } else return { inner, cast };
  }
}

/** A string literal's value, through a cast: `'github'`, `"github" as IconName`. */
function literal(expression: Expression | undefined): string | undefined {
  if (!expression) return undefined;
  const { inner } = unwrap(expression);
  return Node.isStringLiteral(inner) || Node.isNoSubstitutionTemplateLiteral(inner)
    ? inner.getLiteralValue()
    : undefined;
}

const REMOVED_PASCAL = new Set([...BRAND_NAMES, ...RENAMES.keys()]);
const REMOVED_KEBAB = new Set([...Object.values(BRAND_ICONS), ...Object.keys(RENAMED_KEBAB)]);

function removedName(value: string | undefined): boolean {
  return value !== undefined && (REMOVED_PASCAL.has(value) || REMOVED_KEBAB.has(value));
}

/** `lucide-react/dist/esm/icons/github(.js)`: the file of a removed icon, by its kebab name. */
function removedFile(specifier: string): boolean {
  const match = /^lucide-react\/dist\/(?:esm|cjs)\/icons\/([a-z0-9-]+)(?:\.m?js)?$/.exec(specifier);
  return match !== null && REMOVED_KEBAB.has(match[1] as string);
}

/** Every module specifier in the file: imports, re-exports, `require()` and `import()`. */
function specifiers(source: SourceFile): { node: Node; value: string }[] {
  const found: { node: Node; value: string }[] = [];
  for (const declaration of [
    ...source.getImportDeclarations(),
    ...source.getExportDeclarations(),
  ]) {
    const node = declaration.getModuleSpecifier();
    if (node) found.push({ node, value: node.getLiteralValue() });
  }
  for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    const isRequire = Node.isIdentifier(callee) && callee.getText() === 'require';
    const isImport = callee.getKind() === SyntaxKind.ImportKeyword;
    const argument = call.getArguments()[0];
    if ((isRequire || isImport) && argument && Node.isStringLiteral(argument))
      found.push({ node: argument, value: argument.getLiteralValue() });
  }
  return found;
}

/**
 * Removed icons reached where the compiler cannot see them: through a cast (`icons as any`,
 * `name={x as IconName}`), a deep import of the icon's file (typed by a local shim, if at all),
 * or a name kept as data (`{ icon: 'github' }`) in a file that looks icons up by name. Typed
 * lookups (`icons.Github`, `<DynamicIcon name="github" />`) are the compiler's, and left to it.
 */
export function untypedIconSites(text: string): SourceSite[] {
  if (!text.includes(PACKAGE)) return [];
  const source = parse(text);
  const { maps, dynamic } = bindings(source);
  const sites: SourceSite[] = [];
  for (const { node, value } of specifiers(source))
    if (removedFile(value)) sites.push(site(source, node, value));
  let lookups = false;
  for (const access of source.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
    const { inner, cast } = unwrap(access.getExpression());
    if (!Node.isIdentifier(inner) || !maps.has(inner.getText())) continue;
    lookups = true;
    const key = literal(access.getArgumentExpression());
    if (cast && removedName(key)) sites.push(site(source, access, key));
  }
  for (const access of source.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    const { inner, cast } = unwrap(access.getExpression());
    if (
      cast &&
      Node.isIdentifier(inner) &&
      maps.has(inner.getText()) &&
      removedName(access.getName())
    )
      sites.push(site(source, access, access.getName()));
  }
  for (const attribute of source.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    const element = attribute.getParent()?.getParent();
    if (!element || !(Node.isJsxOpeningElement(element) || Node.isJsxSelfClosingElement(element)))
      continue;
    if (!dynamic.has(element.getTagNameNode().getText())) continue;
    lookups = true;
    if (attribute.getNameNode().getText() !== 'name') continue;
    const initializer = attribute.getInitializer();
    const expression = Node.isJsxExpression(initializer) ? initializer.getExpression() : undefined;
    const value = expression ? unwrap(expression) : undefined;
    if (value?.cast && removedName(literal(expression))) sites.push(site(source, attribute));
  }
  if (lookups || maps.size > 0)
    for (const property of source.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
      if (!/^['"]?(?:icon|iconName)['"]?$/.test(property.getNameNode().getText())) continue;
      const value = literal(property.getInitializer());
      if (removedName(value)) sites.push(site(source, property, value));
    }
  return dedupe(sites);
}

/** Imports of lucide-react's build output, which is not its API: file names and extensions change. */
export function deepImportSites(text: string): SourceSite[] {
  if (!text.includes('lucide-react/')) return [];
  const source = parse(text);
  const sites: SourceSite[] = [];
  for (const { node, value } of specifiers(source))
    if (DIST.test(value) && !removedFile(value)) sites.push(site(source, node, value));
  // Next's `modularizeImports` and similar configuration name the path as a plain string.
  const seen = new Set(sites.map((s) => s.line));
  for (const string of source.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    const value = string.getLiteralValue();
    if (!DIST.test(value) || removedFile(value)) continue;
    const at = site(source, string, value);
    if (!seen.has(at.line)) sites.push(at);
    seen.add(at.line);
  }
  return dedupe(sites);
}

/** `absoluteStrokeWidth` written on a lucide icon, `DynamicIcon` or `LucideProvider`. */
export function absoluteStrokeWidthSites(text: string): SourceSite[] {
  if (!text.includes('absoluteStrokeWidth') || !text.includes(PACKAGE)) return [];
  const source = parse(text);
  const { named, maps } = bindings(source);
  const sites: SourceSite[] = [];
  for (const attribute of source.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    if (attribute.getNameNode().getText() !== 'absoluteStrokeWidth') continue;
    const element = attribute.getParent()?.getParent();
    if (!element || !(Node.isJsxOpeningElement(element) || Node.isJsxSelfClosingElement(element)))
      continue;
    const tag = element.getTagNameNode();
    const lucide = Node.isIdentifier(tag)
      ? named.has(tag.getText())
      : Node.isPropertyAccessExpression(tag) &&
        Node.isIdentifier(tag.getExpression()) &&
        maps.has(tag.getExpression().getText());
    if (lucide) sites.push(site(source, attribute, 'absoluteStrokeWidth'));
  }
  return dedupe(sites);
}

function dedupe(sites: SourceSite[]): SourceSite[] {
  const lines = new Set<number>();
  return sites.filter((s) => !lines.has(s.line) && lines.add(s.line));
}

function decline(text: string, reason: string): TransformResult {
  return { text, applied: false, reason };
}

/**
 * The rename at one reported site. On an import or re-export line the specifier takes the 1.x
 * name and keeps the old one as its local or exported name (`SquareChartGantt as SquareGantt`):
 * the uses of the binding, which `check` does not report, and the module's public names stay as
 * they are. A member of lucide's namespace or `icons` map (`Icons.SquareGantt`) is renamed in place.
 */
export function renameIcon(text: string, finding: Finding): TransformResult {
  const source = parse(text);
  const line = finding.usage.line;
  const lineOf = (node: Node) => source.getLineAndColumnAtPos(node.getStart());
  const edits: { start: number; end: number; text: string }[] = [];

  for (const declaration of [
    ...source.getImportDeclarations(),
    ...source.getExportDeclarations(),
  ]) {
    if (declaration.getModuleSpecifierValue() !== PACKAGE) continue;
    const elements = Node.isImportDeclaration(declaration)
      ? declaration.getNamedImports()
      : declaration.getNamedExports();
    const here = elements.filter((element) => lineOf(element.getNameNode()).line === line);
    if (here.some((element) => removedWithoutReplacement(element.getNameNode().getText())))
      return decline(text, 'a removed icon on the same line needs a replacement chosen first');
    for (const element of here) {
      const name = element.getNameNode();
      const to = RENAMES.get(name.getText());
      if (!to) continue;
      const replacement = element.getAliasNode() ? to : `${to} as ${name.getText()}`;
      edits.push({ start: name.getStart(), end: name.getEnd(), text: replacement });
    }
  }

  if (!edits.length) {
    const { maps } = bindings(source);
    for (const access of source.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      const name = access.getNameNode();
      const at = lineOf(name);
      const to = RENAMES.get(name.getText());
      if (!to || at.line !== line || at.column !== finding.usage.column) continue;
      const { inner } = unwrap(access.getExpression());
      if (Node.isIdentifier(inner) && maps.has(inner.getText()))
        edits.push({ start: name.getStart(), end: name.getEnd(), text: to });
    }
    // `icons['SquareGantt']`: the compiler reports the whole access, at its start.
    for (const access of source.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
      const at = lineOf(access);
      const key = access.getArgumentExpression();
      const to = RENAMES.get(literal(key) ?? '');
      if (!to || !key || at.line !== line || at.column !== finding.usage.column) continue;
      const { inner } = unwrap(access.getExpression());
      if (Node.isIdentifier(inner) && maps.has(inner.getText()))
        edits.push({ start: key.getStart() + 1, end: key.getEnd() - 1, text: to });
    }
  }

  if (!edits.length) return decline(text, 'the reported site is not a renamed lucide icon');
  let out = text;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  const names = edits.map((e) => e.text).join(', ');
  return { text: out, applied: true, reason: `use the 1.x icon name (${names})` };
}

const NO_REPLACEMENT = new Set([...BRAND_NAMES, ...LEGACY_EXPORTS]);

function removedWithoutReplacement(name: string): boolean {
  return NO_REPLACEMENT.has(name);
}
