import { ts } from 'ts-morph';
import type { SourceSite } from '../contract.js';

/**
 * Syntax-only detectors for what ioredis 6 changes where the compiler is blind: client options
 * left at a changed default, and strings the code compares with (`mode`, the handshake command).
 * Each one starts from the bindings an `ioredis` import, require or dynamic import creates, so a
 * local class that happens to be called `Redis` is never reported.
 */

const SOURCE = /\.[cm]?[jt]sx?$/;
/** Clients built by tests talk to a test server: their wire defaults are not the application's. */
const TEST = /(?:^|\/)(?:__tests__|__mocks__|tests?|e2e)\/|\.(?:test|spec|e2e-spec)\.[cm]?[jt]sx?$/;
const MODULE = 'ioredis';

const parse = (text: string) =>
  ts.createSourceFile('input.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function site(source: ts.SourceFile, node: ts.Node, name: string): SourceSite {
  const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return {
    line: line + 1,
    column: character + 1,
    snippet: source.text.split('\n')[line]?.trim() ?? '',
    name,
  };
}

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isAwaitExpression(node) ||
  ts.isParenthesizedExpression(node) ||
  ts.isAsExpression(node) ||
  ts.isNonNullExpression(node)
    ? unwrap(node.expression)
    : node;

const isModuleCall = (node: ts.Expression): boolean => {
  const call = unwrap(node);
  if (!ts.isCallExpression(call) || call.arguments.length !== 1) return false;
  const [specifier] = call.arguments;
  const callee = call.expression;
  return (
    specifier !== undefined &&
    ts.isStringLiteralLike(specifier) &&
    specifier.text === MODULE &&
    (callee.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(callee) && callee.text === 'require'))
  );
};

/**
 * Local names bound to the module object (`import * as io`, `require('ioredis')`, `await
 * import('ioredis')`) and to its client classes (the default export, `Redis`, `Cluster`).
 */
export function ioredisBindings(source: ts.SourceFile): {
  modules: Set<string>;
  clients: Map<string, 'Redis' | 'Cluster'>;
} {
  const modules = new Set<string>();
  const clients = new Map<string, 'Redis' | 'Cluster'>();
  const member = (name: string): 'Redis' | 'Cluster' | undefined =>
    name === 'default' || name === 'Redis' ? 'Redis' : name === 'Cluster' ? 'Cluster' : undefined;
  const bindPattern = (pattern: ts.ObjectBindingPattern) => {
    for (const element of pattern.elements) {
      const imported = (element.propertyName ?? element.name).getText(source);
      const kind = member(imported);
      if (kind && ts.isIdentifier(element.name)) clients.set(element.name.text, kind);
    }
  };
  walk(source, (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === MODULE &&
      node.importClause &&
      !node.importClause.isTypeOnly
    ) {
      const clause = node.importClause;
      if (clause.name) clients.set(clause.name.text, 'Redis');
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) modules.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements) {
          if (element.isTypeOnly) continue;
          const kind = member((element.propertyName ?? element.name).text);
          if (kind) clients.set(element.name.text, kind);
        }
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression) &&
      node.moduleReference.expression.text === MODULE
    )
      clients.set(node.name.text, 'Redis');
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = unwrap(node.initializer);
      if (isModuleCall(init)) {
        if (ts.isIdentifier(node.name)) {
          // `require` returns the class itself (module.exports = Redis); `import()` the namespace.
          modules.add(node.name.text);
          if (ts.isCallExpression(init) && ts.isIdentifier(init.expression))
            clients.set(node.name.text, 'Redis');
        } else if (ts.isObjectBindingPattern(node.name)) bindPattern(node.name);
      } else if (ts.isPropertyAccessExpression(init) && ts.isIdentifier(node.name)) {
        const kind = member(init.name.text);
        const target = unwrap(init.expression);
        if (kind && (isModuleCall(target) || (ts.isIdentifier(target) && modules.has(target.text))))
          clients.set(node.name.text, kind);
      } else if (
        ts.isIdentifier(init) &&
        modules.has(init.text) &&
        ts.isObjectBindingPattern(node.name)
      )
        bindPattern(node.name);
    }
  });
  return { modules, clients };
}

/** The client class a `new` expression constructs, when it is one of ioredis's. */
function constructed(
  expression: ts.Expression,
  bindings: ReturnType<typeof ioredisBindings>,
): 'Redis' | 'Cluster' | undefined {
  const callee = unwrap(expression);
  if (ts.isIdentifier(callee)) return bindings.clients.get(callee.text);
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  const owner = unwrap(callee.expression);
  const name = callee.name.text;
  const known =
    (ts.isIdentifier(owner) &&
      (bindings.modules.has(owner.text) || bindings.clients.has(owner.text))) ||
    isModuleCall(owner);
  if (!known) return undefined;
  return name === 'Cluster'
    ? 'Cluster'
    : name === 'Redis' || name === 'default'
      ? 'Redis'
      : undefined;
}

