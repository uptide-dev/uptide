import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding } from '../../domain/report.js';
import { definePack } from '../contract.js';
import { expressBehavior } from './behavior.js';
import {
  paramCallbackSites,
  paramDestructureSites,
  redirectOrderSites,
  routeSites,
} from './detect.js';

const PARAMS_ERROR = /'string \| string\[\]' is not assignable/;

/**
 * A `req.params` error is reported where the value is used, but the guide's fix is one edit
 * above it where the value is destructured (`const { id } = req.params`). That line is a site
 * too (UPT-91), found only where the compiler reported an error under it.
 */
function paramDestructure({
  root,
  workspace,
  findings,
}: Parameters<NonNullable<Parameters<typeof definePack>[0]['foldFindings']>>[0]): Finding[] {
  const errors = new Map<string, Finding[]>();
  for (const f of findings)
    if (f.usage.compileError && PARAMS_ERROR.test(f.usage.compileError))
      errors.set(f.usage.file, [...(errors.get(f.usage.file) ?? []), f]);
  const anchors: Finding[] = [];
  for (const [file, list] of errors) {
    let text: string;
    try {
      text = readFileSync(join(root, workspace, file), 'utf8');
    } catch {
      continue;
    }
    const first = list[0] as Finding;
    const taken = new Set(findings.filter((f) => f.usage.file === file).map((f) => f.usage.line));
    for (const site of paramDestructureSites(
      text,
      list.map((f) => ({ line: f.usage.line, column: f.usage.column })),
    )) {
      if (taken.has(site.line)) continue;
      const { compileError: _error, compileCode: _code, ...usage } = first.usage;
      anchors.push({
        ...first,
        rule: 'params-string-array',
        usage: {
          ...usage,
          line: site.line,
          column: site.column,
          endLine: site.line,
          endColumn: site.column,
          snippet: site.snippet,
        },
        reason: 'the destructuring that gives the compiler-reported req.params values their type',
      });
    }
  }
  return [...findings, ...anchors];
}

const guide =
  'https://github.com/expressjs/expressjs.com/blob/472119366bbffc206e0deba32277d607cf9f6e13/src/content/pages/en/guide/migrating-5.mdx';
const history =
  'https://github.com/expressjs/express/blob/cf6722bf89a86905281d9160b6482e08166b5ef0/History.md';

/**
 * express >=4 <5 → >=5 <6. Sources pinned (guide at expressjs.com 4721193, History.md at
 * v5.3.0, path-to-regexp v8.4.2, codemods at expressjs/codemod 2f7f1e5) and read 2026-10-14;
 * every change, its class and its evidence are in RESEARCH.md. The compiler sees the type changes
 * of @types/express 5 (`req.params` values widen to `string | string[]`, removed `req.param`,
 * `res.sendfile`, `express.static.mime`, `express.query`); route strings and most runtime
 * defaults it cannot see. No rule rewrites: every codemod transform that would is either unsafe
 * whatever the surrounding code, or never met a real site in the ground truth (RESEARCH.md).
 */
