import {
  type CallExpression,
  type ForOfStatement,
  Node,
  type ObjectLiteralExpression,
  Project,
  type SourceFile,
  SyntaxKind,
} from 'ts-morph';
import type { Finding } from '../../domain/report.js';
import type { SourceSite } from '../contract.js';
import type { TransformResult } from '../types.js';

/**
 * Syntactic sites for node-redis: what the type diff cannot see in JavaScript, through `any`, or
 * where both majors compile and the behavior differs. Only files that import `redis` or an
 * `@redis/*` package are read, so a `.quit()` or `keepAlive` of another library is never a site.
 */
const ENTRY = /^(?:redis|@redis\/(?:client|search|json|time-series|bloom|graph))(?:\/.*)?$/;

function parse(text: string, file = 'consumer.ts'): SourceFile {
  const name = /\.[cm]?jsx?$/.test(file) ? 'consumer.js' : 'consumer.ts';
  return new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { allowJs: true },
  }).createSourceFile(name, text, { overwrite: true });
}

function site(source: SourceFile, node: Node, name?: string): SourceSite {
  const { line, column } = source.getLineAndColumnAtPos(node.getStart());
  const snippet = source.getFullText().split('\n')[line - 1]?.trim() ?? '';
  return { line, column, snippet, ...(name ? { name } : {}) };
}

/** Local names bound to the packages: named, default, namespace imports and `require`. */
interface Bindings {
  /** Local → imported name. */
  named: Map<string, string>;
  /** Namespace or default imports, and `const redis = require('redis')`. */
  modules: Set<string>;
  /** Whether the file uses node-redis at all. */
  uses: boolean;
}

function bindings(source: SourceFile): Bindings {
  const named = new Map<string, string>();
  const modules = new Set<string>();
  let uses = false;
  for (const declaration of source.getImportDeclarations()) {
    if (!ENTRY.test(declaration.getModuleSpecifierValue())) continue;
    uses = true;
    const namespace = declaration.getNamespaceImport();
    if (namespace) modules.add(namespace.getText());
    const fallback = declaration.getDefaultImport();
    if (fallback) modules.add(fallback.getText());
    for (const element of declaration.getNamedImports())
      named.set((element.getAliasNode() ?? element.getNameNode()).getText(), element.getName());
  }
  for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    const [arg] = call.getArguments();
    if (
      (callee.getText() !== 'require' && callee.getKind() !== SyntaxKind.ImportKeyword) ||
      !arg ||
      !Node.isStringLiteral(arg) ||
      !ENTRY.test(arg.getLiteralValue())
    )
      continue;
    uses = true;
    const nameNode = call.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)?.getNameNode();
    if (Node.isIdentifier(nameNode)) modules.add(nameNode.getText());
    else if (Node.isObjectBindingPattern(nameNode))
      for (const element of nameNode.getElements())
        named.set(
          element.getNameNode().getText(),
          element.getPropertyNameNode()?.getText() ?? element.getNameNode().getText(),
        );
  }
  return { named, modules, uses };
}

function using(text: string, file: string): { source: SourceFile; b: Bindings } | undefined {
  // Cheap gate before parsing: most files never mention the packages.
  if (!/['"](?:redis|@redis\/[\w-]+)(?:\/[^'"]*)?['"]/.test(text)) return undefined;
  const source = parse(text, file);
  const b = bindings(source);
  return b.uses ? { source, b } : undefined;
}

const lineOf = (source: SourceFile, node: Node) =>
  source.getLineAndColumnAtPos(node.getStart()).line;

/** `createClient(...)` and friends, imported by name or reached through the module binding. */
const FACTORIES = new Set(['createClient', 'createCluster', 'createSentinel', 'createClientPool']);

function factoryOf(call: CallExpression, b: Bindings): string | undefined {
  const callee = call.getExpression();
  if (Node.isIdentifier(callee)) {
    const imported = b.named.get(callee.getText());
    return imported && FACTORIES.has(imported) ? imported : undefined;
  }
  if (Node.isPropertyAccessExpression(callee)) {
    const name = callee.getName();
    return b.modules.has(callee.getExpression().getText()) && FACTORIES.has(name)
      ? name
      : undefined;
  }
  return undefined;
}

