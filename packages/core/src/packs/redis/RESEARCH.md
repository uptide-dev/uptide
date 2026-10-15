# redis (node-redis) 4 → 5 → 6: evidence and verification limits

The npm package `redis` (node-redis), not ioredis (a separate pack). Two majors, two rule sets in
one pack: an upgrade gets the rules and notes of the majors it crosses. 4.7 → 6.x in one step is
what Dependabot proposes to every 4.x user, and three of the six real upgrades found did exactly
that, so splitting the majors into two packs would have left the most common upgrade with no pack
(and pack lookup is one pack per package). `appliesTo` in `index.ts` gates detection, `ruleOf` and
notes on the crossed majors; `transform` refuses a 4 → 5 rewrite on code already on 5.

## Source ledger

All read 2026-10-14.

| Source | Pin |
|---|---|
| `docs/v4-to-v5.md`, `docs/v5-to-v6.md`, `docs/RESP.md` | node-redis `b64bacbd85642223f0a98c2d91cbcffdb9fb2052` (master) |
| Release notes `redis@5.0.0` (2025-04-30), `redis@6.0.0` (2026-05-28) | GitHub releases |
| Published declarations and builds | @redis/client 1.6.1, 5.12.1, 6.3.0; @redis/search 1.2.0, 5.12.1; @redis/time-series 1.1.0, 5.12.1 (npm tarballs) |
| `redis` manifests 4.7.0 … 6.3.0 | npm registry: dependencies, `engines` |

Release group: every `redis` release depends on `@redis/client`, `@redis/bloom`, `@redis/json`,
`@redis/search` and `@redis/time-series` at its own exact version (4.x: the 1.x line plus
`@redis/graph`; 5.0.0 onward: all five at the `redis` version). `@redis/graph` is not in 5.

Node: 5.0–5.11 `>= 18`, 5.12 `>= 18.19.0`, 6.x `>= 20.0.0`.

## Classified changes

Compiler-visible = a typed consumer gets a diagnostic. "Rewrite" only where the edit is 1:1 for
every surrounding code shape the rule accepts; anything else is assisted.

### 4 → 5

