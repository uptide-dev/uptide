import {
  type CallExpression,
  type ExportDeclaration,
  type ImportDeclaration,
  Node,
  Project,
  type SourceFile,
  SyntaxKind,
} from 'ts-morph';
import type { Finding } from '../../domain/report.js';
import { onReset } from '../../shared-state.js';
import type { SourceSite } from '../contract.js';
import type { PackContext, TransformResult } from '../types.js';

/**
 * Sites of the React Router 6 → 7 upgrade that no type diff reports, found in the syntax of a
 * file that uses the package, and the edits that are safe whatever the surrounding code is.
 * Every edit re-parses the text it was given: the cached trees are only read.
 */
const parsed = new Map<string, SourceFile>();
onReset(() => parsed.clear());
function parse(text: string): SourceFile {
  let source = parsed.get(text);
  if (!source) {
    source = fresh(text);
    if (parsed.size >= 16) parsed.delete(parsed.keys().next().value as string);
    parsed.set(text, source);
  }
  return source;
}
function fresh(text: string): SourceFile {
  return new Project({ useInMemoryFileSystem: true }).createSourceFile('consumer.tsx', text);
}

function siteAt(source: SourceFile, node: Node, name: string): SourceSite {
  const { line, column } = source.getLineAndColumnAtPos(node.getStart());
  return { line, column, snippet: (source.getFullText().split('\n')[line - 1] ?? '').trim(), name };
}
const at = (source: SourceFile, node: Node, finding: Pick<Finding, 'usage'>): boolean => {
  const { line, column } = source.getLineAndColumnAtPos(node.getStart());
  return line === finding.usage.line && column === finding.usage.column;
};

const DOM = 'react-router-dom';
const ROUTER_MODULES = new Set(['react-router', DOM]);
/**
 * What `react-router-dom@7` takes from `react-router/dom`, not from `react-router`: the
 * `RouterProvider` wired to `ReactDOM.flushSync`, and `HydratedRouter`. The main entry has a
 * `RouterProvider` too, without `flushSync`: moving it there changes what it does.
 */
const DOM_ENTRY = new Set(['RouterProvider', 'HydratedRouter', 'RouterProviderProps']);

type ModuleDeclaration = ImportDeclaration | ExportDeclaration;

function declarationsFrom(source: SourceFile, specifier: string): ModuleDeclaration[] {
  return [...source.getImportDeclarations(), ...source.getExportDeclarations()].filter(
    (d) => d.getModuleSpecifierValue() === specifier,
  );
}

/** Whether every name the declaration takes from `react-router-dom` is in `react-router` itself. */
function movable(declaration: ModuleDeclaration): boolean {
  if (Node.isImportDeclaration(declaration)) {
    if (declaration.getNamespaceImport() || declaration.getDefaultImport()) return false;
    const named = declaration.getNamedImports();
    // `import 'react-router-dom'` loads it for its side effects: nothing to move.
    if (!named.length && !declaration.getImportClause()) return false;
    return named.every((n) => !DOM_ENTRY.has(n.getName()));
  }
  const named = declaration.getNamedExports();
  if (!declaration.hasNamedExports() || declaration.getNamespaceExport()) return false;
  return named.every((n) => !DOM_ENTRY.has(n.getName()));
}

function domSites(text: string, wanted: (d: ModuleDeclaration) => boolean): SourceSite[] {
  if (!text.includes(DOM)) return [];
  const source = parse(text);
  return declarationsFrom(source, DOM)
    .filter((d) => (Node.isImportDeclaration(d) ? d.getImportClause() : true) && wanted(d))
    .map((d) => siteAt(source, d.getModuleSpecifier() as Node, DOM));
}

/**
 * `import { Link } from 'react-router-dom'`: v7's `react-router-dom` only re-exports
 * `react-router`, and v8 removes it. The site is the module specifier, the line the upgrade
 * edits.
 */
export function domImportSites(text: string): SourceSite[] {
  return domSites(text, movable);
}