const keyOf = (p: Node) =>
  Node.isPropertyAssignment(p) || Node.isShorthandPropertyAssignment(p)
    ? p
        .getNameNode()
        .getText()
        .replace(/^['"]|['"]$/g, '')
    : undefined;

/** Every object literal property named one of `names` in a node-redis file. */
function propertiesNamed(source: SourceFile, names: readonly string[]): Node[] {
  return source
    .getDescendantsOfKind(SyntaxKind.PropertyAssignment)
    .filter((p) => names.includes(keyOf(p) ?? ''));
}

// ---- v5 (from 4.x) -------------------------------------------------------------------------

/** `legacyMode: true` in client options: removed in 5, which has `client.legacy()` instead. */
export function legacyModeSites(text: string, file: string): SourceSite[] {
  const found = using(text, file);
  if (!found) return [];
  return propertiesNamed(found.source, ['legacyMode']).map((p) => site(found.source, p));
}

/**
 * The v4 per-call options: `client.commandOptions({...})` or the exported `commandOptions(...)`
 * as a command's first argument, and `executeIsolated`. 5 has `withCommandOptions` (a proxy
 * client) and `createClientPool`. The site is the call that builds the options.
 */
export function commandOptionsSites(text: string, file: string): SourceSite[] {
  const found = using(text, file);
  if (!found) return [];
  const { source, b } = found;
  const sites: SourceSite[] = [];
  for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    const name = Node.isPropertyAccessExpression(callee)
      ? callee.getName()
      : Node.isIdentifier(callee)
        ? b.named.get(callee.getText())
        : undefined;
    if (name === 'commandOptions' && call.getArguments().length > 0) sites.push(site(source, call));
    else if (name === 'executeIsolated' && Node.isPropertyAccessExpression(callee))
      sites.push(site(source, call));
  }
  return sites;
}

const ITERATORS = /^(?:scan|hScan|sScan|zScan)Iterator$/;

function scanLoops(source: SourceFile): ForOfStatement[] {
  return source.getDescendantsOfKind(SyntaxKind.ForOfStatement).filter((loop) => {
    const iterated = loop.getExpression();
    if (!loop.isAwaited() || !Node.isCallExpression(iterated)) return false;
    const callee = iterated.getExpression();
    return Node.isPropertyAccessExpression(callee) && ITERATORS.test(callee.getName());
  });
}

/** `for await (const key of client.scanIterator())`: 5 yields one batch (an array) per step. */
export function scanIteratorSites(text: string, file: string): SourceSite[] {
  const found = using(text, file);
  if (!found) return [];
  return scanLoops(found.source).map((loop) => site(found.source, loop));
}

/** A `break` or `continue` that targets this loop: an inner loop would take it instead. */
function exitsLoop(loop: ForOfStatement): boolean {
  return loop
    .getStatement()
    .getDescendants()
    .some((node) => {
      if (!Node.isBreakStatement(node) && !Node.isContinueStatement(node)) return false;
      if (node.getLabel()) return true;
      const owner = node.getFirstAncestor(
        (a) =>
          Node.isIterationStatement(a) ||
          (Node.isSwitchStatement(a) && Node.isBreakStatement(node)) ||
          Node.isFunctionLikeDeclaration(a),
      );
      return owner === loop;
    });
}

/**
 * Keeps the loop body as it is, item by item: `for await (const keys of it) for (const key of
 * keys) <body>`. Declined when the body `break`s or `continue`s the loop (the inner loop would
 * take it), or the loop does not declare one plain binding.
 */
export function rewriteScanIterator(
  text: string,
  finding: Pick<Finding, 'usage'>,
): TransformResult {
  const source = using(text, finding.usage.file)?.source;
  if (!source) return { text, applied: false, reason: 'the file does not use node-redis' };
  const loop = scanLoops(source).find((l) => lineOf(source, l) === finding.usage.line);
  if (!loop) return { text, applied: false, reason: 'no scan iterator loop at the reported line' };
  if (exitsLoop(loop))
    return {
      text,
      applied: false,
      reason: 'the loop body breaks or continues the loop; an inner loop would change its target',
    };
  const initializer = loop.getInitializer();
  if (!Node.isVariableDeclarationList(initializer) || initializer.getDeclarations().length !== 1)
    return { text, applied: false, reason: 'the loop does not declare its own binding' };
  const keyword = initializer.getDeclarationKind();
  const binding = initializer.getDeclarations()[0]?.getNameNode().getText() ?? '';
  const batch = /^[A-Za-z_$][\w$]*$/.test(binding) ? `${binding}Batch` : 'batch';
  if (new RegExp(`(?<![\\w$])${batch.replace(/\$/g, '\\$')}(?![\\w$])`).test(text))
    return { text, applied: false, reason: `\`${batch}\` is already a name in this file` };
  const head = `for await (${keyword} ${batch} of ${loop.getExpression().getText()}) for (${keyword} ${binding} of ${batch})`;
  return {
    text: `${text.slice(0, loop.getStart())}${head} ${text.slice(loop.getStatement().getStart())}`,
    applied: true,
    reason: 'scan iterators yield a batch per step in 5: the body runs once per item of each batch',
  };
}

function keepAliveDelay(p: Node): string | undefined {
  const value = Node.isPropertyAssignment(p) ? p.getInitializer() : undefined;
  return value && Node.isNumericLiteral(value) ? value.getText() : undefined;
}

/** `keepAlive: <number>`: 5 splits it into `keepAlive: true` and `keepAliveInitialDelay`. */
export function keepAliveSites(text: string, file: string): SourceSite[] {
  const found = using(text, file);
  if (!found) return [];
  return propertiesNamed(found.source, ['keepAlive'])
    .filter((p) => keepAliveDelay(p) !== undefined)
    .map((p) => site(found.source, p));
}

export function rewriteKeepAlive(text: string, finding: Pick<Finding, 'usage'>): TransformResult {
  const source = using(text, finding.usage.file)?.source;
  if (!source) return { text, applied: false, reason: 'the file does not use node-redis' };
  const p = propertiesNamed(source, ['keepAlive']).find(
    (n) => lineOf(source, n) === finding.usage.line,
  );
  const delay = p && keepAliveDelay(p);
  if (!p || delay === undefined)
    return { text, applied: false, reason: 'no numeric `keepAlive` at the reported line' };
  const siblings = p.getParentIfKind(SyntaxKind.ObjectLiteralExpression)?.getProperties() ?? [];
  if (siblings.some((s) => keyOf(s) === 'keepAliveInitialDelay'))
    return { text, applied: false, reason: '`keepAliveInitialDelay` is already set here' };
  return {
    text: `${text.slice(0, p.getStart())}keepAlive: true, keepAliveInitialDelay: ${delay}${text.slice(p.getEnd())}`,
    applied: true,
    reason: '`keepAlive: <ms>` is `keepAlive: true` with `keepAliveInitialDelay: <ms>` in 5',
  };
}

const EQUALITY = new Set([
  SyntaxKind.EqualsEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken,
  SyntaxKind.EqualsEqualsToken,
  SyntaxKind.ExclamationEqualsToken,
]);

/**
 * A numeric SCAN cursor: `scan(0)`, `hScan(key, 0)`, or a cursor compared with a number. 5 takes
 * and returns the cursor as a string, so `cursor !== 0` never ends the loop in JavaScript.
 */
export function scanCursorSites(text: string, file: string): SourceSite[] {
  const found = using(text, file);
  if (!found) return [];
  const { source } = found;
  const sites: SourceSite[] = [];
  for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    const name = callee.getName();
    const index = name === 'scan' ? 0 : /^(?:hScan|sScan|zScan)$/.test(name) ? 1 : -1;
    const cursor = index >= 0 ? call.getArguments()[index] : undefined;
    if (cursor && Node.isNumericLiteral(cursor)) sites.push(site(source, call));
  }
  for (const binary of source.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (!EQUALITY.has(binary.getOperatorToken().getKind())) continue;
    const [left, right] = [binary.getLeft(), binary.getRight()];
    const other = Node.isNumericLiteral(right)
      ? left
      : Node.isNumericLiteral(left)
        ? right
        : undefined;
    if (other && /(?:^|\.)cursor$/i.test(other.getText())) sites.push(site(source, binary));
  }
  const seen = new Set<number>();
  return sites.filter((s) => !seen.has(s.line) && seen.add(s.line));
}

