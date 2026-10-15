import { ts } from 'ts-morph';
import type { Finding } from '../../domain/report.js';
import type { TransformResult } from '../types.js';
import {
  betaChatNodes,
  CORE_MOVED,
  delResource,
  namedPathMethod,
  optionsOnly,
  positional,
  REMOVED_MODULE,
  RUNNER_RENAMES,
  runnerNodes,
} from './detect.js';
import { type NamedPathMethod, REQUEST_OPTION_KEYS } from './paths.js';
import {
  clientNames,
  inert,
  methodCalls,
  moduleReferences,
  parse,
  position,
  unwrap,
} from './syntax.js';

/**
 * The deterministic edits. Each finds its construct on the reported line from the file's syntax,
 * edits that construct and nothing else, and declines (with a reason) whenever more than one
 * reading is possible: the agent then gets the rule's guide instead.
 */
const declined = (text: string, reason: string): TransformResult => ({
  text,
  applied: false,
  reason,
});
const splice = (text: string, start: number, end: number, insert: string) =>
  text.slice(0, start) + insert + text.slice(end);

/**
 * The node of `nodes` on the finding's line. When several are, the last that starts at or before
 * the reported column: the compiler reports `client.beta.chat` at `chat`, after `beta`.
 */
function onLine<T extends ts.Node>(
  source: ts.SourceFile,
  nodes: T[],
  finding: Finding,
): T | undefined {
  const here = nodes.filter((n) => position(source, n).line === finding.usage.line);
  if (here.length <= 1) return here[0];
  return here.filter((n) => position(source, n).column <= finding.usage.column).at(-1);
}

/** `client.beta.chat.completions.parse(…)` → `client.chat.completions.parse(…)`: the same methods, promoted. */
export function promoteBetaChat(text: string, finding: Finding): TransformResult {
  const source = parse(text);
  const node = onLine(
    source,
    betaChatNodes(source).map((n) => n.name),
    finding,
  )?.parent as ts.PropertyAccessExpression | undefined;
  if (!node) return declined(text, 'no `beta.chat.completions` call on the reported line');
  if (node.questionDotToken)
    return declined(text, '`?.beta` would lose its optional chaining; edit by hand');
  return {
    text: splice(text, node.expression.getEnd(), node.getEnd(), ''),
    applied: true,
    reason: '`beta.chat.completions` is `chat.completions` in openai 5',
  };
}

/** Old arguments → new: the last id stays first, the others become params named as in 7.x. */
function reshape(
  text: string,
  call: ts.CallExpression,
  entry: NamedPathMethod,
  source: ts.SourceFile,
): string | { reason: string } {
  const args = call.arguments;
  const ids = entry.keys.length + 1;
  const named = args.slice(0, entry.keys.length);
  const last = args[entry.keys.length] as ts.Expression;
  if (![...named, last].every(inert))
    return { reason: 'path arguments with side effects would change evaluation order' };
  const pairs = named.map((a, i) => {
    const key = entry.keys[i] as string;
    const value = a.getText(source);
    return value === key ? key : `${key}: ${value}`;
  });
  let params: string;
  let rest: readonly ts.Expression[];
  const extra = args[ids];
  if (entry.after === 'body' || (entry.after === 'query' && extra && queryNotOptions(extra))) {
    const body = extra && unwrap(extra);
    if (!body) return { reason: 'the request body is missing' };
    if (ts.isObjectLiteralExpression(body)) {
      if (body.properties.some((p) => p.name && entry.keys.includes(p.name.getText(source))))
        return { reason: 'the params already name a path id' };
      params = mergeInto(body, pairs, source);
    } else if (inert(body)) params = `{ ${[...pairs, `...${body.getText(source)}`].join(', ')} }`;
    else return { reason: 'the request body is an expression that would be evaluated earlier' };
    rest = args.slice(ids + 1);
  } else if (entry.after === 'query' && extra) {
    return { reason: 'the third argument could be a query or request options' };
  } else {
    params = `{ ${pairs.join(', ')} }`;
    rest = args.slice(ids);
  }
  // Keep the call's own layout: one argument per line stays one per line.
  const separator = source.text.slice(
    (args[0] as ts.Expression).getEnd(),
    (args[1] as ts.Expression).getStart(source),
  );
  const list = [last.getText(source), params, ...rest.map((a) => a.getText(source))].join(
    separator.includes('\n') ? separator : ', ',
  );
  const start = (args[0] as ts.Expression).getStart(source);
  const end = (args[args.length - 1] as ts.Expression).getEnd();
  return splice(text, start, end, list);
}