const TEST_FILE = /(?:^|\/)(?:__tests__|__mocks__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;

/**
 * An import or re-export from `react-router-dom` that needs `react-router/dom`, or takes
 * everything; and, outside tests, a `RouterProvider` or `HydratedRouter` imported from
 * `react-router`, whose main entry is the non-DOM one in v7 (the guide keeps it for tests).
 */
export function domEntrySites(text: string, file = ''): SourceSite[] {
  const sites = domSites(text, (d) => !movable(d));
  if (TEST_FILE.test(file) || !/\b(?:RouterProvider|HydratedRouter)\b/.test(text)) return sites;
  const source = parse(text);
  for (const declaration of declarationsFrom(source, 'react-router'))
    if (
      Node.isImportDeclaration(declaration) &&
      !declaration.isTypeOnly() &&
      declaration
        .getNamedImports()
        .some((n) => !n.isTypeOnly() && ['RouterProvider', 'HydratedRouter'].includes(n.getName()))
    )
      sites.push(siteAt(source, declaration.getModuleSpecifier(), 'react-router'));
  return sites.sort((a, b) => a.line - b.line);
}

const MOCK =
  /\b(?:jest|vi)\s*\.\s*(?:mock|doMock|unmock|requireActual|importActual|requireMock|importMock)\s*(?:<[^>]*>)?\s*\(\s*(['"`])react-router-dom\1/;

/** A test that mocks `react-router-dom` by name stops applying once the code imports `react-router`. */
export function domMocks(text: string, context?: Pick<PackContext, 'inventory'>): string[] {
  const files = (context?.inventory ?? []).filter(
    (f) => MOCK.test(f.text) || /(?:^|\/)__mocks__\/react-router-dom\.[cm]?[jt]sx?$/.test(f.file),
  );
  return [...(MOCK.test(text) ? ['this file'] : []), ...files.map((f) => `\`${f.file}\``)];
}

/** The specifier at the reported site becomes `react-router`; nothing else in the file changes. */
export function moveDomImport(
  text: string,
  finding: Pick<Finding, 'usage'>,
  context?: Pick<PackContext, 'inventory'>,
): TransformResult {
  const mocks = domMocks(text, context);
  if (mocks.length)
    return {
      text,
      applied: false,
      reason: `tests mock react-router-dom by name (${mocks.slice(0, 3).join(', ')}): move each mock with the imports it stands in for`,
    };
  const source = fresh(text);
  const declaration = declarationsFrom(source, DOM).find((d) =>
    at(source, d.getModuleSpecifier() as Node, finding),
  );
  if (!declaration || !movable(declaration))
    return {
      text,
      applied: false,
      reason: 'the reported site is not a movable react-router-dom import',
    };
  const literal = declaration.getModuleSpecifier() as Node;
  const quote = literal.getText()[0];
  return {
    text: `${text.slice(0, literal.getStart())}${quote}react-router${quote}${text.slice(literal.getEnd())}`,
    applied: true,
    reason: 'react-router-dom 7 re-exports these names from react-router: import them from there',
  };
}

const SERVER = 'react-router-dom/server';

/** `react-router-dom/server` is not in v7's exports map, even with `react-router-dom` kept. */
export function domServerSites(text: string): SourceSite[] {
  if (!text.includes(SERVER)) return [];
  const source = parse(text);
  return declarationsFrom(source, SERVER).map((d) =>
    siteAt(source, d.getModuleSpecifier() as Node, SERVER),
  );
}

/** Its seven names (StaticRouter, createStaticHandler, ...) are all exported by `react-router`. */
export function moveDomServerImport(
  text: string,
  finding: Pick<Finding, 'usage'>,
): TransformResult {
  const source = fresh(text);
  const literal = declarationsFrom(source, SERVER)
    .map((d) => d.getModuleSpecifier() as Node)
    .find((l) => at(source, l, finding));
  if (!literal)
    return {
      text,
      applied: false,
      reason: 'the reported site is not a react-router-dom/server import',
    };
  const quote = literal.getText()[0];
  return {
    text: `${text.slice(0, literal.getStart())}${quote}react-router${quote}${text.slice(literal.getEnd())}`,
    applied: true,
    reason: 'react-router-dom/server is gone in v7: its exports are in react-router',
  };
}

/** Local names the file binds to `names` imported from react-router or react-router-dom. */
function routerBindings(source: SourceFile, names: readonly string[]): Map<string, string> {
  const bound = new Map<string, string>();
  for (const declaration of source.getImportDeclarations()) {
    if (!ROUTER_MODULES.has(declaration.getModuleSpecifierValue())) continue;
    for (const named of declaration.getNamedImports())
      if (names.includes(named.getName()))
        bound.set((named.getAliasNode() ?? named.getNameNode()).getText(), named.getName());
  }
  return bound;
}

const imports = (text: string) => /['"]react-router(?:-dom)?['"]/.test(text);

/**
 * Calls of `json(...)`, `defer(...)` and `new AbortedDeferredError(...)` (or an `instanceof`
 * check) bound to the removed exports. The compiler reports the import alone: once it fails,
 * every call through it is `any` and compiles.
 */
export function removedCallSites(text: string, names: readonly string[]): SourceSite[] {
  if (!imports(text) || !names.some((n) => text.includes(n))) return [];
  const source = parse(text);
  const bound = routerBindings(source, names);
  if (!bound.size) return [];
  const sites: SourceSite[] = [];
  source.forEachDescendant((node) => {
    if (!Node.isIdentifier(node) || !bound.has(node.getText())) return;
    const parent = node.getParent();
    const called =
      (Node.isCallExpression(parent) || Node.isNewExpression(parent)) &&
      parent.getExpression() === node;
    const checked =
      Node.isBinaryExpression(parent) &&
      parent.getOperatorToken().getKind() === SyntaxKind.InstanceOfKeyword &&
      parent.getRight() === node;
    // A local that shadows the import is another function.
    const declared = node.getSymbol()?.getDeclarations() ?? [];
    if (!declared.every((d) => Node.isImportSpecifier(d))) return;
    if (called || checked) sites.push(siteAt(source, node, bound.get(node.getText()) as string));
  });
  return sites;
}

const FACTORIES: Record<string, number> = {
  createBrowserRouter: 1,
  createHashRouter: 1,
  createMemoryRouter: 1,
  createStaticHandler: 1,
  createStaticRouter: 2,
};

/** The `future` property of a router factory's options, at the call that passes it. */
function futureOptions(source: SourceFile) {
  const bound = routerBindings(source, Object.keys(FACTORIES));
  return source.getDescendantsOfKind(SyntaxKind.CallExpression).flatMap((call: CallExpression) => {
    const callee = call.getExpression();
    const name = Node.isIdentifier(callee) ? bound.get(callee.getText()) : undefined;
    if (!name) return [];
    const options = call.getArguments()[FACTORIES[name] as number];
    if (!options || !Node.isObjectLiteralExpression(options)) return [];
    const future = options.getProperty('future');
    return future && Node.isPropertyAssignment(future) ? [{ call, options, future }] : [];
  });
}

/**
 * `createBrowserRouter(routes, { future: { v7_relativeSplatPath: true } })`. v7 types
 * `future` as an empty interface, so the stale keys compile and do nothing; 8.4 rejects them.
 * Only an inline object of v6 flags is a site: a variable may be read elsewhere.
 */
export function futureOptionSites(text: string): SourceSite[] {
  if (!text.includes('future') || !imports(text)) return [];
  const source = parse(text);
  return futureOptions(source)
    .filter(({ future }) => staleFlags(future.getInitializer()) && !commented(future))
    .map(({ future }) => siteAt(source, future, 'future'));
}

/** `{ v7_x: true, v7_y: false }`: only v6 flags, each a boolean literal. */
function staleFlags(node: Node | undefined): boolean {
  if (!node || !Node.isObjectLiteralExpression(node)) return false;
  return node.getProperties().every((p) => {
    if (!Node.isPropertyAssignment(p) || !/^v7_\w+$/.test(p.getName())) return false;
    const value = p.getInitializer()?.getKind();
    return value === SyntaxKind.TrueKeyword || value === SyntaxKind.FalseKeyword;
  });
}

/** A comment before the node may describe more than the flags: such a site is left to a person. */
const commented = (node: Node): boolean => node.getLeadingCommentRanges().length > 0;

/** `text` without [start, end). */
const cut = (text: string, start: number, end: number): string =>
  text.slice(0, start) + text.slice(end);

/**
 * The `future` option goes; an options object left empty goes with it when it is the last
 * argument. Text ranges, not a printer: the rest of the call keeps its layout and commas.
 */
export function removeFutureOption(text: string, finding: Pick<Finding, 'usage'>): TransformResult {
  const source = fresh(text);
  const found = futureOptions(source).find(({ future }) => at(source, future, finding));
  if (!found)
    return { text, applied: false, reason: 'the reported site is not a router `future` option' };
  const { call, options, future } = found;
  if (!staleFlags(future.getInitializer()) || commented(future))
    return {
      text,
      applied: false,
      reason: '`future` holds something other than v6 flags set to true or false',
    };
  const args = call.getArguments();
  const properties = options.getProperties();
  const index = properties.indexOf(future);
  let out: string;
  if (properties.length === 1 && args[args.length - 1] === options && !commented(options))
    out = cut(text, (args[args.length - 2] as Node).getEnd(), options.getEnd());
  else if (index < properties.length - 1)
    out = cut(text, future.getStart(), (properties[index + 1] as Node).getStart());
  else if (index > 0) out = cut(text, (properties[index - 1] as Node).getEnd(), future.getEnd());
  else out = cut(text, future.getStart(), future.getEnd());
  return {
    text: out,
    applied: true,
    reason: 'v7 has no v6 future flags: their behavior is the default and the keys do nothing',
  };
}

const ROUTERS = new Set([
  'BrowserRouter',
  'HashRouter',
  'MemoryRouter',
  'Router',
  'StaticRouter',
  'RouterProvider',
  'HistoryRouter',
  'unstable_HistoryRouter',
]);

/**
 * `<RouterProvider future={{ v7_startTransition: true }}>`: the prop is gone from every router
 * component in v7 (TS2322). Removed when it is an inline object of v6 flags; a variable or
 * anything computed is left for a person, who may need it elsewhere.
 */
export function removeFutureProp(text: string, finding: Pick<Finding, 'usage'>): TransformResult {
  const source = fresh(text);
  const elements = [
    ...source.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...source.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];
  const element = elements.find((e) => {
    const attribute = e.getAttribute('future');
    return attribute && (at(source, e.getTagNameNode(), finding) || at(source, attribute, finding));
  });
  const tag = element?.getTagNameNode().getText().split('.').pop() ?? '';
  // `HashRouter as Router`: the imported name decides, not the local one.
  const imported = routerBindings(source, [...ROUTERS]).get(tag) ?? tag;
  const attribute = element?.getAttribute('future');
  if (!element || !ROUTERS.has(imported) || !attribute || !Node.isJsxAttribute(attribute))
    return {
      text,
      applied: false,
      reason: 'the reported site is not a router with a `future` prop',
    };
  const value = attribute.getInitializer();
  if (
    !value ||
    !Node.isJsxExpression(value) ||
    !staleFlags(value.getExpression()) ||
    commented(attribute)
  )
    return {
      text,
      applied: false,
      reason: '`future` is not an inline object of v6 flags: it may be used elsewhere',
    };
  attribute.remove();
  return {
    text: source.getFullText(),
    applied: true,
    reason: 'router components take no `future` prop in v7: the v6 flags are the default',
  };
}

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const EQUALITY = new Set([
  SyntaxKind.EqualsEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken,
  SyntaxKind.EqualsEqualsToken,
  SyntaxKind.ExclamationEqualsToken,
]);

function unwrap(node: Node): Node {
  let current = node;
  while (Node.isParenthesizedExpression(current) || Node.isNonNullExpression(current))
    current = current.getExpression();
  return current;
}
const readsFormMethod = (node: Node): boolean => {
  const read = unwrap(node);
  return Node.isPropertyAccessExpression(read) && read.getName() === 'formMethod';
};
const lowercaseMethod = (node: Node): boolean => {
  const value = unwrap(node);
  return (
    (Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value)) &&
    METHODS.has(value.getLiteralText())
  );
};

/** Each comparison of a `.formMethod` with a lowercase method, and the literal to uppercase. */
function lowercaseComparisons(source: SourceFile): { site: Node; literal: Node }[] {
  const found: { site: Node; literal: Node }[] = [];
  for (const binary of source.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (!EQUALITY.has(binary.getOperatorToken().getKind())) continue;
    const [left, right] = [binary.getLeft(), binary.getRight()];
    if (readsFormMethod(left) && lowercaseMethod(right))
      found.push({ site: binary, literal: right });
    else if (readsFormMethod(right) && lowercaseMethod(left))
      found.push({ site: binary, literal: left });
  }
  for (const clause of source.getDescendantsOfKind(SyntaxKind.CaseClause)) {
    const owner = clause.getFirstAncestorByKind(SyntaxKind.SwitchStatement);
    if (owner && readsFormMethod(owner.getExpression()) && lowercaseMethod(clause.getExpression()))
      found.push({ site: clause.getExpression(), literal: clause.getExpression() });
  }
  return found;
}

/**
 * `navigation.formMethod === 'post'`: v7 always uppercases `formMethod` (the
 * `v7_normalizeFormMethod` behavior), so a lowercase comparison is now always false. The
 * compiler sees it only where `formMethod` is typed; through `any` or `string` it is blind.
 */
export function formMethodSites(text: string): SourceSite[] {
  if (!text.includes('formMethod') || !imports(text)) return [];
  const source = parse(text);
  return lowercaseComparisons(source).map(({ site }) => siteAt(source, site, 'formMethod'));
}

/** The lowercase method compared with `formMethod` on the reported line, uppercased. */
export function uppercaseFormMethod(
  text: string,
  finding: Pick<Finding, 'usage'>,
): TransformResult {
  const source = fresh(text);
  const literals = lowercaseComparisons(source)
    .map(({ literal }) => unwrap(literal))
    .filter((l) => source.getLineAndColumnAtPos(l.getStart()).line === finding.usage.line)
    .sort((a, b) => b.getStart() - a.getStart());
  if (!literals.length)
    return {
      text,
      applied: false,
      reason: 'no lowercase method is compared with `formMethod` on the reported line',
    };
  let out = text;
  for (const literal of literals) {
    const raw = literal.getText();
    out = `${out.slice(0, literal.getStart())}${raw[0]}${raw.slice(1, -1).toUpperCase()}${raw.slice(-1)}${out.slice(literal.getEnd())}`;
  }
  return {
    text: out,
    applied: true,
    reason: 'formMethod is uppercase in v7: compare with the uppercase method, as v6 did lowercase',
  };
}