export const expressPack = definePack({
  meta: {
    package: 'express',
    from: '>=4 <5',
    to: '>=5 <6',
    sources: [
      { title: 'Migrating to Express 5 (expressjs.com 4721193, read 2026-10-14)', url: guide },
      { title: 'Express History.md, 5.0.0 to 5.3.0 (v5.3.0, read 2026-10-14)', url: history },
      {
        title: 'path-to-regexp 8 errors and syntax (v8.4.2, read 2026-10-14)',
        url: 'https://github.com/pillarjs/path-to-regexp/blob/cbf30259e6d34d6135f9e7dbaa3371e7188f9936/Readme.md',
      },
      {
        title: 'Express codemods, read not run (expressjs/codemod 2f7f1e5, read 2026-10-14)',
        url: 'https://github.com/expressjs/codemod/tree/2f7f1e5f31ebab6e840957b0cf171a014ad7a3b9/codemods',
      },
      {
        title: 'body-parser 2 changes (HISTORY.md at 2.3.0, read 2026-10-14)',
        url: 'https://github.com/expressjs/body-parser/blob/d0f2ace6c74769da7d19b8661b9a01c01bdb0bf7/HISTORY.md',
      },
      {
        title:
          'Published declarations, @types/express 4.17.25 and 5.0.6, @types/express-serve-static-core 4.19.9 and 5.1.3 (read 2026-10-14)',
        url: 'https://registry.npmjs.org/@types/express-serve-static-core',
      },
    ],
    maintainer: 'uptide-dev',
  },
  defaultTarget: '5.3.0',
  foldFindings: paramDestructure,
  inventory: ['package.json'],
  rules: [
    {
      id: 'route-syntax',
      summary:
        'route strings use path-to-regexp 8: an unnamed `*`, `:name?`, `+`, `(`, `)`, `[`, `]` and inline regex parameters throw at registration or match differently',
      severity: 'breaking',
      kinds: [],
      symbols: /$^/,
      detect: (text) => routeSites(text),
      guide:
        'Express 5 route strings use path-to-regexp 8 and throw at startup ("Missing parameter name", "Unexpected ?") on Express 4 syntax. The guide maps: `/*` → `/*splat` (one segment or more) or `/{*splat}` (also matches the bare prefix, as `/*` did); `/:file.:ext?` → `/:file{.:ext}`; `:name?` → `{/:name}`; `:name*` → `{*name}`; `:name+` → `*name`. A wildcard is now a named parameter holding an array: a handler that read `req.params[0]` reads `req.params.splat` (string[]; `.join("/")` for the old string). Inline regex (`:id(\\d+)`, `/user(s?)`) has no string form: use a `RegExp` route or validate in the handler, and keep what the route matched. Change only the reported path; the name you give a wildcard is read by the handlers, so check them first.',
    },
    {
      id: 'params-string-array',
      summary:
        '`req.params` values are typed `string | string[]` (@types/express-serve-static-core 5.1): code that passes them on as `string` stops compiling',
      severity: 'breaking',
      kinds: ['type', 'signature', 'removed'],
      symbols: /./,
      message: /'string \| string\[\]' is not assignable/,
      guide:
        "@types/express 5 widens `ParamsDictionary` to `string | string[]` because a wildcard parameter (`*splat`) is an array. For a route whose parameters are plain `:name` segments, type the handler with them: `(req: Request<{ id: string }>, res) => …`, or let the route string infer them (`router.get('/:id', (req, res) => …)` with an inline handler), and pass the type parameter through shared wrappers (`asyncHandler<P>`). Never cast to `string` or `any`: an array reaching code that expects a string is the bug the type now reports.",
    },
    {
      id: 'req-param-removed',
      summary:
        '`req.param(name)` is removed: it read `req.params`, then `req.body`, then `req.query`',
      severity: 'breaking',
      kinds: ['removed', 'type', 'signature'],
      symbols: /./,
      message: /'param' does not exist on type 'Request/,
      guide:
        '`req.param(name)` looked the name up in `req.params`, then `req.body`, then `req.query`. Read it from where this route actually gets it (`req.params.name` for a route parameter, `req.query.name` or `req.body.name` otherwise); where more than one source is possible, keep the same order explicitly. The codemod `explicit-request-params` reads only `req.params`, which drops body and query values: do not copy it.',
    },
    {
      id: 'sendfile-renamed',
      summary:
        '`res.sendfile()` is removed; `res.sendFile()` takes an absolute path or a `root` option',
      severity: 'breaking',
      kinds: ['removed', 'type', 'signature'],
      symbols: /./,
      message: /'sendfile' does not exist on type 'Response/,
      guide:
        '`res.sendfile(path, options, fn)` is `res.sendFile(path, options, fn)`, which requires an absolute path or `options.root`: resolve a relative path against the directory it was relative to (the process cwd in Express 4), and keep the options (`hidden` is `dotfiles`, `from` is `root`).',
    },
    {
      id: 'redirect-order',
      summary:
        '`res.redirect(url, status)` is removed: Express 5 reads `redirect(status, url)` only, and the compiler rejects the old order',
      severity: 'breaking',
      kinds: [],
      symbols: /$^/,
      detect: (text) => redirectOrderSites(text),
      guide:
        'Swap the arguments: `res.redirect(url, 301)` is `res.redirect(301, url)`. Keep the URL and the status as they are.',
    },
    {
      id: 'param-callback-removed',
      summary:
        "`app.param(fn)` and `router.param(fn)`, which customized `param()` itself, are removed: Express 5 throws 'argument name must be a string' at startup",
      severity: 'breaking',
      kinds: [],
      symbols: /$^/,
      detect: (text) => paramCallbackSites(text),
      guide:
        'The one-argument form changed how every later `app.param(name, …)` call behaved. Remove it and write what it did into each `app.param(name, fn)` it affected (a shared validator called from each callback), or into the routes, so every parameter keeps the same check.',
    },
    {
      id: 'static-mime-removed',
      summary: '`express.static.mime` is removed; MIME lookups come from the `mime-types` package',
      severity: 'breaking',
      kinds: ['removed', 'type', 'signature'],
      symbols: /./,
      message: /'mime' does not exist on type/,
      guide:
        'Import `mime-types` (the package Express 5 uses) and call `lookup(path)` for `mime.lookup`, `charset(type)` for `mime.charsets.lookup`, `extension(type)` for `mime.extension`. `define()`, `load()` and `default_type` have no equivalent: set the header (`res.type()`, `setHeaders` of `express.static`) where the custom type was used. Adding `mime-types` adds a dependency: say so in decisions.',
    },
    {
      id: 'query-middleware-removed',
      summary:
        "`express.query()` middleware is removed; `req.query` is parsed by the app's `query parser` setting",
      severity: 'breaking',
      kinds: ['removed', 'type', 'signature'],
      symbols: /./,
      message: /'query' does not exist on type 'typeof /,
      guide:
        'Remove `app.use(express.query(options))`; set the parser on the app instead: `app.set("query parser", "extended")` for qs parsing, or a function `(str) => qs.parse(str, options)` to keep the options it was given.',
    },
  ],
  behavior: expressBehavior,
  instructions:
    'Sources pinned at the Express 5 migration guide (expressjs.com 4721193) and express v5.3.0, read 2026-10-14; see RESEARCH.md. Migrate only the reported site. Keep routes matching the same requests, handlers returning the same responses and status codes, and middleware order as it is. Never cast `req.params`, `req.query` or `req.body` to `string` or `any` to make the compiler pass, and never copy a codemod rewrite without checking the receiver is an Express app, request or response.',
});
