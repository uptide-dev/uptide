import { ts } from 'ts-morph';
import type { Finding } from '../../domain/report.js';
import type { SourceSite } from '../contract.js';
import type { TransformResult } from '../types.js';

/**
 * Syntax the Sentry rules read: which local names are bound to a Sentry SDK, which object
 * literals are `Sentry.init` options, integration options or `withSentryConfig` build
 * options. Binding-aware rather than textual: a local function called `init`, or an `options`
 * object that never reaches Sentry, is never a site.
 */

export const SENTRY_MODULE = /^@sentry\/[\w-]+(?:\/[\w-]+)*$/;

export function parse(text: string, file = 'input.ts'): ts.SourceFile {
  const kind = /\.[cm]?jsx?$/.test(file)
    ? ts.ScriptKind.JSX
    : /\.tsx$/.test(file)
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

export function siteOf(node: ts.Node, name?: string): SourceSite {
  const source = node.getSourceFile();
  const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return {
    line: line + 1,
    column: character + 1,
    snippet: source.text.split('\n')[line]?.trim() ?? '',
    ...(name ? { name } : {}),
  };
}

/** The node a finding points at starts here (1-based line and column). */
export function startsAt(node: ts.Node, finding: Pick<Finding, 'usage'>): boolean {
  const site = siteOf(node);
  return site.line === finding.usage.line && site.column === finding.usage.column;
}

export function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

export function nodes<T extends ts.Node>(
  source: ts.SourceFile,
  guard: (node: ts.Node) => node is T,
): T[] {
  const found: T[] = [];
  walk(source, (node) => {
    if (guard(node)) found.push(node);
  });
  return found;
}

/** Strip `(x)`, `x as T`, `x satisfies T` and `x!` around an expression. */
export function unwrap(node: ts.Expression): ts.Expression {
  let value = node;
  while (
    ts.isParenthesizedExpression(value) ||
    ts.isAsExpression(value) ||
    ts.isSatisfiesExpression(value) ||
    ts.isNonNullExpression(value) ||
    ts.isTypeAssertionExpression(value)
  )
    value = value.expression;
  return value;
}

export function propertyName(node: ts.ObjectLiteralElementLike): string | undefined {
  const name = node.name;
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text;
  return undefined;
}

/** Local names bound to a Sentry module: `import * as Sentry`, named imports, `require`. */
export interface SentryBindings {
  /** `Sentry` in `import * as Sentry from '@sentry/node'` or `const Sentry = require(...)`. */
  namespaces: Map<string, string>;
  /** Local name → { imported name, module }. */
  named: Map<string, { imported: string; module: string }>;
}

export function sentryBindings(source: ts.SourceFile, module = SENTRY_MODULE): SentryBindings {
  const namespaces = new Map<string, string>();
  const named = new Map<string, { imported: string; module: string }>();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const from = statement.moduleSpecifier.text;
      if (!module.test(from)) continue;
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.set(bindings.name.text, from);
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements)
          named.set(element.name.text, {
            imported: (element.propertyName ?? element.name).text,
            module: from,
          });
      // `import Sentry from '@sentry/x'` under esModuleInterop is the namespace.
      if (statement.importClause?.name) namespaces.set(statement.importClause.name.text, from);
    }
  }
  walk(source, (node) => {
    if (!ts.isVariableDeclaration(node) || !node.initializer) return;
    const from = requiredModule(node.initializer);
    if (!from || !module.test(from)) return;
    if (ts.isIdentifier(node.name)) namespaces.set(node.name.text, from);
    else if (ts.isObjectBindingPattern(node.name))
      for (const element of node.name.elements)
        if (ts.isIdentifier(element.name))
          named.set(element.name.text, {
            imported:
              element.propertyName && ts.isIdentifier(element.propertyName)
                ? element.propertyName.text
                : element.name.text,
            module: from,
          });
  });
  return { namespaces, named };
}

/** `require('x')`, `await import('x')`: the module named, or undefined. */
export function requiredModule(node: ts.Expression): string | undefined {
  let value = unwrap(node);
  if (ts.isAwaitExpression(value)) value = unwrap(value.expression);
  if (
    ts.isCallExpression(value) &&
    (value.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(value.expression) && value.expression.text === 'require')) &&
    value.arguments.length === 1
  ) {
    const argument = value.arguments[0];
    if (argument && ts.isStringLiteralLike(argument)) return argument.text;
  }
  return undefined;
}

/**
 * The Sentry export a callee names, when it is bound to a Sentry module: `Sentry.init` and an
 * imported `init` both answer `init`; a local function of the same name answers nothing.
 */
export function sentryCallee(
  expression: ts.Expression,
  bindings: SentryBindings,
): string | undefined {
  const callee = unwrap(expression);
  if (ts.isIdentifier(callee)) return bindings.named.get(callee.text)?.imported;
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    bindings.namespaces.has(callee.expression.text)
  )
    return callee.name.text;
  return undefined;
}

