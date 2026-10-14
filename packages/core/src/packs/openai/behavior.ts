import { ts } from 'ts-morph';
import { parse as parseYaml } from 'yaml';
import { minVersion, satisfies } from '../../fetch/range.js';
import type { BehaviorNote, SourceSite } from '../contract.js';
import type { PackContext } from '../types.js';
import { sdkChain } from './detect.js';
import {
  chainOf,
  clientClasses,
  clientNames,
  methodCalls,
  moduleReferences,
  parse,
  siteOf,
  unwrap,
  usesOpenai,
} from './syntax.js';

const guide = 'https://github.com/openai/openai-node/blob/v7.32.0/MIGRATION.md';
const SOURCE = /\.[cm]?[jt]sx?$/;
const files = (context: PackContext) => context.inventory ?? [];
const sources = (context: PackContext) =>
  files(context).filter((f) => SOURCE.test(f.file) && usesOpenai(f.text));
const packages = (context: PackContext) =>
  files(context).flatMap((f) => {
    if (!/(?:^|\/)package\.json$/.test(f.file)) return [];
    try {
      return [{ file: f.file, json: JSON.parse(f.text) as Record<string, Record<string, string>> }];
    } catch {
      return [];
    }
  });
const declared = (pkg: Record<string, Record<string, string>>, name: string) =>
  pkg.dependencies?.[name] ?? pkg.devDependencies?.[name] ?? pkg.peerDependencies?.[name];

/**
 * `catch (e) { e.headers['retry-after'] }`: 4.x typed `APIError.headers` as a record, 5.x as a Web
 * `Headers`, whose index access is `undefined`. A catch binding is `any` or `unknown`, so the
 * compiler only sees this once the error is narrowed and the code is strict; flag it either way.
 */
function errorHeaderSites(text: string): SourceSite[] {
  if (!usesOpenai(text)) return [];
  const source = parse(text);
  const sites: SourceSite[] = [];
  const visit = (node: ts.Node, bindings: ReadonlySet<string>): void => {
    let inner = bindings;
    if (
      ts.isCatchClause(node) &&
      node.variableDeclaration &&
      ts.isIdentifier(node.variableDeclaration.name)
    )
      inner = new Set([...bindings, node.variableDeclaration.name.text]);
    if (ts.isElementAccessExpression(node)) {
      const headers = unwrap(node.expression);
      if (ts.isPropertyAccessExpression(headers) && headers.name.text === 'headers') {
        const owner = chainOf(headers.expression);
        if (owner?.length === 1 && inner.has(owner[0] as string))
          sites.push(siteOf(source, headers.name, 'APIError#headers'));
      }
    }
    ts.forEachChild(node, (child) => visit(child, inner));
  };
  visit(source, new Set());
  return sites;
}

const NODE_FETCH_MEMBERS: Record<string, readonly string[]> = {
  body: ['pipe', 'on', 'read', 'setEncoding'],
  headers: ['raw'],
};

/**
 * `.asResponse()` and `.withResponse()` return the runtime's `Response` in 5.x, not node-fetch's:
 * `res.body.pipe(...)`, `res.headers.raw()` and `res.buffer()` are gone (MIGRATION.md, "Web types
 * for withResponse, asResponse"). Found from the names bound to those calls in the same file.
 */
function webResponseSites(text: string): SourceSite[] {
  if (!usesOpenai(text)) return [];
  const source = parse(text);
  const bound = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      let value = unwrap(node.initializer);
      if (ts.isAwaitExpression(value)) value = unwrap(value.expression);
      if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression)) {
        const method = value.expression.name.text;
        if (method === 'asResponse' && ts.isIdentifier(node.name)) bound.add(node.name.text);
        if (method === 'withResponse' && ts.isObjectBindingPattern(node.name))
          for (const element of node.name.elements)
            if (
              (element.propertyName ?? element.name).getText(source) === 'response' &&
              ts.isIdentifier(element.name)
            )
              bound.add(element.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!bound.size) return [];
  return methodCalls(source).flatMap(({ method, chain }) => {
    if (chain.length === 1 && bound.has(chain[0] as string) && method.text === 'buffer')
      return [siteOf(source, method, 'Response#buffer')];
    const member = chain[1];
    return chain.length === 2 &&
      bound.has(chain[0] as string) &&
      member !== undefined &&
      NODE_FETCH_MEMBERS[member]?.includes(method.text)
      ? [siteOf(source, method, `Response#${member}.${method.text}`)]
      : [];
  });
}

/**
 * `client.files.retrieve(encodeURIComponent(id))`: 5.x encodes path parameters itself, so an id
 * the code encodes first is sent encoded twice (MIGRATION.md, "URI encoded path parameters").
 */