| Change | Compiler | Rule / note | Fix |
|---|---|---|---|
| `legacyMode` removed, `client.legacy()` | yes (excess property) | `legacy-mode` + detect | assisted |
| `commandOptions()` first argument, `isolated`, `executeIsolated`, `isolationPoolOptions` | yes | `command-options` + detect | assisted (`withCommandOptions`, `createClientPool`) |
| scan iterators yield batches | only downstream, in typed code | `scan-iterators`, detect only | rewrite: nested loop; declined when the body `break`s/`continue`s the loop |
| `socket.keepAlive: number` → `keepAlive` + `keepAliveInitialDelay` | yes | `keep-alive` + detect | rewrite for a numeric literal |
| SCAN/HSCAN/SSCAN/ZSCAN cursor is a string | yes when typed; `cursor !== 0` loops forever in JS | `scan-cursor` + detect | assisted |
| boolean replies → number (SETNX, EXPIRE, HEXISTS, SISMEMBER, …) | only where used as boolean | `number-replies` | assisted |
| enums → constants (17), `SearchOptions` → `FtSearchOptions` | yes (TS2305/TS2724) | `renamed-exports` | rewrite: import under the old local name; declined when the file uses a member that changed (`TO_LIST`, `FM_PT`, `AVERAGE`/`MINIMUM`/`MAXIMUM`, the reducers' `RANGE` value, `HIGH`/`MID`) or uses the name as a type |
| `@redis/*/dist/...` internals moved (`RedisCommandArgument`) | yes | `deep-imports`, compiler only (some dist paths still exist) | assisted |
| `@redis/graph` removed | yes | `graph-removed` + detect | assisted, a decision for the owner |
| `quit()`/`disconnect()` deprecated → `close()`/`destroy()` | deprecation | `quit-disconnect` | rewrite |
| SET `EX`/`PX`/`EXAT`/`PXAT`/`KEEPTTL` deprecated → `expiration` (not in the guide; declarations) | deprecation | `set-expiration` | assisted |
| search queries send `DIALECT 2` by default (release notes) | no | note `search-dialect-2`, detects query calls without `DIALECT` | — |
| `execAsPipeline` discards unwritten commands | no | note (decision) | — |
| Node 18 | no | note `node-18` (decision when engines/.nvmrc allow lower) | — |
| Reply map keys no longer camelCased (CLUSTER LINKS, XINFO, FUNCTION STATS, …), `LASTSAVE`/`TIME` types, `ZMPOP`, `XADD INCR`, `GEORADIUSSTORE` renames, JSON path options, `CLUSTER RESET/FAILOVER` option objects, `cluster.multi().addCommand` | yes, rarely used | none: `generic`, the agent works from the compiler and the guide | — |

### 5 → 6

| Change | Compiler | Rule / note | Fix |
|---|---|---|---|
| `RedisClientType` invariant in RESP, RESP3 default (not in the guide; seen in all four upgrades that reached 6) | yes (TS2322/TS2345 naming `RedisClientType<…, 3, …>`) | `client-type` | assisted |
| `unstableResp3`, `unstableResp3Modules` removed | yes | `unstable-resp3` + detect | rewrite: delete the property |
| `commandOptions` removed from sentinel `nodeClientOptions`/`sentinelClientOptions` | yes | `sentinel-node-command-options` | assisted |
| RESP3 default, 5 s command timeout, keepAliveInitialDelay 30 s, maintNotifications `auto` | no | note `client-defaults`: a finding at each inline-options client that leaves one to the default, and a decision | the instructions pin the 5 defaults per client (the ioredis approach) |
| Node 20 | no | note `node-20` | — |
| null-prototype → plain object replies | no | note (decision) | — |
| RESP3-only reply stabilization (FT.SEARCH, XREAD, TS.MRANGE GROUPBY `sources`, …) | under RESP3 only | none: `generic` | — |

Commands called through `any` or in JavaScript: `legacy-mode`, `command-options`, `scan-iterators`,
`keep-alive`, `scan-cursor`, `graph-removed`, `unstable-resp3` and both detecting notes find their
sites syntactically, in files that import `redis` or `@redis/*` only (a `.quit()` or `keepAlive` of
another library is never a site: fixture `other-libraries`).

## Independent ground truth

Drafted with `pnpm packs:truth` from each repository's own compiler and merged upgrade, reviewed by
hand and committed (0e2c81a) before the first score. Kept: the line the compiler reports, else the
line the upgrade changed because of redis. Not kept: lines changed only as a consequence of the
repository's own fix, and deprecations the code already had at the installed version.

| Repository | Hop | Upgrade | Sites |
|---|---|---|---|
| deanmoses/tacocat-gallery-sam (`app`) | 4.6.12 → 5.10.0 | PR #83 | 2 renamed-exports, 2 generic (FT.SEARCH reply union) |
| swoofer/mcp-coordinator | 5.12.1 → 6.2.0 | PR #251 | 2 client-type |
| deanmoses/tacocat-gallery-sam (`app`) | 5.12.1 → 6.2.1 | PR #133 | 2 client-type |
| UNN-Devotek/FCM-Fallout-Chat-Mod (`backend`) | 4.7.1 → 6.0.0 | PR #125 | 5 scan-cursor, 2 client-type, 2 client-defaults (RESP: 2 pinned) |
| tearingItUp786/blog | 4.7.0 → 6.0.0 | #223 + 092ea34 | 5 scan-cursor |

### Screened out

- **FalkorDB/falkordb-ts** 4.7.1 → 5.10.0 (#495), the richest 4 → 5 upgrade found (executeIsolated
  ×7, isolationPoolOptions ×2, ten `@redis/client/dist` deep imports): in the committed truth, then
  removed after the first run, which could not score it. Its `package.json` declares
  `workspaces: ["./packages/*"]` matching no directory, and `check` refuses to analyze it. No site
  of it was ever scored; an engine follow-up, not a pack change.
- **snapshot-labs/stamp** 4.7.1 → 6.2.1 (#713): requires Node >= 24.15; the install fails on Node 22.
- **semaphore-chat** 5.11 → 6.2.1 (#530): lockfile at the root, project in `backend/`; not
  installable by `packs:truth`.
- Bump-only upgrades with no source change (umami, vercel/chatbot and about 30 Dependabot PRs),
  3.x starts, latent bugs written on 5.x, and LibreChat (depends on `@redis/client`, not `redis`).
- In the issue's OSS sample, karakeep and appsmith adopted node-redis at 5/6 (no upgrade); twenty,
  n8n and budibase are still on 4.x.

## Measured pack test

`uptide pack test redis`, 2026-10-14:

```
  rule                         precision  recall    tp   fp   fn
  client-defaults                     0%      0%     0    4    2
  client-type                       100%     33%     2    0    4
  generic                            50%    100%     2    2    0
  renamed-exports                   100%    100%     2    0    0
  scan-cursor                       100%     30%     3    0    7
  breaking (sites)                  100%     61%    11    0    7
  behavior notes (sites)             50%     50%     2    2    2
```

Breaking misses, none of them a rule that did not match:

- blog (5 scan-cursor): `refresh-cache.ts` and `utils.ts` reach the client through a local module
  and a local `RedisScanClient` type and never import `redis`; `check` reports no compile error
  there, and runtime detection reads importing files only.
- FCM and tacocat 5 → 6 (4 client-type): the repositories' own `tsc` reports TS2322 at these lines,
  `check` reports nothing there. Both lines already had a different TS2322 at the installed version
  (`ReturnType<typeof createClient>` against a configured client) and `check` subtracts errors it
  finds at the installed version, which is most likely why (not confirmed in the engine).
- FCM `cursor !== 0` (2): the files import a local wrapper, not `redis`.

Behavior: the two `client-defaults` false positives are clients whose repositories accepted the
RESP3 default without pinning (mcp-coordinator, blog). The defaults did change for them; the ground
truth rule (only what the repository changed) counts them against the note. FCM pins RESP2 in an
options function the detector cannot read (it reads inline literals only).

### Per-rule evidence (for the UPT-48 gate)

Exercised by a real site: `renamed-exports` (its rewrite too), `scan-cursor`, `client-type`.
Rewrites with no real site: `scan-iterators`, `keep-alive`, `quit-disconnect`, `unstable-resp3`;
under UPT-48 they run as assisted. Rules and notes with no real site: `legacy-mode`,
`command-options`, `number-replies`, `deep-imports`, `graph-removed`, `set-expiration`,
`sentinel-node-command-options`, `search-dialect-2` and the decision-only notes.

By hop: the 4 → 5 rule set rests on one 4 → 5 repository (4 sites) and the 4 → 5 sites of the two
4 → 6 repositories (scan-cursor). The core 4 → 5 API changes (`command-options`, `legacy-mode`,
`scan-iterators`, `number-replies`, `keep-alive`) have no real site at all. The 5 → 6 rule set
has `client-type` in four repositories, two of them scored.

## What the engine cannot express

- One pack per package: the two majors are one pack with a per-major gate in the pack itself.
- Fixtures run every rewrite at the lowest versions of the pack's ranges (4.0.0 → 5.0.0), so the
  gate in `transform` only refuses rewrites of a major the upgrade already passed.
- A site reported but deliberately not rewritten (a scan loop with `break`) cannot be a fixture
  marker; it is a unit test.
- Compile errors in files that use the client without importing the package are not reported (blog).