export interface ClientConstruction {
  node: ts.NewExpression;
  kind: 'Redis' | 'Cluster';
  /** Option names written in object literals passed to it, nested ones included (`redisOptions.protocol`). */
  options: Set<string>;
  /** An argument whose keys cannot be read (a variable, a spread): its options are unknown. */
  opaque: boolean;
}

function optionNames(node: ts.Expression, names: Set<string>, prefix = ''): boolean /* opaque */ {
  const value = unwrap(node);
  if (!ts.isObjectLiteralExpression(value)) return true;
  let opaque = false;
  for (const property of value.properties) {
    if (ts.isSpreadAssignment(property)) {
      opaque = true;
      continue;
    }
    const name = property.name;
    if (!name || !(ts.isIdentifier(name) || ts.isStringLiteral(name))) continue;
    names.add(`${prefix}${name.text}`);
    if (
      ts.isPropertyAssignment(property) &&
      ts.isObjectLiteralExpression(unwrap(property.initializer))
    )
      opaque = optionNames(property.initializer, names, `${prefix}${name.text}.`) || opaque;
  }
  return opaque;
}

export function clientConstructions(source: ts.SourceFile): ClientConstruction[] {
  const bindings = ioredisBindings(source);
  if (bindings.clients.size === 0 && bindings.modules.size === 0) return [];
  const found: ClientConstruction[] = [];
  walk(source, (node) => {
    if (!ts.isNewExpression(node)) return;
    const kind = constructed(node.expression, bindings);
    if (!kind) return;
    const options = new Set<string>();
    let opaque = false;
    // Redis(port, host, options) / Redis(url, options) / Redis(options); Cluster(nodes, options).
    const args = [...(node.arguments ?? [])].slice(kind === 'Cluster' ? 1 : 0);
    for (const arg of args) {
      const value = unwrap(arg);
      if (
        ts.isStringLiteralLike(value) ||
        ts.isNumericLiteral(value) ||
        ts.isTemplateExpression(value)
      )
        continue;
      if (ts.isObjectLiteralExpression(value)) opaque = optionNames(value, options) || opaque;
      // A URL or port held in a variable is the usual case for a non-final argument.
      else if (arg === args[args.length - 1]) opaque = true;
    }
    found.push({ node, kind, options, opaque });
  });
  return found;
}

/** The defaults ioredis 6 changed that a client inherits unless it sets them. */
const PINNED = {
  Redis: ['protocol', 'retryStrategy', 'keepAlive'],
  Cluster: ['redisOptions.protocol', 'redisOptions.keepAlive'],
} as const;

/**
 * Clients that inherit at least one default ioredis 6 changed: RESP3 (`protocol`), the
 * reconnect backoff (`retryStrategy`) and TCP keep-alive (`keepAlive`). Test files are skipped.
 */
export function clientDefaultSites(text: string, file: string): SourceSite[] {
  if (!SOURCE.test(file) || TEST.test(file)) return [];
  const source = parse(text);
  return clientConstructions(source)
    .filter((c) => c.opaque || PINNED[c.kind].some((option) => !c.options.has(option)))
    .map((c) => site(source, c.node, c.kind));
}

const SUBSCRIBER = 'subscriber';
const EQUALITY = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);
const isModeAccess = (node: ts.Expression) => {
  const value = unwrap(node);
  return (
    (ts.isPropertyAccessExpression(value) && value.name.text === 'mode') ||
    (ts.isElementAccessExpression(value) &&
      ts.isStringLiteralLike(value.argumentExpression) &&
      value.argumentExpression.text === 'mode')
  );
};

/**
 * `client.mode === 'subscriber'`: under RESP3 a subscribed connection keeps `mode` "normal",
 * so the branch silently stops being taken. Only in files that import ioredis.
 */