/** An object literal of query keys only, none of which request options also have. */
function queryNotOptions(node: ts.Expression): boolean {
  const value = unwrap(node);
  return (
    ts.isObjectLiteralExpression(value) &&
    value.properties.every(
      (p) =>
        (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
        !REQUEST_OPTION_KEYS.has(p.name.getText()) &&
        p.name.getText() !== 'query',
    )
  );
}

/** `{ tool_outputs }` + `thread_id: id` → `{ thread_id: id, tool_outputs }`, keeping its layout. */
function mergeInto(
  body: ts.ObjectLiteralExpression,
  pairs: string[],
  source: ts.SourceFile,
): string {
  const original = body.getText(source);
  const first = body.properties[0];
  if (!first) return `{ ${pairs.join(', ')} }`;
  const open = body.getStart(source) + 1;
  const between = source.text.slice(open, first.getStart(source));
  const newline = between.lastIndexOf('\n');
  if (newline < 0) return `{ ${pairs.join(', ')}, ${original.slice(1).trimStart()}`;
  const indent = between.slice(newline + 1);
  return `{${pairs.map((p) => `\n${indent}${p},`).join('')}${original.slice(1)}`;
}

function rewriteNamedPath(
  text: string,
  finding: Finding,
  options: { delOnly?: boolean } = {},
): TransformResult {
  const source = parse(text);
  const candidates = methodCalls(source).filter(({ call, method, chain }) => {
    const entry = namedPathMethod(chain, method.text);
    if (!entry || (options.delOnly && method.text !== 'del')) return false;
    const start = position(source, call).line;
    const end = source.getLineAndCharacterOfPosition(call.getEnd()).line + 1;
    return start <= finding.usage.line && finding.usage.line <= end && positional(call, entry);
  });
  const onTheLine = candidates.filter(
    ({ method }) => position(source, method).line === finding.usage.line,
  );
  const picked =
    onTheLine.length === 1 ? onTheLine[0] : candidates.length === 1 ? candidates[0] : undefined;
  if (!picked)
    return declined(text, 'no single positional path-parameter call at the reported site');
  const entry = namedPathMethod(picked.chain, picked.method.text) as NamedPathMethod;
  const reshaped = reshape(text, picked.call, entry, source);
  if (typeof reshaped !== 'string') return declined(text, reshaped.reason);
  // The method name precedes the arguments, so renaming it after reshaping keeps offsets valid.
  const renamed =
    picked.method.text === 'del'
      ? splice(reshaped, picked.method.getStart(source), picked.method.getEnd(), 'delete')
      : reshaped;
  return {
    text: renamed,
    applied: true,
    reason: `${entry.resource.join('.')}.${picked.method.text === 'del' ? 'delete' : picked.method.text} takes ${entry.keys.map((k) => `\`${k}\``).join(' and ')} as named params`,
  };
}

export const rewriteNamedPathParams = (text: string, finding: Finding) =>
  rewriteNamedPath(text, finding);

/** What the compiler says when a 4.x resource's `del` is gone (the resource classes of 7.x). */
export const SDK_DEL =
  /Property 'del' does not exist on type '(?:Files|Models|Completions|VectorStores|Assistants|Threads|Messages|Permissions|Responses|Evals|Runs|Containers)'/;

/** `.del(id)` → `.delete(id)`; a resource with several path ids is reshaped as well. */
export function renameDel(text: string, finding: Finding): TransformResult {
  const source = parse(text);
  const calls = methodCalls(source).filter(({ method }) => method.text === 'del');
  const picked = onLine(
    source,
    calls.map((c) => c.method),
    finding,
  );
  if (!picked) return declined(text, 'no `.del(` call on the reported line');
  const call = calls.find((c) => c.method === picked) as (typeof calls)[number];
  if (namedPathMethod(call.chain, 'del')) return rewriteNamedPath(text, finding, { delOnly: true });
  // The compiler (or the type diff) saying an SDK resource lost `del` vouches for the receiver;
  // otherwise the chain must, as it does for detection. Two ids through an unnamed receiver
  // could be a resource whose ids also became named: that one is the agent's.
  const vouched =
    SDK_DEL.test(finding.usage.compileError ?? '') || /#del$/.test(finding.change.path);
  if (!vouched && !delResource(call.chain, clientNames(source)))
    return declined(text, 'the receiver is not known to be an openai resource');
  const second = call.call.arguments[1];
  if (vouched && second && !ts.isObjectLiteralExpression(unwrap(second)))
    return declined(text, 'two ids on an unnamed resource: its ids may have become named params');
  return {
    text: splice(text, picked.getStart(source), picked.getEnd(), 'delete'),
    applied: true,
    reason: '`del` is `delete` in openai 5',
  };
}

/** `'functionCall'` → `'functionToolCall'`, `finalFunctionCall()` → `finalFunctionToolCall()`. */
export function renameRunner(text: string, finding: Finding): TransformResult {
  const source = parse(text);
  const node = onLine(source, runnerNodes(source), finding);
  if (!node) return declined(text, 'no runner event or method of 4.x on the reported line');
  const name = RUNNER_RENAMES[node.text] as string;
  if (ts.isIdentifier(node))
    return {
      text: splice(text, node.getStart(source), node.getEnd(), name),
      applied: true,
      reason: `\`${node.text}()\` is \`${name}()\``,
    };
  const start = node.getStart(source) + 1;
  return {
    text: splice(text, start, start + node.text.length, name),
    applied: true,
    reason: `the \`${node.text}\` event is \`${name}\``,
  };
}