/** An object literal, directly or through a same-file `const` it is assigned to. */
export function objectOf(
  expression: ts.Expression | undefined,
  source: ts.SourceFile,
): ts.ObjectLiteralExpression | undefined {
  if (!expression) return undefined;
  const value = unwrap(expression);
  if (ts.isObjectLiteralExpression(value)) return value;
  if (!ts.isIdentifier(value)) return undefined;
  const declarations = nodes(source, ts.isVariableDeclaration).filter(
    (d) => ts.isIdentifier(d.name) && d.name.text === value.text,
  );
  const declaration = declarations.length === 1 ? declarations[0] : undefined;
  if (
    !declaration?.initializer ||
    !(declaration.parent.flags & ts.NodeFlags.Const) ||
    !ts.isVariableDeclarationList(declaration.parent)
  )
    return undefined;
  const initializer = unwrap(declaration.initializer);
  return ts.isObjectLiteralExpression(initializer) ? initializer : undefined;
}

const OPTIONS_TYPE =
  /^(?:Node|Browser|Edge|VercelEdge|Bun|Deno|Cloudflare|React|Vue|Angular|Svelte|Client)?Options$/;

/** `Sentry.NodeOptions`, `BrowserOptions` imported from Sentry, `Parameters<typeof Sentry.init>[0]`. */
function isOptionsType(type: ts.TypeNode | undefined, bindings: SentryBindings): boolean {
  if (!type) return false;
  if (ts.isTypeReferenceNode(type)) {
    const name = type.typeName;
    if (ts.isQualifiedName(name))
      return (
        ts.isIdentifier(name.left) &&
        bindings.namespaces.has(name.left.text) &&
        OPTIONS_TYPE.test(name.right.text)
      );
    const named = bindings.named.get(name.text);
    if (named && OPTIONS_TYPE.test(named.imported)) return true;
    if (name.text === 'NonNullable' || name.text === 'Partial')
      return isOptionsType(type.typeArguments?.[0], bindings);
    return false;
  }
  if (ts.isIndexedAccessTypeNode(type)) return /typeof\s+\w+\.init\b/.test(type.getText());
  return false;
}

/**
 * Every object literal that is `Sentry.init` options: the argument of `init` (directly or
 * through a same-file const), an object typed as `NodeOptions`/`BrowserOptions`/..., or what a
 * function declared to return one returns.
 */
export function initOptions(source: ts.SourceFile): ts.ObjectLiteralExpression[] {
  const bindings = sentryBindings(source);
  if (!bindings.namespaces.size && !bindings.named.size) return [];
  const found = new Set<ts.ObjectLiteralExpression>();
  walk(source, (node) => {
    if (ts.isCallExpression(node) && sentryCallee(node.expression, bindings) === 'init') {
      const object = objectOf(node.arguments[0], source);
      if (object) found.add(object);
    }
    if (
      (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
      node.initializer &&
      isOptionsType(node.type, bindings)
    ) {
      const object = unwrap(node.initializer);
      if (ts.isObjectLiteralExpression(object)) found.add(object);
    }
    if (
      (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) &&
      isOptionsType(node.type, bindings)
    ) {
      const object = unwrap(node.expression);
      if (ts.isObjectLiteralExpression(object)) found.add(object);
    }
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isMethodDeclaration(node)) &&
      isOptionsType(node.type, bindings) &&
      node.body
    ) {
      if (!ts.isBlock(node.body)) {
        const object = unwrap(node.body);
        if (ts.isObjectLiteralExpression(object)) found.add(object);
      } else
        walk(node.body, (inner) => {
          if (ts.isReturnStatement(inner) && inner.expression) {
            const object = unwrap(inner.expression);
            if (ts.isObjectLiteralExpression(object)) found.add(object);
          }
        });
    }
  });
  return [...found];
}

/** The options object of each call to one of these Sentry integrations. */
export function integrationOptions(
  source: ts.SourceFile,
  names: readonly string[],
): { name: string; object: ts.ObjectLiteralExpression }[] {
  const bindings = sentryBindings(source);
  const found: { name: string; object: ts.ObjectLiteralExpression }[] = [];
  walk(source, (node) => {
    if (!ts.isCallExpression(node)) return;
    const name = sentryCallee(node.expression, bindings);
    if (!name || !names.includes(name)) return;
    const object = objectOf(node.arguments[0], source);
    if (object) found.push({ name, object });
  });
  return found;
}

