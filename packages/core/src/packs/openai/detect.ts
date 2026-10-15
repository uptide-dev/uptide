import { ts } from 'ts-morph';
import type { SourceSite } from '../contract.js';
import {
  DEL_RESOURCES,
  NAMED_PATH_METHODS,
  type NamedPathMethod,
  REQUEST_OPTION_KEYS,
} from './paths.js';
import {
  chainOf,
  clientClasses,
  clientNames,
  endsWith,
  methodCalls,
  moduleReferences,
  OPENAI_MODULE,
  parse,
  rootIsClient,
  siteOf,
  unwrap,
  usesOpenai,
} from './syntax.js';

/**
 * Sites found in the source of a file that uses openai: the 4.x forms the migration guide names,
 * written so that a client typed `any` (or a JavaScript file) is seen as well as a typed one. Each
 * reads a property chain or an import, never a type, and only in a file that imports openai.
 */
type Detect = (text: string) => SourceSite[];

const guarded =
  (detect: (source: ts.SourceFile, text: string) => SourceSite[]): Detect =>
  (text) =>
    usesOpenai(text) ? detect(parse(text), text) : [];

/** Resources a client exposes that no other library is likely to share (after the root). */
export const SDK_RESOURCES = new Set([
  'beta',
  'chat',
  'responses',
  'vectorStores',
  'fineTuning',
  'evals',
  'containers',
  'conversations',
  'batches',
  'uploads',
  'realtime',
  'skills',
  'videos',
  'admin',
]);

/** Whether a receiver chain is an SDK resource: named distinctively, or rooted at a client. */
export function sdkChain(chain: readonly string[], clients: ReadonlySet<string>): boolean {
  const rootLength = chain[0] === 'this' ? 2 : 1;
  const resource = chain[rootLength];
  if (resource === undefined) return false;
  return SDK_RESOURCES.has(resource) || rootIsClient(chain, clients, chain.length - rootLength);
}

/**
 * `client.files.list({ headers })`: request options passed where 5.x reads params. Only a call
 * whose one argument is an object literal of request-option keys, on an SDK resource.
 */
export const requestOptionSites = guarded((source) => {
  const clients = clientNames(source);
  return methodCalls(source).flatMap(({ call, chain }) => {
    const only =
      call.arguments.length === 1 ? unwrap(call.arguments[0] as ts.Expression) : undefined;
    return only && optionsOnly(only, source) && sdkChain(chain, clients)
      ? [siteOf(source, only, 'RequestOptions')]
      : [];
  });
});