function encodedPathSites(text: string): SourceSite[] {
  if (!usesOpenai(text)) return [];
  const source = parse(text);
  const clients = clientNames(source);
  return methodCalls(source).flatMap(({ call, chain }) => {
    if (!sdkChain(chain, clients)) return [];
    return call.arguments.flatMap((argument) => {
      const value = unwrap(argument);
      return ts.isCallExpression(value) &&
        ts.isIdentifier(value.expression) &&
        value.expression.text === 'encodeURIComponent'
        ? [siteOf(source, value, 'encodeURIComponent')]
        : [];
    });
  });
}

/** Node 22 and TypeScript 4.9 are the floor of openai 7 (MIGRATION.md, "Environment requirements"). */
function platformEvidence(context: PackContext): string | false {
  const found: Record<'Node' | 'TypeScript', { where: string; version: string }[]> = {
    Node: [],
    TypeScript: [],
  };
  for (const { file, json } of packages(context)) {
    const engines = (json.engines as Record<string, string> | undefined)?.node;
    if (engines) found.Node.push({ where: `\`${file}\` engines.node`, version: engines });
    const typescript = declared(json, 'typescript');
    if (typescript) found.TypeScript.push({ where: `\`${file}\` TypeScript`, version: typescript });
  }
  for (const { file, text } of files(context)) {
    if (/(?:^|\/)(?:\.nvmrc|\.node-version)$/.test(file))
      found.Node.push({ where: `\`${file}\``, version: text.trim() });
    else if (/\.github\/workflows\/.*\.ya?ml$/.test(file))
      try {
        for (const job of Object.values(parseYaml(text)?.jobs ?? {}) as {
          steps?: { with?: Record<string, unknown> }[];
          strategy?: { matrix?: Record<string, unknown> };
        }[])
          for (const step of job.steps ?? []) {
            const value = step.with?.['node-version'];
            if (value === undefined) continue;
            const matrix = /^\$\{\{\s*matrix\.([\w-]+)\s*\}\}$/.exec(String(value));
            const versions = matrix ? job.strategy?.matrix?.[matrix[1] as string] : value;
            for (const version of Array.isArray(versions) ? versions : [versions])
              if (version !== undefined)
                found.Node.push({ where: `\`${file}\` node-version`, version: String(version) });
          }
      } catch {
        /* An unreadable workflow is reported as no evidence below. */
      }
  }
  const issues = (['Node', 'TypeScript'] as const).flatMap((kind) => {
    const minimum = kind === 'Node' ? '22.0.0' : '4.9.0';
    const readable = found[kind]
      .map((hit) => ({ ...hit, low: minVersion(hit.version.replace(/^v(?=\d)/, '')) }))
      .filter((hit) => hit.low);
    const below = readable.filter((hit) => !satisfies(hit.low as string, `>=${minimum}`));
    if (below.length)
      return below.map(
        (hit) => `${hit.where} ${JSON.stringify(hit.version)} permits ${kind} below ${minimum}`,
      );
    return readable.length
      ? []
      : [`no ${kind} version is declared; openai 7 needs ${kind} >=${minimum}`];
  });
  return issues.length
    ? `${issues.join('; ')}: openai 7 requires Node.js 22 and TypeScript 4.9; move CI, runtime pins and engines before deploying.`
    : false;
}

/** Files that import the zod helpers, and a declared zod below openai 6's `^3.25 || ^4.0` peer. */
function zodEvidence(context: PackContext): string | false {
  const helpers = sources(context)
    .filter((f) =>
      moduleReferences(parse(f.text)).some((m) => m.specifier === 'openai/helpers/zod'),
    )
    .map((f) => `\`${f.file}\``);
  const low = packages(context).flatMap(({ file, json }) => {
    const range = declared(json, 'zod');
    const least = range && minVersion(range);
    return least && !satisfies(least, '^3.25.0 || ^4.0.0')
      ? [
          `\`${file}\` declares zod ${JSON.stringify(range)}, below the openai 7 peer range ^3.25 || ^4.0`,
        ]
      : [];
  });
  const parts = [
    ...low,
    ...(helpers.length
      ? [
          `${helpers.join(', ')} use openai/helpers/zod: a property that is \`.optional()\` without \`.nullable()\` now throws instead of warning (structured outputs require every field)`,
        ]
      : []),
  ];
  return parts.length
    ? `${parts.join('; ')}. Decide per schema; do not loosen the schema to make it pass.`
    : false;
}

const AGENTS = [
  'https-proxy-agent',
  'http-proxy-agent',
  'socks-proxy-agent',
  'proxy-agent',
  'agentkeepalive',
  'node-fetch',
];