export function subscriberModeSites(text: string, file: string): SourceSite[] {
  if (!SOURCE.test(file)) return [];
  const source = parse(text);
  const bindings = ioredisBindings(source);
  if (
    bindings.clients.size === 0 &&
    bindings.modules.size === 0 &&
    !/from\s+['"]ioredis['"]/.test(text)
  )
    return [];
  const sites: SourceSite[] = [];
  walk(source, (node) => {
    if (ts.isBinaryExpression(node) && EQUALITY.has(node.operatorToken.kind)) {
      const [left, right] = [unwrap(node.left), unwrap(node.right)];
      const literal = ts.isStringLiteralLike(right)
        ? right
        : ts.isStringLiteralLike(left)
          ? left
          : undefined;
      const other = literal === right ? left : right;
      if (literal?.text === SUBSCRIBER && isModeAccess(other))
        sites.push(site(source, node, 'mode'));
    }
    if (ts.isSwitchStatement(node) && isModeAccess(node.expression))
      for (const clause of node.caseBlock.clauses)
        if (
          ts.isCaseClause(clause) &&
          ts.isStringLiteralLike(clause.expression) &&
          clause.expression.text === SUBSCRIBER
        )
          sites.push(site(source, clause, 'mode'));
  });
  return sites;
}

/** EventEmitter and lifecycle members: calling them in a listener sends nothing to Redis. */
const NOT_COMMANDS = new Set([
  'on',
  'once',
  'off',
  'emit',
  'addListener',
  'prependListener',
  'removeListener',
  'removeAllListeners',
  'listeners',
  'listenerCount',
  'setMaxListeners',
  'connect',
  'disconnect',
  'duplicate',
]);

const offlineQueueOff = (c: ClientConstruction) => {
  let off = false;
  walk(c.node, (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === 'enableOfflineQueue' &&
      unwrap(node.initializer).kind === ts.SyntaxKind.FalseKeyword
    )
      off = true;
  });
  return off;
};

/**
 * A `connect` listener that sends a command on its client, in a file that builds a client with
 * `enableOfflineQueue: false`: in ioredis 6 the command may reject because the RESP3 handshake
 * has not finished ("Stream isn't writeable and enableOfflineQueue options is false").
 */
export function connectListenerSites(text: string, file: string): SourceSite[] {
  if (!SOURCE.test(file) || !/enableOfflineQueue/.test(text)) return [];
  const source = parse(text);
  if (!clientConstructions(source).some(offlineQueueOff)) return [];
  const sites: SourceSite[] = [];
  walk(source, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    const method = node.expression.name.text;
    const [event, listener] = node.arguments;
    if (
      !(method === 'on' || method === 'once' || method === 'addListener') ||
      !event ||
      !ts.isStringLiteralLike(event) ||
      event.text !== 'connect' ||
      !listener ||
      !(ts.isArrowFunction(listener) || ts.isFunctionExpression(listener))
    )
      return;
    const receiver = node.expression.expression.getText(source);
    let sends = false;
    walk(listener.body, (inner) => {
      if (
        ts.isCallExpression(inner) &&
        ts.isPropertyAccessExpression(inner.expression) &&
        inner.expression.expression.getText(source) === receiver &&
        !NOT_COMMANDS.has(inner.expression.name.text)
      )
        sends = true;
    });
    if (sends) sites.push(site(source, node, 'connect'));
  });
  return sites;
}

const isCommandName = (node: ts.Expression) => {
  const value = unwrap(node);
  return (
    ts.isPropertyAccessExpression(value) &&
    value.name.text === 'name' &&
    /\bcommand\b/i.test(value.expression.getText())
  );
};
const AUTH = /^auth$/i;

/**
 * Code that recognizes the authentication command by name (`err.command.name === 'auth'`), to
 * redact or classify it. ioredis 6 authenticates with `HELLO 3 AUTH <user> <password>`, so the
 * credentials now travel as the arguments of a command named `hello` and slip past such checks.
 */
export function handshakeAuthSites(text: string, file: string): SourceSite[] {
  if (!SOURCE.test(file) || !/auth/i.test(text)) return [];
  const source = parse(text);
  const sites: SourceSite[] = [];
  walk(source, (node) => {
    if (ts.isBinaryExpression(node) && EQUALITY.has(node.operatorToken.kind)) {
      const [left, right] = [unwrap(node.left), unwrap(node.right)];
      if (
        (ts.isStringLiteralLike(right) && AUTH.test(right.text) && isCommandName(left)) ||
        (ts.isStringLiteralLike(left) && AUTH.test(left.text) && isCommandName(right))
      )
        sites.push(site(source, node, 'auth'));
    }
    if (ts.isSwitchStatement(node) && isCommandName(node.expression))
      for (const clause of node.caseBlock.clauses)
        if (
          ts.isCaseClause(clause) &&
          ts.isStringLiteralLike(clause.expression) &&
          AUTH.test(clause.expression.text)
        )
          sites.push(site(source, clause, 'auth'));
    // ['auth', ...].includes(err.command.name)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'includes' &&
      node.arguments[0] &&
      isCommandName(node.arguments[0])
    ) {
      const list = unwrap(node.expression.expression);
      if (
        ts.isArrayLiteralExpression(list) &&
        list.elements.some((e) => ts.isStringLiteralLike(e) && AUTH.test(e.text))
      )
        sites.push(site(source, node, 'auth'));
    }
  });
  return sites;
}