const QUERIES =
  /^(?:search|SEARCH|searchNoContent|aggregate|AGGREGATE|aggregateWithCursor|explain|EXPLAIN|profileSearch|profileAggregate|spellCheck|SPELLCHECK)$/;

/** `client.ft.search(...)` and the other query commands, with no `DIALECT` in their options. */
export function searchDialectSites(text: string, file: string): SourceSite[] {
  const found = using(text, file);
  if (!found) return [];
  const { source } = found;
  return source
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) => {
      const callee = call.getExpression();
      if (!Node.isPropertyAccessExpression(callee) || !QUERIES.test(callee.getName())) return false;
      const owner = callee.getExpression();
      if (!Node.isPropertyAccessExpression(owner) || owner.getName() !== 'ft') return false;
      // A non-literal options argument may set it: only a literal can be read.
      const options = call.getArguments()[2];
      if (options && !Node.isObjectLiteralExpression(options)) return false;
      return !options
        ?.getProperties()
        .some((p) => keyOf(p) === 'DIALECT' || Node.isSpreadAssignment(p));
    })
    .map((call) => site(source, call));
}

/** `@redis/graph`: not part of redis 5 (RedisGraph reached end of life). */
export function graphSites(text: string, file: string): SourceSite[] {
  if (!/['"]@redis\/graph['"]/.test(text)) return [];
  const source = parse(text, file);
  const sites: SourceSite[] = [];
  for (const declaration of source.getImportDeclarations())
    if (declaration.getModuleSpecifierValue() === '@redis/graph')
      sites.push(site(source, declaration));
  for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const [arg] = call.getArguments();
    if (
      call.getExpression().getText() === 'require' &&
      arg &&
      Node.isStringLiteral(arg) &&
      arg.getLiteralValue() === '@redis/graph'
    )
      sites.push(site(source, call));
  }
  return sites;
}

// ---- v6 (from 5.x) -------------------------------------------------------------------------

const UNSTABLE = ['unstableResp3', 'unstableResp3Modules'];

/** `unstableResp3` and `unstableResp3Modules`: removed in 6, where those transforms are stable. */
export function unstableResp3Sites(text: string, file: string): SourceSite[] {
  const found = using(text, file);
  if (!found) return [];
  return propertiesNamed(found.source, UNSTABLE).map((p) => site(found.source, p));
}

/**
 * Removes the property at the reported line and nothing else: the whole line when the property
 * is alone on it, else the property and its comma.
 */
export function rewriteUnstableResp3(
  text: string,
  finding: Pick<Finding, 'usage'>,
): TransformResult {
  const source = using(text, finding.usage.file)?.source;
  if (!source) return { text, applied: false, reason: 'the file does not use node-redis' };
  const p = propertiesNamed(source, UNSTABLE).find((n) => lineOf(source, n) === finding.usage.line);
  if (!p) return { text, applied: false, reason: 'no `unstableResp3` option at the reported line' };
  const reason = `\`${keyOf(p)}\` is removed in 6: the RESP3 transforms it gated are stable`;
  const lines = text.split('\n');
  const line = lines[finding.usage.line - 1] ?? '';
  const comma = text.slice(p.getEnd()).match(/^\s*,/)?.[0] ?? '';
  const property = text.slice(p.getStart(), p.getEnd() + comma.length);
  if (line.trim().replace(/\s*\/\/.*$/, '') === property.trim()) {
    lines.splice(finding.usage.line - 1, 1);
    return { text: lines.join('\n'), applied: true, reason };
  }
  const after = text.slice(p.getEnd() + comma.length).replace(/^ /, '');
  return { text: `${text.slice(0, p.getStart())}${after}`, applied: true, reason };
}

/**
 * The defaults 6 changes, and the option that keeps each at its 5 value. A client that sets
 * none of them explicitly behaves differently after the upgrade.
 */
export const V6_DEFAULTS = [
  { option: 'RESP', keep: 'RESP: 2' },
  { option: 'commandOptions.timeout', keep: 'commandOptions: { timeout: undefined }' },
  { option: 'socket.keepAliveInitialDelay', keep: 'socket: { keepAliveInitialDelay: 5000 }' },
  { option: 'maintNotifications', keep: "maintNotifications: 'disabled'" },
] as const;

function sets(options: ObjectLiteralExpression | undefined, path: string): boolean {
  if (!options) return false;
  const [head, tail] = path.split('.') as [string, string | undefined];
  const p = options.getProperties().find((candidate) => keyOf(candidate) === head);
  if (!p) return false;
  if (!tail) return true;
  const value = Node.isPropertyAssignment(p) ? p.getInitializer() : undefined;
  // A nested value that is not a literal may set it: only a literal can be read.
  return Node.isObjectLiteralExpression(value) ? sets(value, tail) : true;
}

/**
 * Each client a factory builds whose options leave a default 6 changes to the library. Options
 * passed as a variable or with a spread may set them: those calls are not sites.
 */
export function clientDefaultSites(text: string, file: string): SourceSite[] {
  const found = using(text, file);
  if (!found) return [];
  const { source, b } = found;
  const sites: SourceSite[] = [];
  for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const factory = factoryOf(call, b);
    if (!factory) continue;
    const [first] = call.getArguments();
    if (first && !Node.isObjectLiteralExpression(first)) continue;
    if (first?.getProperties().some((p) => Node.isSpreadAssignment(p))) continue;
    // RESP 2 keeps maintNotifications disabled; the timeout and keep-alive change regardless.
    const left = V6_DEFAULTS.filter(
      (d) => !sets(first, d.option) && !(d.option === 'maintNotifications' && sets(first, 'RESP')),
    );
    if (left.length) sites.push(site(source, call, factory));
  }
  return sites;
}