/** A property of an object literal by name, with nested paths (`_experiments.enableLogs`). */
export function propertyAt(
  object: ts.ObjectLiteralExpression,
  path: string,
): ts.ObjectLiteralElementLike | undefined {
  const [head, ...rest] = path.split('.');
  const property = object.properties.find((p) => propertyName(p) === head);
  if (!property || !rest.length) return property;
  if (!ts.isPropertyAssignment(property)) return undefined;
  const inner = unwrap(property.initializer);
  return ts.isObjectLiteralExpression(inner) ? propertyAt(inner, rest.join('.')) : undefined;
}

/** Sites of the given property paths in the given objects, anchored at the property name. */
export function propertySites(
  objects: readonly ts.ObjectLiteralExpression[],
  paths: readonly string[],
): SourceSite[] {
  const sites = new Map<string, SourceSite>();
  for (const object of objects)
    for (const path of paths) {
      const property = propertyAt(object, path);
      if (!property) continue;
      const site = siteOf(property, path);
      sites.set(`${site.line}:${site.column}`, site);
    }
  return [...sites.values()].sort((a, b) => a.line - b.line || a.column - b.column);
}

/** The property a finding points at, among the candidates. */
export function propertyFor(
  objects: readonly ts.ObjectLiteralExpression[],
  paths: readonly string[],
  finding: Pick<Finding, 'usage'>,
): { property: ts.ObjectLiteralElementLike; path: string } | undefined {
  for (const object of objects)
    for (const path of paths) {
      const property = propertyAt(object, path);
      if (property && siteOf(property).line === finding.usage.line) return { property, path };
    }
  return undefined;
}

/**
 * The text without one property: its trailing comma, and the comment lines directly above
 * it when they stand on their own lines. An object left empty by it is the caller's choice.
 */
export function withoutProperty(text: string, property: ts.ObjectLiteralElementLike): string {
  const source = property.getSourceFile();
  const object = property.parent as ts.ObjectLiteralExpression;
  const index = object.properties.indexOf(property);
  const last = index === object.properties.length - 1;
  let start = property.getStart(source);
  let end = property.getEnd();
  // The comma after it, or the one before it when it is the last property without one.
  const after = text.slice(end).match(/^\s*,/);
  if (after) end += after[0].length;
  else if (last && index > 0) {
    const previous = object.properties[index - 1] as ts.ObjectLiteralElementLike;
    const between = text.slice(previous.getEnd(), start);
    const comma = between.indexOf(',');
    if (comma >= 0 && !text.slice(previous.getEnd(), previous.getEnd() + comma).includes('//'))
      start = previous.getEnd() + comma;
  }
  // Whole lines: from the start of the property's line (with its own comments) to the line end.
  const lineStart = text.lastIndexOf('\n', property.getStart(source) - 1) + 1;
  const before = text.slice(lineStart, property.getStart(source));
  const rest = text.slice(end).match(/^[ \t]*(?:\/\/[^\n]*)?\n/);
  if (/^\s*$/.test(before) && rest && start === property.getStart(source)) {
    let from = lineStart;
    // Comment lines directly above, with no blank line between, belong to the property.
    for (;;) {
      const previousStart = text.lastIndexOf('\n', from - 2) + 1;
      const previous = text.slice(previousStart, from - 1);
      if (from === 0 || !/^\s*\/\/.*$/.test(previous)) break;
      from = previousStart;
    }
    return text.slice(0, from) + text.slice(end + rest[0].length);
  }
  return text.slice(0, start) + text.slice(end);
}

/** The `//` comment lines directly above a property, on their own lines, trimmed. */
export function leadingCommentLines(text: string, property: ts.ObjectLiteralElementLike): string[] {
  const lines: string[] = [];
  let from = text.lastIndexOf('\n', property.getStart() - 1) + 1;
  if (!/^\s*$/.test(text.slice(from, property.getStart()))) return lines;
  while (from > 0) {
    const previousStart = text.lastIndexOf('\n', from - 2) + 1;
    const previous = text.slice(previousStart, from - 1);
    if (!/^\s*\/\/.*$/.test(previous)) break;
    lines.unshift(previous.trim());
    from = previousStart;
  }
  return lines;
}

/** Rename one property key in place, keeping its value, quotes aside. */
export function withRenamedKey(text: string, property: ts.ObjectLiteralElementLike, to: string) {
  const name = property.name;
  if (!name) return undefined;
  if (ts.isShorthandPropertyAssignment(property))
    return `${text.slice(0, name.getStart())}${to}: ${name.getText()}${text.slice(name.getEnd())}`;
  return text.slice(0, name.getStart()) + to + text.slice(name.getEnd());
}

export function declined(text: string, reason: string): TransformResult {
  return { text, applied: false, reason };
}

/** A literal `true`/`false`, else undefined (dynamic). */
export function booleanValue(property: ts.ObjectLiteralElementLike): boolean | undefined {
  if (!ts.isPropertyAssignment(property)) return undefined;
  const value = unwrap(property.initializer);
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}
