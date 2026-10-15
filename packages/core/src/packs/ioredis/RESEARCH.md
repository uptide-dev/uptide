# ioredis 5 → 6: evidence and verification limits

Read date for every source below: **2026-10-14**. Scope: ioredis `>=5 <6` to `>=6 <7`; the only
stable 6.x release at the read date is **6.0.0** (2026-07-31; `6.1.0-beta.1` is a prerelease).
Status: **candidate**. The pack has no breaking false positive on five public upgrades, but none
of them has a compiler diagnostic or a breaking site in application code. The only breaking
expected sites are two lines of test data in dokunc, so the gate (at least one predicted breaking
finding) cannot be met. The queue entry is `blocked` with the same reason.

## Source ledger

- [Upgrading from v5 to v6](https://github.com/redis/ioredis/wiki/Upgrading-from-v5-to-v6),
  the official guide linked from the README, wiki commit `e859962747634a89e1792cfe5a246fc9fc4c7916`
  (last edit 2026-07-10).
- [CHANGELOG at v6.0.0](https://github.com/redis/ioredis/blob/v6.0.0/CHANGELOG.md): one breaking
  entry, "ioredis now requires Node.js 20 or newer and uses RESP3 by default. Set `protocol: 2`
  to retain the v5 wire protocol."
- [README at v6.0.0](https://github.com/redis/ioredis/blob/v6.0.0/README.md), "RESP3 Protocol"
  and "Auto-reconnect".
- Commits in `v5.11.1..v6.0.0` (tag `v6.0.0` = `8ed2946504a36ae9b1e186b9dccc56afcd046d78`), read
  in full for the two that change behavior: [Add RESP3 #2127](https://github.com/redis/ioredis/commit/5d0862e078c1252470872fa3a96d7435bb34f078),
  [default connection resilience #2160](https://github.com/redis/ioredis/commit/6d0716ef9b3c7c5676c8d866388075e927f6b8b7).
- Fixes after 6.0.0, only in `6.1.0-beta.1`:
  [String.prototype fast mode #2206](https://github.com/redis/ioredis/commit/90e1261ce71f4e77ad00f54690eda54123c34bc6),
  and #2187, #2194, #2196, #2204 (rejections on resubscribe, dropped commands on reconnect,
  subscriber mode with mixed channel kinds, retries after `connect()`).
- Published declarations: `ioredis@5.11.1` and `ioredis@6.0.0` tarballs from the npm registry,
  `built/**/*.d.ts` diffed file by file; `@ioredis/commands@1.10.0` and `@2.0.0` `commands.json`.
- Dependents' published manifests (registry, 2026-10-14): bullmq (every 5.x and 6.x), bull 4.16.5,
  @hocuspocus/extension-redis 4.7.1, @chat-adapter/state-ioredis 4.41.1, cache-manager-ioredis-yet
  2.1.2, typeorm 1.1.2, ioredis-mock 8.13.1, @liaoliaots/nestjs-redis 10.0.0,
  @nestjs-modules/ioredis 2.3.1, @sesamecare-oss/redlock 1.4.0, @types/ioredis 5.0.0,
  @opentelemetry/instrumentation-ioredis 0.69.0–0.71.0, @opentelemetry/auto-instrumentations-node
  0.78.0–0.81.0, @sentry/node 10.76.2 and 11.x.
- [BullMQ changelog](https://github.com/taskforcesh/bullmq/blob/master/docs/gitbook/changelog.md),
  6.0.0 section (2026-07-30): "ioredis is no longer installed as a direct dependency and is now an
  optional peer dependency."

No codemod exists for this upgrade. Nothing was executed from any downloaded package.

## Classified changes

**M** mechanical rule · **A** assisted rule with a guide · **B** behavior note (finding or
decision) · **N** not compiler-visible and not detectable, documentation only.

| Change | Class and treatment | Source |
| --- | --- | --- |
| Node.js 20 or newer (`engines.node >=20.0.0`, was `>=12.22.0`) | B `node-20`, decision with evidence from `engines.node`, `.nvmrc`/`.node-version` and CI `node-version` | changelog, guide, manifest |
| RESP3 by default: `HELLO 3` on connect, RESP2 retry on `NOPROTO`/unknown command, other errors fail the connection | B `client-defaults`, a finding at each client construction that leaves `protocol` unset, and a decision: keep RESP3 or pin `protocol: 2` per client | guide, #2127 |
| `retryStrategy` default: `min(2^(n-1)·50, 5000)` + 0–199 ms jitter (was `min(n·50, 2000)`) | B `client-defaults`, same site; never changed silently | #2160, README |
| `keepAlive` default 30000 ms (was 0, off) | B `client-defaults`, same site | #2160 |
| Credentials sent inside `HELLO 3 AUTH user pass`; a failed login's error carries `command { name: "hello", args: [...] }` | B `handshake-auth`, breaking finding where code recognizes AUTH by command name (`=== 'auth'`, `case 'auth'`, `['auth'].includes(...)`) | guide ("including AUTH") |
| Subscribed RESP3 connections accept regular commands; `redis.mode` stays `"normal"` | B `subscriber-mode`, breaking finding at `mode === 'subscriber'` comparisons and `case 'subscriber'` | guide |
| With `enableOfflineQueue: false`, commands sent from a `connect` listener (subscribe included) may reject | B `offline-queue-connect`, breaking finding at `on/once('connect', …)` listeners that send a command on their client, in files that build a client with the queue off | guide |
| `replyMapping: "resp3"` (opt-in): maps as objects, doubles as numbers, booleans; RESP3 return types selected by the literal; Buffer variants get string map keys | N; `also-review` decision and the instructions forbid opting in during the upgrade | guide, README |
| RESP options belong under `redisOptions` for Cluster, top level for Sentinel | N (only matters when opting in); `also-review` | guide |
| `Redis`/`Cluster` generic over the reply mapping, `Commander<Context>`, `ChainableCommander<Mapping>`, `Transaction<Mapping>`, `RespShape` return types | N for default clients: `ReplyMapping` defaults to `"legacy"` and every return type resolves to the v5 one. No diagnostic in any of the five repositories | d.ts diff |
| `duplicate<Override>(override?)` returns `Redis<…>`; `Cluster#duplicate(ClusterNode[], …)` (was `any[]`) | A `duplicate-signature`, claims TS2416/TS2430 that name `'duplicate'` (subclass overrides) | d.ts diff |
| A v6 client passed to a dependent that installs its own ioredis 5 is a second class to TypeScript (TS2322/TS2345 `Redis<"legacy">' is not assignable to …`) | A `bundled-ioredis`; guide with options (a) upgrade the dependent, (b) pass options instead of the client, (c) keep ioredis 5, (d) confirm a forced single copy; the agent must say which (`sdk-agent.ts` puts guide choices under "Decisions for you"); never a cast | d.ts, bullmq #4211/#3793, measured on inbox-zero |
| Dependents bundling ioredis 5: bullmq <6 (exact `5.x` pin since 5.66.1), bull 4, @hocuspocus/extension-redis (`~5.6.1`), @chat-adapter/state-ioredis (`^5.4.1`), cache-manager-ioredis-yet (`^5.4.1`) | B `bundled-copies`, decision with evidence from package.json; peer risk, not a companion: bullmq 6 is its own major (16 breaking entries) | registry manifests, BullMQ changelog |
| Explicit peers rejecting 6: typeorm `^5.0.4` (optional), ioredis-mock `^5`, @liaoliaots/nestjs-redis `^5.0.0` | Engine peer-conflict report (left in place, listed as possible impact); nothing pack-specific | registry manifests |
| `@opentelemetry/instrumentation-ioredis` <0.70.0 patches `ioredis >=2 <6` only; `auto-instrumentations-node` <0.80.0 bundles it | B `instrumentation`, decision with evidence: spans stop silently | registry tarballs |
| `@types/ioredis` 5.0.0 is a deprecated stub; 4.x declares the v4 API | B `stale-types`, decision; `check` itself moves `@types/ioredis` 4 → 5 as a types companion (see limits) | registry |
| 6.0.0 puts `String.prototype` in V8 slow mode (VerbatimString); fixed by #2206, not in a stable release | B `string-prototype`, decision when the target is exactly 6.0.0 | #2206 |
| Removed or renamed commands | **None.** 373 → 382 command methods in `RedisCommander`, zero removed; `@ioredis/commands` 1.10.0 → 2.0.0 adds 14 commands and removes none. `vsim` became generic (`VsimReply<T>`). No syntactic detect is needed for `redis[cmd]()` or `any`-typed clients: no name stops working | d.ts and commands.json diff |
| Removed public exports | **None** that consumers import. `utils.getPackageMeta` (internal, `@internal`) is gone; `RedisStatus`, `ClusterStatus`, `ScanStreamOptions`, `HimportFieldset` are newly exported | d.ts diff |
| Event names, `exec()` result type, `Callback` | Unchanged (same emitted event-name set in `built/**/*.js`; identical `exec` signature) | d.ts and built JS |
| New: `HIMPORT` managed fieldsets (experimental), LMOVEM/BLMOVEM, SDIFFCARD/SUNIONCARD, stream MAXCOUNT/MAXSIZE | N, additive | changelog |
| Bug fixes: stale socket timeout, circular MOVED, MOVED slot validation, decimal big integers, reconnect during setup, sentinel priority 0, tracing redaction | N, no consumer change; noted for review only | changelog |

**Release group:** none. ioredis is published alone; `@ioredis/commands` is an exact dependency
(2.0.0), never declared by consumers, and the queue entry lists ioredis as its only member.
**requiresBuild:** not set. No source and no measured repository shows a build failing where
`tsc` passes. inbox-zero added `ioredis` to Next's `serverExternalPackages` in its upgrade, but its
PR says why: bullmq 6 made ioredis a peer. That is bullmq's change, not ioredis 6's.

## Ground truth

Anchor rule, fixed before the first `pack test` run (commit `0f767f4` holds the truth before
any score) and applied to every repository: one site per client construction the upgrade
changed, at the first changed line of code of the run that contains it. A second construction in
the same run starts its own site. Edits that only serve that construction (a moved import, a
widened constructor type) belong to it. Comments and other packages' changes are not sites.

**Revision 2026-10-15, after rebasing on main.** #144 changed docs/packs.md: a pure insertion
into a call the upgrade otherwise left unchanged is now a site, at the call's start line, and
`pnpm packs:truth` drafts those `anchors`. Re-running it on all five repositories (still no
compiler diagnostic) drafted five anchors. The four for ioredis were added unchanged: voiceai
`redis-pubsub.ts:140` and `rate-limiter.ts:57`, open-foundry `server.ts:138`, dokunc
`apps/web/src/lib/redis.ts:54`. The fifth, voiceai `error-scrub.test.ts:44`, belongs to the
@sentry/node bump and was dropped. No earlier site was moved or removed. Compiler evidence: `pnpm packs:truth` with each repository's own
TypeScript and ioredis 6.0.0 linked: **no new diagnostic in any of the five**. Installs ran with
scripts off; nothing from a repository was executed.

| Repository | Parent | Upgrade | Versions | Expected |
| --- | --- | --- | --- | --- |
| [ferni-ai/voiceai](https://github.com/ferni-ai/voiceai/pull/703) | `c59ed0982f96e23d2b2f5728711da5b55e07483a` | `c6838d5ecdc0bd319c706621b2bfc9d058a2dda0` | 5.8.2 → 6.0.0 | 7 `client-defaults` (protocol: 2 pins) |
| [syzygyhack/open-foundry](https://github.com/syzygyhack/open-foundry/commit/a466e0d364c2e2dd0fae8bbcf30ef9de25978b18) | `73910018b5e8119cf4db99a81ff145726451aa3b` | `a466e0d364c2e2dd0fae8bbcf30ef9de25978b18` | 5.10.1 → 6.0.0 | 2 `client-defaults` |
| [simondietschi/dokunc](https://github.com/simondietschi/dokunc/pull/15) | `83681ed0ccc527fa1dd5c802f554f26a5eac575c` | `c47539089296efdb02a3093bb650185b4861f297` (in merge `03ae5da`) | 5.11.1 → 6.0.0 | 2 `client-defaults` (v5 retryStrategy), 2 `handshake-auth` (redaction test) |
| [safe-global/safe-client-gateway](https://github.com/safe-global/safe-client-gateway/pull/3409) | `14bd05b98bf41df509de0bfee8bc662cb9d95d1e` | `80135d22e8006fec71e7da270efdff65ec092c89` | 5.11.1 → 6.0.0 | none (manifest only; Yarn Berry) |
| [kazumadev619-dev/FishingConditionsApp](https://github.com/kazumadev619-dev/FishingConditionsApp/pull/235) | `8ba3f0d24bc709169b79df11daa87307df32e77c` | `cdecc03c3c04d0e4f08351ceef6b10df6f1bfd81` (in merge `ebf69b5`) | 5.11.1 → 6.0.0 | none (manifest only; npm; drops `@types/ioredis`) |

Per repository:

- **voiceai.** Its commit message: "Pin protocol: 2 at every client construction site so the
  upgrade does not change what goes over the wire." Seven constructions were pinned. Two were
  pure insertions, anchored at their calls (`redis-pubsub.ts:140`, `rate-limiter.ts:57`). Two runs
  rebuilt two constructions each: `redis-cache.ts` 98–118 and `redis-job-queue.ts` 89–106, at 98/108
  and 89/98. `embedding-cache.ts:134` builds its client through a module name hidden from bundlers;
  `:126` widens its constructor type for the option. The same commit bumps @sentry/node 10 → 11,
  which shares no dependency edge with ioredis, so it is not listed under `with` and its changed
  lines are not scored. The commit message claims Redis < 6 fails the connection; the guide says
  the client retries with RESP2, and the pack follows the guide.
- **open-foundry.** A rate limiter with `enableOfflineQueue: false` pins `protocol: 2` "for
  Redis-compatible proxies". The changed run is the constructor acquisition (`:136–137`), and the
  pin itself is inserted into the unchanged call, anchored at `:138`.
- **dokunc.** The branch of merged PR #15 bumps ioredis (`bb72cd7`), dedupes the lockfile
  (`b4d6782`) and restores the v5 `retryStrategy` (`c475390`) after measuring 10–15 s command
  stalls during an outage with the new default. The range also carries vitest 5 and mermaid 12
  commits, whose lines are not scored. `apps/collab/src/server.ts:108` is the construction moved
  to `createRedisClient` (the import at `:9` serves it). `apps/web/src/lib/redis.ts:54` gets
  `retryStrategy` by pure insertion, anchored at the call. `log.test.ts:20` and `:28` extend the
  redaction test to `hello [3, AUTH, user, password]`. Later commits (`c8491ea`, `2a75967`) fix
  bugs their messages say already existed with ioredis 5, so they are not scored.
  `@hocuspocus/extension-redis` keeps its own ioredis 5.6.1; the repository already casts the
  client it passes in.
- **safe-client-gateway** and **FishingConditionsApp.** Clean upgrades: no source line, no
  diagnostic. They are negative controls for every detector.

### Screened out

- [elie222/inbox-zero#3821](https://github.com/elie222/inbox-zero/pull/3821) (`5724468` →
  `9bf2b39`, 5.10.1 → 6.0.0): a real upgrade, but bullmq 5.79.2 → 6.3.8 moved with it, and its
  only ioredis-relevant diagnostic was an artifact. `packs:truth` linked ioredis 6 into `apps/web`
  only and reported TS2322 at `apps/web/utils/queue/bullmq.ts:65` (`Redis<"legacy">` not
  assignable to bullmq 5's `ConnectionOptions`). A real scripts-off install of the parent with
  only ioredis and the workspace override bumped resolves bullmq 5.79.2 to the same ioredis 6.0.0,
  and that line compiles. So the repository has no ioredis site. Honest `with: { bullmq }` would
  fail `pack test` as "left behind": `check` does not move bullmq, and must not, since bullmq 6 is
  its own major migration. Scoring it would only add a failure the pack cannot fix. The TS2322
  message is kept as the `bundled-ioredis` unit-test case.
  `packs:truth --directory apps/web` also fails (`UNSUPPORTED_PACKAGE_MANAGER`): the installer
  looks for the lockfile in the directory, not the workspace root.
- Merged, manifest-only bumps not needed as further controls: AHSAL-innovationz/hendrix
  (#5, `70ba290`), ribato22/MultiWA (#169, `3202806`), saeedmoh4444/galaxy-of-beauty (#314),
  joacominatel/lazyit (#1241).
- Not merged, or bundled with other majors: robbeverhelst/routess #408 (closed; folded into a
  Nest 12 upgrade), tauinbox/client-server-starter-app (BullMQ 6, cache-manager 7 and others),
  AaraikAI/ComplyEasyAI #564 (held back over the #2206 slowdown), and Dependabot PRs still open
  (brahim1205/c2p-website #55, DealAppSeo/repid-engine #1294, others).
- From the queue's 52-repository sample, only inbox-zero has an ioredis 6 bump since 2026-07-25
  (checked by `git log -G'"ioredis": *"[~^]?6'` over each repository's package.json files;
  midday-ai/midday could not be cloned).

## Measured: `pnpm uptide pack test ioredis --write`

On main `0881185` (with #143 and #144), from the revised truth above:

| Rule / scoring group | Precision | Recall | TP | FP | FN |
| --- | ---: | ---: | ---: | ---: | ---: |
| client-defaults (deprecated: needs a look) | 70% | 64% | 7 | 3 | 4 |
| handshake-auth (breaking) | n/a | 0% | 0 | 0 | 2 |
| Overall sites | 70% | 54% | 7 | 3 | 6 |
| Behavior-note sites | 70% | 54% | 7 | 3 | 6 |
| Breaking sites | n/a (0 predicted) | 0% | 0 | 0 | 2 |

Status: **candidate**, 5 public repositories, 0 breaking false positives, 0 breaking
predictions. Before the rebase (old scorer, truth without anchors) the same pack measured
client-defaults 30% / 43% (3/7/4) and breaking 0/0/6.

`check` on dokunc now also reports `@hocuspocus/extension-redis 4.7.0 depends on ioredis
~5.6.1; no release accepts ioredis 6.0.0` as a blocker (#142). That is the bundled copy the
`bundled-copies` decision names. The repository upgraded anyway, keeping both copies and casting
the client it hands to the extension.

False positives, all non-breaking `client-defaults`:

- voiceai `redis-cache.ts:101` and `redis-job-queue.ts:92`: the first construction of each
  rebuilt run, which the anchor rule puts at the run's first line (98, 89). Those two lines are
  the matching false negatives.
- FishingConditionsApp `src/lib/cache/client.ts:13`: a client that sets its own `retryStrategy`
  and was left on RESP3 by choice. That is the decision this finding asks for, and the
  repository answered it without a code change.

False negatives:

- voiceai `embedding-cache.ts:134`: built through `new Function('m', 'return import(m)')`, which
  no static scan can resolve, in a file `check` never lists as an ioredis user.
- voiceai `:98`, `:89`: anchor mismatches, above. open-foundry `:136`: the rewritten
  constructor acquisition, two lines above the construction the pack reports (`:138`, now a true
  positive).
- dokunc `log.test.ts:20`, `:28`: test data and assertions modeling the v5 error shape
  (`command: { name: "auth" }`, `toBe("auth")`). `handshake-auth` finds code that *recognizes*
  AUTH by name, not fixtures that *construct* it. Widening it to every `"auth"` literal in tests
  would trade these two for false positives elsewhere. They are the two breaking misses: the
  note is declared breaking because a redaction that stops redacting breaks its contract.

## What the engine cannot express (follow-up work, not part of this pack)

1. **A runtime-only major cannot be verified.** `statusOf` requires a predicted breaking finding.
   ioredis 6's breaking changes (RESP3, defaults, Node 20) are behavior. With perfect detection
   the pack would still be a candidate, and so would any upgrade that breaks nothing the compiler
   sees.
2. ~~Behavior-note severity is ignored when scoring misses.~~ Resolved by #143: expected sites
   are scored at their note's severity, and behavior-note sites have their own row.
3. ~~Pure insertions are not sites.~~ Resolved by #144: an insertion into an unchanged call is
   a site at the call, and the ground truth above now includes those anchors.
4. **Run anchoring vs. construction anchoring.** The truth convention anchors a rewritten run at
   its first line. A finding anchors at the construction it is about, so rewrites that restructure
   around a call always miss by a few lines.
5. **Detection sees only files with static usages.** `runtimeFindings` scans usage files and the
   inventory, so a client built through a hidden module name is unreachable. `detect` has no type
   information either: it cannot follow a client built in a factory and returned, or recognize a
   `Redis` parameter.
6. **No "remove a package" outcome.** `check` moves `@types/ioredis` 4.28.10 → 5.0.0 as a types
   companion, while the real upgrade (FishingConditionsApp) removed the deprecated stub. The pack
   can only say so in a decision.
7. **`with` cannot tell an unrelated co-bump from a required one, nor model "this dependent must
   move a major".** inbox-zero's bullmq 5 → 6 is required by bundling but must not become an
   automatic companion. voiceai's @sentry/node and dokunc's vitest/mermaid are unrelated.
8. **`packs:truth` links per workspace.** With a pnpm override that forces one ioredis copy, it
   fabricates a two-copies TS2322 a real install does not produce (inbox-zero), the same class of
   artifact as next RESEARCH item 4. `--directory` with a root lockfile fails to install.
9. **Fixture markers cannot carry `"` in `message:`.** v6 diagnostics name `Redis<"legacy">`, so
   the two compiler-claim rules are covered by unit tests instead of fixtures.

## Reproduce

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm uptide pack test ioredis --fixtures-only
pnpm uptide pack test ioredis            # fetches the five repositories once, scripts off
pnpm packs:truth ioredis ferni-ai/voiceai c59ed0982f96e23d2b2f5728711da5b55e07483a c6838d5ecdc0bd319c706621b2bfc9d058a2dda0 --to 6.0.0
```
