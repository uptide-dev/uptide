# Sentry JavaScript SDK 10 → 11: evidence and verification limits

Read date for every source below: **2026-10-14**. Scope: stable 10.x to stable 11.x, up to
11.7.0 (11.0.0 was published 2026-09-23). The pack is registered once per package a consumer
declares, all four built from this directory: `sentry-nextjs`, `sentry-node`, `sentry-react`,
`sentry-browser` (`pack.ts`, `sentryPack(lead)`). No engine implementation changes are part of
this pack.

## Source ledger

- [MIGRATION.md, "Upgrading from 10.x to 11.x", tag 11.7.0](https://github.com/getsentry/sentry-javascript/blob/11.7.0/MIGRATION.md#upgrading-from-10x-to-11x).
  Compared with the same file at tag 11.0.0: the only difference is one added line (Bun
  minimum 1.3.14). The 11.0.0 changelog names this file "a comprehensive migration guide".
- [CHANGELOG.md, tag 11.7.0](https://github.com/getsentry/sentry-javascript/blob/11.7.0/CHANGELOG.md),
  sections 11.0.0 to 11.7.0 (every `!` entry of 11.0.0 read against the guide).
- [`.craft.yml`, tag 11.7.0](https://github.com/getsentry/sentry-javascript/blob/11.7.0/.craft.yml):
  the npm targets one release publishes at one version (the release group).
- Published manifests and declarations: `@sentry/nextjs`, `@sentry/node`, `@sentry/react`,
  `@sentry/browser`, `@sentry/core` at **10.76.2** and **11.7.0**, installed with scripts off;
  every export and every `*Options`/`*Integration` option compared with the TypeScript API;
  `@sentry/nextjs/config` exists in both (so the `withSentryConfig` import move is safe on
  either side of the upgrade). npm metadata for `@sentry/vite-plugin` (5.4.0, 5.4.1),
  `@sentry/types`, `@sentry/node-core` (no 11.x), `@sentry/utils` (last 8.55.2).
- Not read: the docs.sentry.io v10-to-v11 pages. The network policy of this environment
  refuses docs.sentry.io; they are not cited.

## Classified changes

**M** = mechanical rule (a rewrite safe whatever the surrounding code), **A** = assisted rule
(detected or compiler-claimed; the agent gets the guide, options end in "Decisions for you"),
**B** = behavior note (decision, scoped by `applies()` to inventory evidence), **N** = not
compiler-visible and not a source site (documented only). Anchors are MIGRATION.md sections.

| Change | Class | Rule / note | Compiler sees it? |
| --- | --- | --- | --- |
| `withSentryConfig`, `SentryBuildOptions` leave `@sentry/nextjs` for `@sentry/nextjs/config` | M (import/require of only those names; mixed imports A) | `with-sentry-config-import` | TS2305 in next.config.ts only; .js/.mjs need detect |
| Top-level build options removed (`disableLogger`, `autoInstrument*`, `automaticVercelMonitors`, `excludeServerRoutes`, `disableSentryWebpackConfig`, `_experimental.turbopackApplicationKey`) | M where the mapping is 1:1 and the destination is free; else A | `build-options` | TS2353 only for a literal in next.config.ts |
| `disableManifestInjection` (inverted), `unstable_sentryWebpackPluginOptions` (gone) | A | `build-options` | as above |
| `reactComponentAnnotation` reinstated top-level, now also Turbopack | B | `react-component-annotation` | no |
| `sendDefaultPii` removed; `dataCollection` defaults more permissive | A (never rewritten; options: remove / v10 baseline / accept) + B | `send-default-pii`, `data-collection` | TS2353 for the first excess key of a literal |
| `enableLogs`, `_experiments.enableLogs` removed | M for literal `true`; `false`/dynamic A | `enable-logs` | TS2353 (first excess key only) |
| `enableMetrics`, `_experiments.enableMetrics` removed; `beforeSendMetric` top-level | M for literal `true`; A otherwise | `enable-metrics` | as above |
| `profilesSampleRate`, `profilesSampler` removed (session profiling) | A (options: trace / manual lifecycle) | `profiling-options` | TS2353/TS2561 |
| Span streaming default: `ignoreTransactions`, `beforeSendTransaction` no-op | A (options: ignoreSpans / beforeSendSpan+is_segment / static lifecycle) + B | `ignore-transactions`, `before-send-transaction`, `span-streaming` | deprecated, no diagnostic in an object literal |
| `beforeSendSpan` and `spanToJSON` use `StreamedSpanJSON` (`description`, `op`, `data`, `timestamp` gone) | A, syntactic detect of reads through `any`/declared-apart callbacks | `span-json-format` | only where the callback is contextually typed |
| `withStreamedSpan` deprecated no-op | M (unwrap) | `streamed-span-wrapper` | TS6385 |
| `spanToStreamedSpanJSON` → `spanToJSON`, `inboundFiltersIntegration` → `eventFiltersIntegration`, `instrumentLangGraph` → `instrumentStateGraph`, `bfcacheIntegration` → `bfcacheMetricsIntegration` | M (binding-aware; a local of the new name declines) | `renamed-exports` | TS2305/TS2339 at the import; uses of the binding are `any` after it |
| `otlpIntegration` → `openTelemetryIntegration`, options and exporter removed | A | `renamed-exports` | as above |
| Integrations named `InboundFilters`/`OtlpIntegration` in string comparisons | M | `integration-names` | no (a string) |
| `@sentry/types`, `@sentry/node-core`, `/loader`, `/preload`, `/init`, `webpack5`, `cloudflare/nodejs_compat` entry points removed | A | `removed-modules` | TS2307 where compiled |
| `@sentry/core` split into isomorphic / `core/server` / `core/browser`; AI helpers to `@sentry/server-utils` | A | `core-subpaths` | TS2305 |
| `Scope.clear()`, `SEMANTIC_ATTRIBUTE_SENTRY_SOURCE`, `createSpanEnvelope`, `SentryContextManager`, `generateInstrumentOnce`, `preloadOpenTelemetry`, `honoIntegration`, Connect, Fastify helpers, AI helpers in browser SDKs | A | `removed-exports` | TS2305/TS2339 |
| OpenTelemetry: `skipOpenTelemetrySetup` → `enableOpenTelemetrySetup` (inverted, different meaning); `openTelemetrySpanProcessors`/`Instrumentations`/`BasicTracerProvider` removed | A (options: Sentry only / OTel-compatible / own provider) + B | `opentelemetry-setup`, `opentelemetry-interop` | TS2353 |
| `registerEsmLoaderHooks`, `disableInstrumentationWarnings`, `maxSpanWaitDuration` removed | A | `removed-node-options` | TS2353 |
| `httpIntegration`: four key renames | M | `http-integration-options` | TS2353/TS2561 |
| `httpIntegration`: `instrumentation.*` hooks removed (direction choice), `dropSpansForIncomingRequestStatusCodes` → deprecated no-op `ignoreStatusCodes` | A | `http-integration-options` | TS2353 |
| `setupExpress/Fastify/Koa/HapiErrorHandler`, `expressErrorHandler` deprecated | A (remove only when the integration is active) | `error-handlers` | TS6385 |
| `shouldHandleError` moved from the handlers to the integrations | A | `error-handler-options` | TS2554/TS2353 |
| `node --require` preload unsupported | A, detect in package.json scripts | `require-preload` | no |
| `browserTracingIntegration`: `trackFetchStreamPerformance`, `ignorePerformanceApiSpans`, `_experiments`, `beforeSpanEnd` | A (add the dedicated integration) | `browser-tracing-options` | TS2353 |
| `breadcrumbsIntegration({ console })` removed | A | `breadcrumbs-console` | TS2353 |
| `sendFeedback` rejects with `Error`, never a string | A, detect of string handling of the rejection (`unknown`/`any`) | `feedback-rejection` | no |
| `attachStacktrace` defaults to true | B | `attach-stacktrace` | no |
| `tracePropagationTargets` case-insensitive, `g`/`y` ignored | B | `trace-propagation-targets` | no |
| `tracesSampler`/`ignoreSpans` evaluated at span start; low-cardinality names | B | `sampling-filters`, `span-streaming` | no |
| Browser sessions `unhandled`, `page` lifecycle, per-soft-navigation web vitals, bfcache vitals | B | `browser-sessions-vitals` | no |
| Vercel default environment without `vercel-` prefix (nextjs) | B | `vercel-environment` | no |
| `tunnelRoute` requests run through middleware (nextjs) | B | `tunnel-route` | no |
| Node 20.19.0, TypeScript 5.0.4, Next.js 14, React 17 minimums | B | `platform-minimums` | no |
| Span attribute and op renames (`http.method`, `db.statement`, `request_handler.*`, ...), `DOMException.code` tag, LangGraph `create_agent`, AI non-inference spans | N (dashboards/alerts); pointed to by `also-review` and `span-streaming` | `also-review` | no |
| Framework-specific SDKs (Cloudflare, Deno, Nuxt, SvelteKit, Astro, Remix, React Router, Ember, Solid, AWS) | N for this pack: no lead here; their packages move with the release group | - | - |

Mechanical rewrites edit only the reported site. Sampling (`profilesSampleRate`,
`ignoreTransactions`), privacy (`sendDefaultPii`) and performance defaults are never changed
by rule: each is an assisted rule whose guide lists the options and requires the choice in
decisions (`sentry.test.ts` checks every options-bearing guide says so), plus a decision note
where the default itself changed.

### Compiler-blind sites

The compiler reports nothing where code reaches a removed member through `any`/`unknown`,
where an option sits after the first excess property of a literal (TS2353 reports only the
first), or in files outside the program (next.config.js, a tsconfig with `files: []`). The
syntactic detects cover what the guide names: v10 span JSON fields in `beforeSendSpan` and on
`spanToJSON` results; `sendFeedback` rejections handled as strings; integrations compared by
name; init options in any init literal, same-file const, `*Options`-typed object or function
returning one; next.config imports and build options; package.json preloads. Detection is
binding-aware: a local `init`, `withSentryConfig` from another module, or an options-shaped
object that never reaches Sentry is not a site (fixtures mark each as `keep`).

## Release group and leads

`.craft.yml` at 11.7.0 publishes every SDK package from one tag at one version: the lead is
whichever of them the repository declares, and `releaseGroup` lists the others that ship to
consumers (`meta.ts`, `LOCKSTEP`). Left out on purpose:

- `@sentry/types`, `@sentry/node-core`: no 11.x release (removed by the guide); imports are the
  `removed-modules` rule.
- `@sentry/cli`, `@sentry/webpack-plugin`, `@sentry/vite-plugin`, `@sentry/utils`: versioned on
  their own (vite-plugin 5.4.1 is current).
- `@sentry/bundler-plugins`: a craft target, but `@sentry/vite-plugin` 5.4.0/5.4.1 require it at
  `^10.64.0`/`^10.76.0`; moving it with the SDK would break them.

`requiresBuild: true` for `@sentry/nextjs` only: a next.config.js/.mjs import or build option
11 removed fails `next build`, which tsc never sees. The other leads have no build-only contract.

## Independent ground truth

Every repository is public; installs use its lockfile with scripts off; nothing from a
repository was executed, and nothing was pushed, commented or opened on any of them.
Expectations were drafted with `pnpm packs:truth` and reviewed by hand **before** the pack was
scored. Conventions applied the same way everywhere:

- Pure insertions are not sites. Each repository that kept v10's restrictive collection did it
  by inserting a `dataCollection` block: that is the `data-collection` decision. A line changed
  only to gain a trailing comma for such an insertion (xdoubleu `instrumentation-client.ts:8`,
  `sentry.edge.config.ts:6`) is part of it.
- Comment lines are not sites; a comment that changed with an option is part of that option's
  site.
- Edits that only exist to feed another change are that change's site: removed imports, the
  span-processor block and `async` keyword ActivityPub dropped with `openTelemetrySpanProcessors`,
  and downstream TS7006 errors inside the removed `instrumentation` option.

| Lead | Repository | Parent | Upgrade | Versions | Expected |
| --- | --- | --- | --- | --- | --- |
| nextjs | [cohstats/coh3-stats](https://github.com/cohstats/coh3-stats/pull/1015) | `5b9c60bd` | merge `1bb5bbb6` | 10.75.3 → 11.1.0 | next.config.js require; `disableLogger` |
| nextjs | [xdoubleu/tools.xdoubleu.com](https://github.com/xdoubleu/tools.xdoubleu.com/pull/1952) `web/` | `d3b780d4` | `4bc04eeb` | 10.75.3 → 11.0.0 | next.config.ts import (TS2305); `ignoreTransactions` |
| nextjs | [maximunited/yomu](https://github.com/maximunited/yomu/pull/245) | `228fc3e4` | `64d4a872` | 10.75.1 → 11.1.0 | next.config.ts import; 3× `sendDefaultPii` (TS2353) |
| node | [TryGhost/ActivityPub](https://github.com/TryGhost/ActivityPub/pull/2215) | `f8a82332` | `807b0642` | 10.75.3 → 11.0.0 | `openTelemetrySpanProcessors`; `instrumentation` hooks; Hono `updateName` (generic) |
| node | [frog-pond/ccc-server](https://github.com/frog-pond/ccc-server/pull/1129) | `75fdc083` | merge `4c5a9512` | 10.75.3 → 11.2.0 (+ profiling-node) | `profilesSampleRate`; `enableLogs`; `setupKoaErrorHandler` |
| react | [owine/youth-activity-scheduler](https://github.com/owine/youth-activity-scheduler/pull/502) `frontend/` | `18b467f5` | `43afc60f` | 10.75.3 → 11.0.0 | `sendDefaultPii` and its test assertion (TS2339) |
| react | [successible/cleanslate](https://github.com/successible/cleanslate/pull/584) | `5d45401e` | `b21e87ed` | 10.74.0 → 11.0.0 | none (bump only) |
| browser | [Automancer-Ltd/automancer-site](https://github.com/Automancer-Ltd/automancer-site/pull/63) | `ea78c738` | `a6ccab10` | 10.75.2 → 11.4.0 | `sendDefaultPii`; `enableLogs: false` (no diagnostic) |
| browser | [sbomify/sbomify](https://github.com/sbomify/sbomify/pull/1771) | `4c2be201` | merge `f0716c56` | 10.75.2 → 11.0.0 | `sendDefaultPii: true` (outside the compiled program) |

Parent compiles (repository TypeScript, `tsc --noEmit`): xdoubleu clean. The others report
only environment errors in files with no Sentry code, identical before and after the target is
linked: coh3-stats image module declarations from the gitignored, generated `next-env.d.ts`;
yomu TS5101 (`baseUrl` deprecated under TypeScript 6); ActivityPub `Temporal` (its TypeScript
7.0.2 has the lib, the 5.9.3 used for lack of a JavaScript API does not).

Helper artifact, not an expectation: the truth helper links `@sentry/react` outside the
consumer, so React's types do not resolve from it and `Sentry.ErrorBoundary` reports
TS2607/TS2786 in both React repositories. A real install of the target in a copy of
youth-activity-scheduler (`pnpm install --ignore-scripts --no-frozen-lockfile`, repository
pnpm 12.8.2, `@sentry/react` 11.0.0, its `tsc6`) reports exactly the two `sendDefaultPii`
errors, and neither upgrade touched `ErrorBoundary`.

### Screened out

- owine/doc-scanner #249 (`server/` @sentry/node, `pwa/` @sentry/browser): a real migration
  (`registerEsmLoaderHooks`, `ignoreIncomingRequestBody`, `sendDefaultPii`), but its pnpm
  lockfile is at the workspace root and the engine installs a `directory` from its own lockfile
  only (`UNSUPPORTED_PACKAGE_MANAGER`), as recorded for vite in packs/queue.json.
- maevsi/postgraphile #50: real (`enableLogs` removed with `@sentry/profiling-node`); not drafted,
  because the node lead already had two repositories with code changes.
- Bump-only upgrades (TryGhost/gscan, apitally-js, source-academy/frontend, element-web, ...) were
  not needed beyond one negative control per lead (cleanslate).

## Measured: `pnpm uptide pack test <lead> --write`

See the pull request for the full output of the final run.

| Lead | Repos | Breaking P / R | Overall P / R | TP / FP / FN | Status |
| --- | ---: | --- | --- | --- | --- |
| `@sentry/nextjs` | 3 | 100% / 100% | 100% / 100% | 8 / 0 / 0 | verified |
| `@sentry/browser` | 2 → 5 | 100% / 50% | 100% / 50% | 11 / 0 / 11 | verified (UPT-64, below) |
| `@sentry/react` | 2 → 14 | 88% / 72% | 88% / 72% | 21 / 3 / 8 | candidate (UPT-64, below) |
| `@sentry/node` | 2 | 67% / 80% | 71% / 83% | 5 / 2 / 1 | candidate |

Misses and why:

- ActivityPub `src/app.ts:697` (generic): the upgrade removed `Sentry.getActiveSpan()?.updateName()`
  in a Hono middleware because v11 honors a rename v10 overrode. A runtime span-name behavior
  with no compiler signal and no general syntactic rule (renaming the active span is legitimate
  elsewhere); covered only by the `span-streaming`/`also-review` decisions.

## Browser and React ground truth under the UPT-48 gate (UPT-64)

UPT-48 demoted `@sentry/browser` (3 breaking sites) and `@sentry/react` (2) to `candidate`: the
gate needs five. UPT-64 (2026-10-16) added public upgrades by the method above, with the anchor
rule docs/packs.md has had since UPT-53 applied to the new entries (the 2026-10-14 entries are
unchanged). Truth was committed before the first score with it and not touched after.

**Selection.** Every merged pull request found by searching GitHub for Sentry 11 upgrades
(titles naming `@sentry/react`/`@sentry/browser`, the monorepo, "Sentry 11"/"v11"; created after
11.0.0) whose `package.json` moves a lead from 10 to 11 next to its own lockfile, and whose diff
removes a line naming an API v11 removed or changed. All of them, not a hand-picked subset:

| Lead | Repository | Parent | Upgrade | Versions | Expected |
| --- | --- | --- | --- | --- | --- |
| react | [Seklfreak/flimm](https://github.com/Seklfreak/flimm/pull/28) `frontend/` | `e9fb0517` | `15e1e2cd` | 10.75.3 → 11.0.0 | `sendDefaultPii` |
| react | [daler91/Hyrox-Companion](https://github.com/daler91/Hyrox-Companion/pull/2102) | `77e68b5e` | merge `febc857a` | 10.75.2 → 11.1.0 | `sendDefaultPii` |
| react | [jey3dayo/ultra-rss-reader](https://github.com/jey3dayo/ultra-rss-reader/pull/346) | `9b2075e5` | `5881f217` | 10.75.0 → 11.0.0 | `sendDefaultPii` |
| react | [jirikrucek/ricochet-app](https://github.com/jirikrucek/ricochet-app/pull/33) | `f9313aca` | merge `394f65de` | 10.70.0 → 11.1.0 | `enableLogs` |
| react | [louisclarencepeter/destinationparadise](https://github.com/louisclarencepeter/destinationparadise/pull/162) | `04894de5` | merge `db318cbc` | 10.75.0 → 11.7.0 (+ node) | 2× `sendDefaultPii` |
| react | [poporonnet/kaniwriter](https://github.com/poporonnet/kaniwriter/pull/1430) | `34001942` | `8282be75` | 10.76.0 → 11.5.0 | `sendDefaultPii: true` |
| react | [preijm/milk-me-not](https://github.com/preijm/milk-me-not/pull/293) | `471ec204` | `fbc7d5f1` | 10.76.2 → 11.4.0 | `sendDefaultPii` |
| react | [CandeeGenerations/central-flock](https://github.com/CandeeGenerations/central-flock/pull/30) | `8d2155e0` | `8e221842` | 10.75.3 → 11.2.0 (+ node) | 2× `sendDefaultPii`, 2× `beforeSendTransaction`, `setupExpressErrorHandler` (TS6387) |
| react | [DougZeThug/717rec](https://github.com/DougZeThug/717rec/pull/1594) | `b4b9baa8` | merge `d70039fd` | 10.75.2 → 11.0.0 | `sendDefaultPii` |
| react | [CandeeGenerations/attendance-public](https://github.com/CandeeGenerations/attendance-public/pull/3) | `661c08b6` | merge `14350d8a` | 10.75.3 → 11.2.0 | `sendDefaultPii`, `beforeSendTransaction` |
| react | [cucumber/cucumber-reports](https://github.com/cucumber/cucumber-reports/pull/314) | `a2b50ccb` | `ec06fa57` | 10.75.3 → 11.2.0 | `enableLogs` |
| react | [Simple-With-Us/BotFleet](https://github.com/Simple-With-Us/BotFleet/pull/940) | `8ddc42a4` | `d1270b68` | 10.76.1 → 11.6.0 (+ node) | 3× `enableLogs`, 2× `sendDefaultPii`, `httpIntegration` key, 2× `queryParams`, `streamGenAiSpans`, `startNewTrace` |
| browser | [MihaelaAghirculesei/Pokedex](https://github.com/MihaelaAghirculesei/Pokedex/pull/99) | `9b48984a` | `3919a763` | 10.74.0 → 11.1.0 | `sendDefaultPii` |
| browser | [Simple-With-Us/ContactLogo](https://github.com/Simple-With-Us/ContactLogo/pull/161) `web/` | `e3ad9520` | `4df8d7d6` | 10.76.0 → 11.4.0 | `sendDefaultPii`, `enableLogs` |
| browser | [getsentry/sentry-godot](https://github.com/getsentry/sentry-godot/pull/991) `src/sentry/javascript/bridge/` | `be1c5daf` | `1b67a237` | 10.75.2 → 11.5.0 (+ core, wasm) | `sendDefaultPii`, `breadcrumbsIntegration({ console })`, `beforeSendTransaction`, 3× `Scope.clear()`, 8× `spanToStreamedSpanJSON`, 2× `getScopeData().span` |

Conventions, decided while reviewing drafts and before any score, in addition to those above:

- A test line is its own site when it calls the package directly (sentry-godot's `test.js`, a
  real `Sentry.init` in BotFleet's tests) or has a diagnostic (youth-activity-scheduler's
  TS2339). A test that asserts the options the repository's own init passes (`objectContaining`,
  `toMatchObject`, a regex over the source) only follows that source change.
- Code of a release-group package the upgrade moved with the lead (`with`) is the upgrade's code:
  `fix` moves it in the same upgrade.
- A change that compiles and behaves the same on 10 (sentry-godot retyping `options: any` as
  `BrowserOptions`, and the `orgId` and `beforeSend` annotations that retyping needed) is the
  repository's cleanup, not a site.

Screened out: argos-ci/argos, nazeeh111/WorkHarbor and element-hq/element-web (the lead in a
workspace package whose lockfile is at the root); motss-app/test-hono-react-router-vite
(`deno.lock`); trustlab-dev/blackbar (8 → 11); espoon-voltti/evaka, distr-sh/distr and
owid/owid-grapher (only `dataCollection` insertions and tag/attribute calls, no breaking site);
tiagovilasboas/sentry-golden-path (moves TypeScript 6 → 7 in the same commit). Of the issue's list,
cal.com, midday and inbox-zero declare `@sentry/nextjs` 10, rallly `@sentry/nextjs` 11 (the nextjs
lead), twenty and outline still `@sentry/react` 10, unkey neither lead.

**Measured** (`pnpm uptide pack test <lead> --write`, the full output is in the pull request):

- `@sentry/browser`: 5 repositories, 22 breaking sites, breaking precision 100%, recall 50%
  (11/22): **verified**. All 11 misses are sentry-godot: in `test.js`, the plain-JavaScript test
  outside its tsconfig, the `require` of `spanToStreamedSpanJSON` and its 7 uses and the 2
  `getScopeData().span` reads; and the block at `src/sentry-bridge.ts:261` that assigns
  `options.beforeSendTransaction` after the options literal.
- `@sentry/react`: 14 repositories, 29 breaking sites, precision 88%, recall 72%: **candidate**,
  3 false positives among breaking findings. Hyrox-Companion `server/bootstrap/observability.ts:114`
  (`sendDefaultPii` in `@sentry/node` code: `check` moves `@sentry/node` with the release group,
  the repository kept it at 10.75.2); ultra-rss-reader `src/lib/runtime/monitoring.ts:25`
  (`"InboundFilters"` in an integration allowlist, renamed in 11 and left by the upgrade);
  BotFleet `server/sentry-scrub-real-sdk.test.ts:30` (`beforeSendTransaction`, kept working by
  `traceLifecycle: "static"` inserted into the same call). Misses (8): BotFleet
  `src/lib/sentry.ts:101` (`enableLogs`) and `:102` (`sendDefaultPii`), `server/sentry.ts:558`
  (`sendDefaultPii`) and `:561` (`streamGenAiSpans`), `server/sentry-scrub-real-sdk.test.ts:32`
  (`queryParams`) and `:97` (`startNewTrace`); destinationparadise `src/utils/sentry.js:99` (TS2353
  in a JavaScript file); central-flock `server/index.ts:120` (`setupExpressErrorHandler`, TS6387).
  BotFleet's `httpIntegration` key rename (`server/sentry.ts:497`) is reported, under `generic`.

Rules no real site exercises run as assisted in `fix`: `enable-metrics`, `integration-names`,
`renamed-exports` (sentry-godot's are all misses) and `streamed-span-wrapper` for both leads;
`enable-logs` is now exercised for both.

Running these locally: corepack 0.34 cannot start pnpm 12 (it looks for `bin/pnpm.cjs`; pnpm 12
ships `bin/pnpm.mjs` and a native binary), which is why youth-activity-scheduler failed to install
locally with `MODULE_NOT_FOUND` while CI passes; a `pnpm` on `PATH` that runs pnpm 12's own
`bin/pnpm.mjs` for repositories pinning `pnpm@12` fixes it. BotFleet keeps binaries in Git LFS:
without `git-lfs` installed the checkout fails; CI runners have it.

## What the engine could not express

1. **Same-scope packages versioned on their own.** `check/companions.ts` and `list/groups.ts`
   link every installed `@sentry/*` package as one family "whatever versions its members are
   at". `@sentry/vite-plugin` 5.4.0 (youth-activity-scheduler) and the legacy `@sentry/utils`
   8.55.2 (ccc-server) then have "no release that agrees" with the SDK target, so `pack test`
   records a left-behind companion and `fix` refuses the upgrade ("cannot be installed
   consistently"). Neither real upgrade moved them, and no vite-plugin release requires
   `@sentry/bundler-plugins` ^11. A pack can declare who moves (`releaseGroup`), not who stays;
   a declared release group should bound the scope family. **Resolved:** a declared release
   group now bounds the scope, and an unrelated same-scope package stays at its version
   (reported, never a conflict). youth-activity-scheduler then plans with
   `@sentry/vite-plugin stays at 5.4.0`, and ccc-server moves `@sentry/profiling-node` and leaves
   `@sentry/utils` 8.55.2; React is registered and verified.
2. **Downstream errors of a removed option.** ActivityPub's `instrumentation` option (TS2353 at
   :51) takes away the contextual type of its hooks, so the compiler adds TS7006 at :52 and :77.
   Root-cause folding (`check/root-cause.ts`) only follows errors to a repository declaration;
   errors inside an excess property's value are not folded into it, and each stands as a
   generic breaking site (the two false positives above). `perFile` would only re-file them
   under the rule, still as separate sites.
3. **Wrapped registry entries.** `parseRegistry` (`packs/tooling/registry-file.ts`) matches
   single-line entries only; biome wraps long ones, so a later `uptide pack new` drops them.
   The four entries here were added by hand.