/** An object literal whose every key is a request option (and which has at least one). */
export function optionsOnly(node: ts.Expression, source: ts.SourceFile): boolean {
  return (
    ts.isObjectLiteralExpression(node) &&
    node.properties.length > 0 &&
    node.properties.every(
      (p) =>
        (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
        REQUEST_OPTION_KEYS.has(p.name.getText(source)),
    )
  );
}

/** The 4.x call a named-path method answers to, when `chain` is its resource on a root. */
export function namedPathMethod(
  chain: readonly string[],
  method: string,
): NamedPathMethod | undefined {
  return NAMED_PATH_METHODS.find(
    (m) => m.method === method && chain.length > m.resource.length && endsWith(chain, m.resource),
  );
}

/** Whether a call still has the 4.x positional shape: the id after the named ones is not params. */
export function positional(call: ts.CallExpression, entry: NamedPathMethod): boolean {
  const ids = entry.keys.length + 1;
  const needed = entry.after === 'body' ? ids + 1 : ids;
  if (call.arguments.length < needed) return false;
  return call.arguments
    .slice(0, ids)
    .every((a) => !ts.isObjectLiteralExpression(unwrap(a)) && !ts.isSpreadElement(a));
}

export const namedPathSites = guarded((source) =>
  methodCalls(source).flatMap(({ call, method, chain }) => {
    const entry = namedPathMethod(chain, method.text);
    return entry && positional(call, entry)
      ? [siteOf(source, method, `${entry.resource.join('.')}.${method.text}`)]
      : [];
  }),
);

/**
 * `.del(...)` on a 4.x resource with one path id. A chain that names the resource
 * (`client.beta.assistants.del`) is the SDK's; a bare `files.del` or `models.del` only when its
 * root holds a client, since other libraries name methods `del` too. Multi-id resources belong to
 * `named-path-params`.
 */
export const deleteMethodSites = guarded((source) => {
  const clients = clientNames(source);
  return methodCalls(source).flatMap(({ method, chain }) => {
    if (method.text !== 'del' || namedPathMethod(chain, 'del')) return [];
    const resource = delResource(chain, clients);
    return resource ? [siteOf(source, method, `${resource.join('.')}.del`)] : [];
  });
});

/** The 4.x resource a `.del` receiver chain names, when the chain alone says it is the SDK's. */
export function delResource(
  chain: readonly string[],
  clients: ReadonlySet<string>,
): readonly string[] | undefined {
  const resource = DEL_RESOURCES.find((r) => chain.length > r.length && endsWith(chain, r));
  if (!resource) return undefined;
  const named = resource.length > 1 || resource[0] === 'vectorStores';
  return named || rootIsClient(chain, clients, resource.length) ? resource : undefined;
}

const BETA_CHAT = new Set(['parse', 'stream', 'runTools']);

/** `X.beta.chat.completions.parse|stream|runTools`: the node `X.beta`. */
export function betaChatNodes(source: ts.SourceFile): ts.PropertyAccessExpression[] {
  const found: ts.PropertyAccessExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'beta' &&
      ts.isPropertyAccessExpression(node.parent) &&
      node.parent.name.text === 'chat' &&
      ts.isPropertyAccessExpression(node.parent.parent) &&
      node.parent.parent.name.text === 'completions' &&
      ts.isPropertyAccessExpression(node.parent.parent.parent) &&
      BETA_CHAT.has(node.parent.parent.parent.name.text)
    )
      found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

export const betaChatSites = guarded((source) =>
  betaChatNodes(source).map((node) => siteOf(source, node.name, 'beta.chat.completions')),
);

/** `.runFunctions(...)` on chat completions, beta or not. */
export const runFunctionsSites = guarded((source) =>
  methodCalls(source).flatMap(({ method, chain }) =>
    method.text === 'runFunctions' && endsWith(chain, ['chat', 'completions'])
      ? [siteOf(source, method, 'chat.completions.runFunctions')]
      : [],
  ),
);

export const RUNNER_RENAMES: Record<string, string> = {
  functionCall: 'functionToolCall',
  functionCallResult: 'functionToolCallResult',
  finalFunctionCall: 'finalFunctionToolCall',
  finalFunctionCallResult: 'finalFunctionToolCallResult',
};
const RUNNER_EVENT_METHODS = new Set(['on', 'once', 'off', 'emitted']);
const RUNNER_METHODS = new Set(['finalFunctionCall', 'finalFunctionCallResult']);

/** Runner event names in `.on('functionCall', …)` and the `finalFunctionCall()` methods. */
export function runnerNodes(source: ts.SourceFile): (ts.StringLiteralLike | ts.Identifier)[] {
  return methodCalls(source).flatMap(
    ({ call, method }): (ts.StringLiteralLike | ts.Identifier)[] => {
      if (RUNNER_METHODS.has(method.text) && call.arguments.length === 0) return [method];
      const first = call.arguments[0];
      return RUNNER_EVENT_METHODS.has(method.text) &&
        first &&
        ts.isStringLiteralLike(first) &&
        RUNNER_RENAMES[first.text] !== undefined
        ? [first]
        : [];
    },
  );
}

export const runnerSites = guarded((source) =>
  runnerNodes(source).map((node) => siteOf(source, node, node.text)),
);

/** `page.nextPageParams()` / `page.nextPageInfo()`: gone, `nextPageRequestOptions()` replaces both. */
export const pageHelperSites = guarded((source) =>
  methodCalls(source).flatMap(({ method }) =>
    method.text === 'nextPageParams' || method.text === 'nextPageInfo'
      ? [siteOf(source, method, method.text)]
      : [],
  ),
);

/** `fileFromPath` imported from openai, or read off the client class (`OpenAI.fileFromPath`). */
export const fileFromPathSites = guarded((source) => {
  const { classes, namespaces } = clientClasses(source);
  const fromOpenai = (node: ts.Node): boolean => {
    let current: ts.Node | undefined = node;
    while (current && !ts.isImportDeclaration(current) && !ts.isVariableDeclaration(current))
      current = current.parent;
    if (current && ts.isImportDeclaration(current))
      return (
        ts.isStringLiteral(current.moduleSpecifier) &&
        OPENAI_MODULE.test(current.moduleSpecifier.text)
      );
    const init = current?.initializer && unwrap(current.initializer);
    return (
      !!init &&
      ts.isCallExpression(init) &&
      ts.isStringLiteralLike(init.arguments[0] as ts.Expression) &&
      OPENAI_MODULE.test((init.arguments[0] as ts.StringLiteralLike).text)
    );
  };
  const sites: SourceSite[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === 'fileFromPath') {
      const parent = node.parent;
      const imported =
        (ts.isImportSpecifier(parent) || ts.isBindingElement(parent)) &&
        (parent.propertyName ?? parent.name) === node &&
        fromOpenai(parent);
      const owner =
        ts.isPropertyAccessExpression(parent) && parent.name === node
          ? chainOf(parent.expression)
          : undefined;
      const member =
        owner !== undefined &&
        (owner.length === 1
          ? classes.has(owner[0] as string) || namespaces.has(owner[0] as string)
          : owner.length === 2 && namespaces.has(owner[0] as string));
      if (imported || member) sites.push(siteOf(source, node, 'fileFromPath'));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
});

/** Entry points 5.x removed: `openai/shims/*`, `openai/_shims/*`, `openai/src`, `openai/core`, beta chat types. */
export const REMOVED_MODULE =
  /^openai\/(?:_?shims(?:\/.*)?|src(?:\/.*)?|core|resources\/beta\/chat(?:\/completions(?:\/index)?|\/index)?(?:\.js)?)$/;

export const removedModuleSites = guarded((source) =>
  moduleReferences(source)
    .filter((m) => REMOVED_MODULE.test(m.specifier))
    .map((m) => siteOf(source, m.node, m.specifier)),
);

/** Public files 5.x moved under `core/`; the old paths still re-export them, deprecated. */
export const CORE_MOVED = /^openai\/(error|pagination|resource|streaming|uploads)(?:\.js|\.mjs)?$/;

export const corePathSites = guarded((source) =>
  moduleReferences(source)
    .filter((m) => CORE_MOVED.test(m.specifier))
    .map((m) => siteOf(source, m.node, m.specifier)),
);