/** Proxy and agent packages, and `httpAgent` in files that use openai: 5.x fetches with the runtime's fetch. */
function fetchEvidence(context: PackContext): string | false {
  const deps = packages(context).flatMap(({ file, json }) =>
    AGENTS.filter((name) => declared(json, name)).map((name) => `\`${file}\` depends on ${name}`),
  );
  const options = sources(context)
    .filter((f) => /\bhttpAgent\b|\bsetGlobalDispatcher\b/.test(f.text))
    .map((f) => `\`${f.file}\` configures an HTTP agent or global dispatcher`);
  const found = [...deps, ...options];
  return found.length
    ? `${found.join('; ')}: openai 5+ sends requests with the runtime's built-in fetch, so \`httpAgent\` is gone (use \`fetchOptions\`, e.g. an undici \`ProxyAgent\` as \`dispatcher\`) and a global undici dispatcher now applies to OpenAI traffic. Confirm proxies, timeouts and keep-alive still behave.`
    : false;
}

/** tsconfig `lib` without DOM and `@types/node` older than 20: the SDK's fetch types do not resolve. */
function globalTypesEvidence(context: PackContext): string | false {
  const hits: string[] = [];
  const nodeTypes = packages(context)
    .map(({ json }) => declared(json, '@types/node'))
    .find(Boolean);
  const nodeTypesOk = nodeTypes ? satisfies(minVersion(nodeTypes) ?? '0.0.0', '>=20.0.0') : false;
  for (const { file, text } of files(context)) {
    if (!/(?:^|\/)tsconfig[^/]*\.json$/.test(file)) continue;
    const config = ts.parseConfigFileTextToJson(file, text).config as
      | { compilerOptions?: { lib?: string[] } }
      | undefined;
    const lib = config?.compilerOptions?.lib;
    if (lib && !lib.some((l) => /^dom$/i.test(l)) && !nodeTypesOk)
      hits.push(
        `\`${file}\` sets lib ${JSON.stringify(lib)} without DOM and @types/node is ${nodeTypes ? JSON.stringify(nodeTypes) : 'not declared'}`,
      );
  }
  return hits.length
    ? `${hits.join('; ')}: openai 5 types use the global fetch classes (Request, Response, Headers); add DOM to lib or @types/node >= 20 (MIGRATION.md, "TypeScript troubleshooting").`
    : false;
}

/** `class X extends OpenAI`: `withOptions()` builds the copy from client options alone. */
function subclassEvidence(context: PackContext): string | false {
  const hits = sources(context).flatMap((f) => {
    const source = parse(f.text);
    const { classes } = clientClasses(source);
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node))
        for (const clause of node.heritageClauses ?? [])
          for (const type of clause.types)
            if (ts.isIdentifier(type.expression) && classes.has(type.expression.text))
              found.push(`\`${f.file}\` extends ${type.expression.text}`);
      ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
  });
  return hits.length
    ? `${hits.join('; ')}: openai 5+ clones clients with \`withOptions()\` (and calls the subclass constructor with client options only), so a constructor that takes other arguments first, or state set outside the options, is lost on a copy. Review the subclass before relying on copies.`
    : false;
}

const note = (
  id: string,
  summary: string,
  applies: (context: PackContext) => string | false,
): BehaviorNote => ({ id, summary, reported: ['decision'], applies });

export const openaiBehavior: BehaviorNote[] = [
  {
    id: 'error-headers',
    summary:
      '`APIError.headers` is a Web `Headers` in openai 5: `error.headers[name]` is undefined; read `error.headers.get(name)`',
    reported: ['finding'],
    severity: 'breaking',
    detect: errorHeaderSites,
  },
  {
    id: 'web-response',
    summary:
      '`asResponse()`/`withResponse()` return a Web `Response` in openai 5: node-fetch members (`body.pipe`, `headers.raw()`, `buffer()`) are gone',
    reported: ['finding'],
    severity: 'breaking',
    detect: webResponseSites,
  },
  {
    id: 'encoded-path-params',
    summary:
      'openai 5 URI-encodes path parameters itself: an id passed through `encodeURIComponent` is encoded twice',
    reported: ['finding'],
    severity: 'breaking',
    detect: encodedPathSites,
  },
  note('platform-minimums', 'openai 7 requires Node.js 22 and TypeScript 4.9.', platformEvidence),
  note(
    'zod-helpers',
    'openai/helpers/zod now throws on optional-only fields, and openai 7 peers on zod ^3.25 || ^4.0.',
    zodEvidence,
  ),
  note(
    'builtin-fetch',
    'openai 5+ uses the built-in fetch: `httpAgent` is gone and a global undici dispatcher applies.',
    fetchEvidence,
  ),
  note(
    'global-types',
    'openai 5 types need the global fetch classes: DOM in lib or @types/node >= 20.',
    globalTypesEvidence,
  ),
  note(
    'client-subclass',
    'openai 5+ copies clients with `withOptions()`, calling the class with client options only.',
    subclassEvidence,
  ),
  {
    id: 'also-review',
    summary: `Also review the [openai migration guide](${guide}) for the 5.0 changes the compiler cannot see in this repository (pagination internals, CommonJS resource classes), and the 6.0 and 7.0 changelog entries.`,
    reported: ['decision'],
  },
];