/** Exports of `openai/resources/beta/chat/completions` that 7.x has at the non-beta path. */
const BETA_CHAT_TYPES = new Set([
  'ParsedFunction',
  'ParsedFunctionToolCall',
  'ParsedChatCompletionMessage',
  'ParsedChoice',
  'ParsedChatCompletion',
  'ChatCompletionParseParams',
  'ChatCompletionStream',
  'ChatCompletionStreamParams',
  'ChatCompletionRunner',
  'ChatCompletionStreamingRunner',
  'ChatCompletionToolRunnerParams',
  'ChatCompletionStreamingToolRunnerParams',
  'ParsingToolFunction',
  'RunnableFunctionWithParse',
  'RunnableFunctionWithoutParse',
  'Completions',
]);

function importedNames(statement: ts.Node): string[] | undefined {
  if (!ts.isImportDeclaration(statement)) return undefined;
  const clause = statement.importClause;
  if (!clause || clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings))
    return undefined;
  return clause.namedBindings.elements.map((e) => (e.propertyName ?? e.name).text);
}

/**
 * Entry points 5.x removed. A side-effect `import 'openai/shims/node'` goes (the global fetch is
 * the only implementation now); named imports of the beta chat types move to
 * `openai/resources/chat/completions` when every name exists there; `openai/src` is `openai`.
 * Anything else is the agent's, from the guide.
 */
