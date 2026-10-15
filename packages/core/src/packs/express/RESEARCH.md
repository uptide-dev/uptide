# express 4 → 5: evidence and verification limits

Read date for every source below: **2026-10-14**. Scope: any 4.x release to any 5.x release.
The latest at the read date are express **4.22.3** (2026-09-14, `latest-4`) and **5.3.0**
(2026-10-09, tag `cf6722bf89a86905281d9160b6482e08166b5ef0`), the pack's `defaultTarget`. The
ground truth upgraded to 5.2.1. The map below is built from the official guide, the changelogs,
the codemods' source and the published declarations, not from memory.

## Source ledger

- Migration guide, `src/content/pages/en/guide/migrating-5.mdx` at expressjs.com
  [`472119366bbffc206e0deba32277d607cf9f6e13`](https://github.com/expressjs/expressjs.com/blob/472119366bbffc206e0deba32277d607cf9f6e13/src/content/pages/en/guide/migrating-5.mdx)
  (2026-06-23, the last change to the file; the older `en/guide/migrating-5.md`, last at
  `de7293572d50cb6dca6939ca8838d1f01eeb2807`, is a subset).
- [History.md at v5.3.0](https://github.com/expressjs/express/blob/cf6722bf89a86905281d9160b6482e08166b5ef0/History.md):
  5.0.0-alpha.1 to 5.3.0. Tags: 5.0.0 `344b022f`, 5.0.1 `d14b2de7`, 5.1.0 `cd7d4397`, 5.2.0
  `4007ad10`, 5.2.1 `dbac741a`, 4.22.3 `899b5249`. `engines.node` is `>= 18` in 5.3.0.
- [path-to-regexp Readme at v8.4.2](https://github.com/pillarjs/path-to-regexp/blob/cbf30259e6d34d6135f9e7dbaa3371e7188f9936/Readme.md)
  (Express 5 uses router 2.2.0 `e6d6b609`, which depends on `path-to-regexp ^8.0.0`; Express 4.22.3
  uses `~0.1.13`).
- body-parser HISTORY at [2.3.0 `d0f2ace6`](https://github.com/expressjs/body-parser/blob/d0f2ace6c74769da7d19b8661b9a01c01bdb0bf7/HISTORY.md)
  (1.20.8 `5c08c200`); serve-static 2.2.1 `76312e12`; send 0.19.2 `34ba03b7` and 1.2.1 `096a6148`.
- Codemods, **read, never run**: expressjs/codemod at
  [`2f7f1e5f31ebab6e840957b0cf171a014ad7a3b9`](https://github.com/expressjs/codemod/tree/2f7f1e5f31ebab6e840957b0cf171a014ad7a3b9/codemods)
  (each transform byte-identical to its `v1.0.0@<name>` tag; the recipe is v1.1.0). The npm package
  `@expressjs/codemod` 0.0.5 (`df7e3b3c`) is deprecated on npm in favor of these.
- Published declarations (npm tarballs, nothing executed): @types/express 4.17.25 and 5.0.6,
  @types/express-serve-static-core 4.19.9 and 5.1.3, @types/serve-static 1.15.10 and 2.2.0, @types/send
  0.17.6 and 1.2.1. Compiler visibility below was measured with this checkout's TypeScript 5.9.3
  (`--strict --noEmit`) on a probe file against each set.

## Classified changes

**A** assisted rule (guide for the agent), **B** behavior note, **N** no action. There is no
mechanical rule (below). "Already v4" means @types/express 4 already rejected the call, so a
TypeScript project cannot have it and `check` never reports it as new.

| Change | Class and treatment | Compiler | Source |
| --- | --- | --- | --- |
| Route strings on path-to-regexp 8: unnamed `*`, `:name?`, `:name*`, `:name+`, `(`, `)`, `[`, `]`, `?`, `+`, `!` reserved, `{}` groups, inline regex params; throws at registration | A `route-syntax` (detect): the first argument of `all/use/route/<verb>` on an app or router this file binds (`express()`, `Router()`, a parameter or property typed `Express`/`Application`/`Router`/`IRouter`, `this.app`), a `const` path list, or a `for…of` over one; one site per registration | No (strings) | guide, ptr Readme |
| `req.params` values typed `string \| string[]` (essc ≥ 5.1.1) | A `params-string-array` (message `'string \| string[]' is not assignable`): the guide types the params, never casts | TS2322/TS2345, new | essc 5.1.3 d.ts |
| `req.param(name)` removed | A `req-param-removed` | TS2551, new | guide, History alpha.2 |
| `res.sendfile` removed | A `sendfile-renamed` | TS2551, new | guide, History alpha.1 |
| `res.redirect(url, status)` removed | A `redirect-order` (detect: a second argument that is a number on an Express response) | TS2345, new, but the message is generic | guide, History alpha.6, 5.2.0 |
| `app.param(fn)` / `router.param(fn)` removed; throws at startup | A `param-callback-removed` (detect: one argument on a known app or router) | TS2554, new, generic message | guide, router 2.2.0 |
| `express.static.mime` removed | A `static-mime-removed` | TS2339, new | guide, serve-static HISTORY |
| `express.query()` removed | A `query-middleware-removed` (not in the guide) | TS2339, new | History alpha.1 |
| `res.redirect('back')`, `res.location('back')` removed | B `redirect-back` (finding, breaking, detect on Express responses) | No | guide, History 5.0.0 |
| `res.send(<number>)` sends the number as a body with status 200 | B `send-status-number` (finding, breaking, detect on Express responses) | No (`body: any`) | guide, response.js at v5.3.0 |
| Rejected promises reach error middleware | B `async-errors` (decision) | No | guide, router layer.js |
| `req.body` undefined without a parser | B `req-body-undefined` (decision, test follow-up) | No | guide, body-parser 2.0.0 |
| Query parser default `extended` → `simple`; `req.query` a getter | B `query-parser` (decision) | No | guide, application.js |
| `express.urlencoded()` `extended` default → false | B `urlencoded-extended` (decision) | No | guide, body-parser 2.0.0 |
| `dotfiles` default: send 1.x ignores every dot segment; v4 served dot-directories | B `static-dotfiles` (decision) | No | send 0.19.2 vs 1.2.1 source |
| Node ≥ 18 | B `node-minimum` (decision, only when `engines.node` allows older) | No | package.json 5.3.0 |
| `req.host` keeps the port, `res.status` validation, `res.clearCookie` ignores maxAge/expires, `res.vary()` without field throws, `.js` MIME | B `runtime-defaults` (decision) | No | guide, History 5.0.0 |
| `app.del`, singular `req.accepts*`, `res.json/jsonp/send(body, status)`, `hidden`/`from` options | N: already v4 in the types; not new for TypeScript | Already v4 | guide |
| `app.router` is a Router, `app.listen` passes errors to its callback, `res.render` always async, debug namespaces, body-parser 2.3.0 `limit` validation | N: no site in the ground truth; the listen and router changes relax or retype rather than break most code | Mostly no | guide, History |

**No rule rewrites.** The codemods were read to decide which rewrites are safe whatever the
surrounding code; none is:

- `route-del-to-delete` and `status-send-order` do not check the receiver (`redis.del('k')`,
  `ws.send(1)`), and `status-send-order` drops arguments past the second.
- `explicit-request-params` reads only `req.params`, losing the body and query values `req.param`
  also returned.
- `static-dotfiles` / `sendfile-options` add `dotfiles: 'allow'`, which serves dotfiles (`.env`)
  that Express 4 hid.
- Route strings have no rewrite in any codemod. The guide's mappings change what handlers read
  (`req.params[0]` becomes `req.params.splat`, an array), and the real upgrades chose different
  names and forms (`{*splat}`, `*rest`, `{*path}`, `:siteId`), so the path is the owner's choice.
- `camelcase-sendfile` and `redirect-arg-order` are close to safe, but no ground-truth repository
  has a site for them: under UPT-48 an unexercised rewrite would run as assisted anyway.

`requiresBuild` is not set: no ground-truth failure appeared only in a build. Route errors throw at
startup, which tests that start the app see.

Companions: none declared. `@types/express` moves with the lead as `check` pairs it already (every
scored repository shows `with @types/express … → 5.0.6`). The guide names no other package that
must move.

## Independent ground truth

Four public repositories, each with its own npm lockfile. Each parent was fetched shallow at its
pinned commit and installed from its lockfile with lifecycle scripts off; nothing from a
repository was built, tested or run, and nothing was pushed, commented or opened on any of them.
Expectations were drafted with `pnpm packs:truth` (each repository's own TypeScript, express 5.2.1
and @types/express 5.0.6 linked as an install would) and the merged upgrade diff, reviewed by hand,
and committed (`ab94e71`) **before the first score**. They were not changed after scoring.

| Repository | Parent | Merged upgrade | express | Expected |
| --- | --- | --- | --- | --- |
| [netlify/cli](https://github.com/netlify/cli/pull/7927) | `63b6f1cbca316fa6c338d59e5b5053a11de25c6c` | `6414c1424b7b0a6e8418d25ffd1e8f92d035fd69` | 4.22.1 → 5.2.1 | 8 route sites (5 `app.all('*')`, 3 route paths held as test data), 2 test assertions on an empty `req.body` |
| [bcgov/tenant-management-system](https://github.com/bcgov/tenant-management-system/pull/699) (`backend/`) | `6fd01755043a3db9ed0577ffa6b1b4a184ae670f` | `744705634f3f07fc1a180befd8964f61b56b8075` | 4.22.2 → 5.2.1 | 52 new `string \| string[]` diagnostics, the destructure the upgrade rewrote, 1 wildcard route |
| [amiantos/lurker](https://github.com/amiantos/lurker/pull/147) | `f7a0f3dac77570ec3fd93a487ccf0aaf2f6ca5db` | `84d7bb12bb65067352465ec778facf91a8498e2d` | 4.22.2 → 5.2.1 | 10 new `string \| string[]` diagnostics, 8 handler and wrapper annotations the upgrade added |
| [openhab/openhab-cloud](https://github.com/openhab/openhab-cloud/pull/550) | `5a1866efe1c038e287d2d59091951e1912db12f8` | `b25ee4371bbd4e561aed583b7e2b45c88e550eb0` | 4.22.1 → 5.2.1 | 4 route registrations (one a list in a loop), csurf's Request type (TS2345), an explicit return type for declaration portability |

88 expected sites, 86 of them breaking (UPT-48 proposes a minimum of 5).

Site convention, fixed before scoring: one site per route registration (each `router.all(...)`
statement, each `{ path }` entry of a mock API); a list registered by one loop is one site at its
first path. Comment-only lines and other packages' changes (http-proxy-middleware 3's options in
netlify, the csurf import line in openhab) are not sites. Where an upgrade fixed the params type
on the handler (`Request<{ token: string }>`) rather than at the reported use, both the
annotation and the compiler's line are sites.

`with`, from each upgrade commit's lockfile: @types/express 5.0.6 everywhere; netlify also moved
http-proxy-middleware 2.0.9 → 3.0.5 (its 2.x has an optional peer `@types/express ^4`); openhab
also moved body-parser 1 → 2.2.2 and serve-static 1 → 2.2.1 (neither depends on express; the
repository chose to move them).

### Screened out

Searched read-only (blobless clones, `git log`/`show`, `gh search`):

- **snapshot-labs/stamp#711** (yarn 1; inline regex params, `req.body ?? {}`, query parser, listen
  callback): its `engines.node` is `>=24.15` and the frozen install refuses Node 22, which the Packs
  CI job uses. The widest spread of changes; usable once CI runs Node 24.
- opengovsg/GoGovSG#2545: 391 unrelated files in the merge. pvince/omg-acurite-filter#12: @types
  stays 4. 4ssh1/url-shortener-api#1: already on 5. SAP/spartacus#21063: a schematic, not an upgrade.
- Workspace packages with only a root lockfile (unsupported by the ground-truth installer):
  event-driven-io/emmett#380, cedarjs/cedar#2583, 0xPolygon/apps-team-ts-template#11,
  rocapellino/pokedex#491, ericfaris/vntypl8s#15, ericfaris/setlist#9.
- JavaScript-only route changes: ministryofjustice/offender-categorisation#1051, hardytool/server#365.
- Mixed with large unrelated refactors, or lockfile-only: misunacademy/misun-academy-server#3,
  JoA-MoS/garage#226, PeteLeeds/Personal-Chart-Project#30, mpppk/mono#288.
- Pure bumps kept as possible negative controls, not scored: graycoreio/daffodil#4666,
  ericfaris/meal-mate#23, gavdilabs/cap-mcp-plugin#146.

## Measured pack test

`pnpm uptide pack test express --write` with per-pack caches (`UPTIDE_GROUND_TRUTH_CACHE`,
`UPTIDE_CACHE_DIR`): **candidate**, 4 public repositories, and **the run fails** (below).

| Rule / scoring group | Precision | Recall | TP | FP | FN |
| --- | ---: | ---: | ---: | ---: | ---: |
| params-string-array | 100% | 87% | 62 | 0 | 9 |
| route-syntax | 100% | 77% | 10 | 0 | 3 |
| generic | 100% | 50% | 1 | 0 | 1 |
| req-body-undefined | n/a | 0% | 0 | 0 | 2 |
| Overall sites | 100% | 83% | 73 | 0 | 15 |
| Behavior-note sites | n/a | 0% | 0 | 0 | 2 |
| Breaking sites | 100% | 85% | 73 | 0 | 13 |

**Why it fails, and why that is not fixed here.** `pack test` fails a repository whose upgrade
moved a package `check` leaves in place:

- netlify: http-proxy-middleware (moved to 3.0.5; `check` treats the 2.x optional peer on
  `@types/express ^4` as a conflict and leaves it, as the engine does for every peer conflict), and
  `blocked: verdaccio 6.2.4 depends on express 4.21.2` (verdaccio is a dev tool with its own
  nested express; npm kept it at 4.21.2 in the real upgrade, so blocking on it is wrong for a nested
  exact dependency).
- openhab: body-parser and serve-static, which the repository chose to move.

Changing `with` or dropping these repositories after scoring would make the pack pass by editing
the evidence. Both are engine questions: move peer-conflicted dependents with the lead, do not block
on a dependency's exact nested pin, and decide whether a repository's own extra moves belong in
`with`.

**Recall misses, all kept.** Lurker's handler annotations and bcgov's destructure are where the
upgrade fixed a params type, not where the compiler reports it. netlify keeps three route paths as
data passed to `app[method](path)`, and asserts on `req.body` in tests; neither has a source pattern
that would not also match unrelated code. openhab's `createMiddleware` return type fixes a
declaration-emit error that a no-emit compile does not report.

**Before and after the first score.** The first scored run (shared cache) missed openhab's
`proxyPaths` list: the detector followed only top-level `const` lists, and this one is declared
inside `createRoutes`. The detector now follows the one `const` of that name at any depth, and the
fixture has the nested case. Two later runs in the shared `~/.cache/uptide/ground-truth` lost
repositories mid-run to another process evicting the cache (netlify predicted 0); scoring with
per-pack caches gave the table above.

Not measured by public ground truth (fixtures and unit tests only): `req-param-removed`,
`sendfile-renamed`, `redirect-order`, `param-callback-removed`, `static-mime-removed`,
`query-middleware-removed`, `redirect-back`, `send-status-number`, and every decision note. None of
them rewrites, so under UPT-48 none is an unexercised rewrite.

## UPT-48 readiness

Written to the stricter gate as proposed (it had not landed at the read date): 86 expected breaking
sites across 4 repositories, per-rule TP/FP/FN above, and no mechanical rewrite to demote to
assisted. To rebase on UPT-48 before claiming verified; the companion failures above block verified
on either gate.

## What the engine cannot express

- **Route data.** A path reaching a router through a computed member (`app[method](path)`) or from
  another file is not followed; `check` has no data flow.
- **Where the params fix goes.** The compiler reports the use; the right fix is often the handler's
  type parameter, which `check` does not report as a site.
- **Moves around the lead** (above): peer-conflicted dependents, nested exact pins, and packages a
  repository moves by choice.
- The curated express runtime list in `check/runtime-changes.ts` (text patterns, `unverified`)
  still serves the generic tier; with the pack in use, the pack owns those sites.