export function rewriteRemovedModule(text: string, finding: Finding): TransformResult {
  const source = parse(text);
  const references = moduleReferences(source).filter((m) => REMOVED_MODULE.test(m.specifier));
  const reference = onLine(
    source,
    references.map((m) => m.node),
    finding,
  );
  const found = references.find((m) => m.node === reference);
  if (!found) return declined(text, 'no removed openai entry point on the reported line');
  const { specifier, node, statement } = found;
  const quoted = (value: string) =>
    `${text[node.getStart(source)]}${value}${text[node.getStart(source)]}`;
  if (/^openai\/shims\//.test(specifier)) {
    const parent = statement.parent;
    const sideEffect =
      (ts.isImportDeclaration(statement) && !statement.importClause) ||
      (ts.isCallExpression(statement) && ts.isExpressionStatement(parent));
    const whole = ts.isImportDeclaration(statement) ? statement : parent;
    // The statement must be alone on its line (a trailing comment goes with it).
    const lines = text.split('\n');
    const { line: at, column } = position(source, whole);
    const end = source.getLineAndCharacterOfPosition(whole.getEnd());
    const line = lines[at - 1] ?? '';
    const prefix = line.slice(0, column - 1).trim();
    const rest = line.slice(end.character).trim();
    if (!sideEffect || end.line + 1 !== at || prefix || (rest && !rest.startsWith('//')))
      return declined(
        text,
        'a shims import that binds names, or shares its line, needs a hand edit',
      );
    lines.splice(at - 1, 1);
    return {
      text: lines.join('\n'),
      applied: true,
      reason: `\`${specifier}\` is gone: openai 5 uses the runtime's own fetch`,
    };
  }
  if (/^openai\/resources\/beta\/chat/.test(specifier)) {
    const names = importedNames(statement);
    if (!names?.length || !names.every((n) => BETA_CHAT_TYPES.has(n)))
      return declined(
        text,
        'some imported names are gone with the beta namespace (runFunctions types)',
      );
    return {
      text: splice(
        text,
        node.getStart(source),
        node.getEnd(),
        quoted('openai/resources/chat/completions'),
      ),
      applied: true,
      reason: 'the parse/stream/runner types are in `openai/resources/chat/completions`',
    };
  }
  if (specifier === 'openai/src' || specifier === 'openai/src/index')
    return {
      text: splice(text, node.getStart(source), node.getEnd(), quoted('openai')),
      applied: true,
      reason: '`openai/src` is `openai`',
    };
  return declined(text, `\`${specifier}\` has no one-to-one replacement; see the guide`);
}

/** `openai/error` → `openai/core/error` (and pagination, resource, streaming, uploads). */
export function rewriteCorePath(text: string, finding: Finding): TransformResult {
  const source = parse(text);
  const references = moduleReferences(source).filter((m) => CORE_MOVED.test(m.specifier));
  const node = onLine(
    source,
    references.map((m) => m.node),
    finding,
  );
  const moved = node && CORE_MOVED.exec(node.text);
  if (!node || !moved) return declined(text, 'no moved openai path on the reported line');
  const quote = text[node.getStart(source)];
  return {
    text: splice(
      text,
      node.getStart(source),
      node.getEnd(),
      `${quote}openai/core/${moved[1]}${quote}`,
    ),
    applied: true,
    reason: `\`${node.text}\` is \`openai/core/${moved[1]}\``,
  };
}

/** `list({ headers })` → `list({}, { headers })`: request options are the second argument now. */
export function separateRequestOptions(text: string, finding: Finding): TransformResult {
  const source = parse(text);
  const calls = methodCalls(source).filter(({ call }) => {
    const only =
      call.arguments.length === 1 ? unwrap(call.arguments[0] as ts.Expression) : undefined;
    return only !== undefined && optionsOnly(only, source);
  });
  const picked = onLine(
    source,
    calls.map((c) => c.call.arguments[0] as ts.Expression),
    finding,
  );
  if (!picked) return declined(text, 'no call passing only request options on the reported line');
  const start = picked.getStart(source);
  return {
    text: splice(text, start, start, '{}, '),
    applied: true,
    reason: 'request options are the second argument; the params are `{}`',
  };
}
