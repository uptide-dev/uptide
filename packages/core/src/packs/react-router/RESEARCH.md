# React Router 6 → 7: evidence and verification limits

Read date for every source below: **2026-10-14**. Scope: `react-router` (and `react-router-dom`,
released in lockstep) from 6.x to 7.x, defaulting to 7.18.4. The queue asked for 6 → 8; the
evidence below says that is two upgrades, so this pack is 6 → 7 and `packs/queue.json` carries
7 → 8 as its own entry. No codemod was downloaded or run; no `npx` was used. reactrouter.com
and the codemod registry answer 403 through this environment's proxy, so every document is
cited from the repository at a pinned release commit (the npm tarballs ship the same files).

## Source ledger

| Tag | Commit |
| --- | --- |
| `react-router-dom@6.30.6` (latest 6.x) | `dead4962d6c33e962f266af910b7a09e3ece30cf` |
| `react-router@7.0.0` | `e8e3b004d94a949372e77ce97a543bff5bc6fb89` |
| `react-router@7.18.4` (latest 7.x) | `1b1e0b0e79b21692ce907933475233babdd16e3e` |
| `react-router@8.0.0` | `36122b36a8c183dfbe4bcd278c585a80617c921e` |
| `react-router@8.4.0` (latest 8.x) | `7ccdcecdd944e15be0cd0dcb702b86c9af1214a8` |

- [Upgrading from v6](https://github.com/remix-run/react-router/blob/1b1e0b0e79b21692ce907933475233babdd16e3e/docs/upgrading/v6.md)
  (7.18.4; same text at [7.0.0](https://github.com/remix-run/react-router/blob/e8e3b004d94a949372e77ce97a543bff5bc6fb89/docs/upgrading/v6.md)).
  It does not exist in the v8 docs: deleted by `0b66c74b1` "v8 Docs Prep" (2026-06-17).
- [v6 future flags](https://github.com/remix-run/react-router/blob/dead4962d6c33e962f266af910b7a09e3ece30cf/docs/upgrading/future.md) (6.30.6).
- [Upgrading from v7](https://github.com/remix-run/react-router/blob/7ccdcecdd944e15be0cd0dcb702b86c9af1214a8/docs/upgrading/v7.md) (8.4.0).
- [react-router CHANGELOG](https://github.com/remix-run/react-router/blob/1b1e0b0e79b21692ce907933475233babdd16e3e/packages/react-router/CHANGELOG.md),
  7.0.0 (Major Changes) through 7.18.4; 8.0.0 at [8.4.0](https://github.com/remix-run/react-router/blob/7ccdcecdd944e15be0cd0dcb702b86c9af1214a8/packages/react-router/CHANGELOG.md).
- [react-router-dom CHANGELOG](https://github.com/remix-run/react-router/blob/1b1e0b0e79b21692ce907933475233babdd16e3e/packages/react-router-dom/CHANGELOG.md)
  (7.0.0; the package directory is gone at 8.0.0) and its
  [7.0.0 entry point](https://github.com/remix-run/react-router/blob/e8e3b004d94a949372e77ce97a543bff5bc6fb89/packages/react-router-dom/index.ts):
  `export * from "react-router"` plus `HydratedRouter`, `RouterProvider` from `react-router/dom`.
- [Root CHANGELOG](https://github.com/remix-run/react-router/blob/1b1e0b0e79b21692ce907933475233babdd16e3e/CHANGELOG.md) (7.0.0 and 8.0.0 release notes).
- npm registry, 2026-10-14: `react-router` latest 8.4.0, `version-7` 7.18.4, `version-6` 6.30.6;
  `react-router-dom` latest **7.18.4** (no 8.x); `@remix-run/router` stops at 1.23.4.

## One upgrade or two

Two: 6 → 7, then 7 → 8.

1. There is no 6 → 8 guide. The v6 guide ends at v7 ("Congratulations, you're now on v7!") and
   was removed from the v8 docs; the v8 guide is "Upgrading from v7" and starts with "update to
   the latest minor version of v7.x".
2. Each guide's premise is the previous major's flags adopted on that major: "The v7 upgrade has
   no breaking changes if you have enabled all future flags" (v6 guide); "By adopting all opt-in
   APIs and future flags while still on v7, you should be able to update to React Router v8 with
   minimal changes" (v7 guide).
3. The six v6 flags can be adopted one at a time only on 6.x: 7.0.0 removes the `future` props
   and makes the option keys inert. A jump to 8 applies them all at once, unflagged.
4. Some v8 fixes need 7.x APIs: `match.loaderData` exists from 7.8.0, `RouterContextProvider`
   from 7.9.0.
5. `react-router-dom` has no 8.x: v7 keeps it as a re-export to ease the v6 upgrade, v8 removes it.

7 → 8 (React 19.2.7 and Node 22.22 minimums, ESM only, middleware always on and `context` typed
`Readonly<RouterContextProvider>`, `UIMatch.data` → `loaderData`, `hasErrorBoundary` removed,
`react-router-dom` removed, stale `future` keys rejected from 8.4) is queued separately.

## Classified changes (6 → 7)

**M** = mechanical rule (rewrites a reported site, safe whatever the surrounding code is);
**A** = assisted rule (a guide for the agent; options go to "Decisions for you"). A rule whose
edit is safe but that no ground-truth repository exercises yet stays **A** until one does
(marked *A, rewrite ready*): detection unchanged, the edit unit-tested but not wired;
**B** = behavior note (`decision`, scoped by `applies()` with evidence from the inventory);
**N** = not compiler-visible and no action, or not applicable to v6 code.

| Change | Compiler | Class and treatment | Source |
| --- | --- | --- | --- |
| `react-router-dom` folded into `react-router`; v7 `react-router-dom` re-exports it, v8 removes it | no (on 7) | M `dom-imports` (deprecated): the module specifier only; declined when a test mocks `react-router-dom` by name (jest/vi mock, requireActual/importActual, `__mocks__/react-router-dom`), since the mock would stop applying | guide "Upgrade to v7", root CHANGELOG 7.0.0 |
| `RouterProvider`/`HydratedRouter` for DOM apps come from `react-router/dom` (wired to `flushSync`); the main entry's is for non-DOM code and tests | no | A `dom-entry-imports` (deprecated): also namespace and `export *` imports of `react-router-dom`. Not mechanical: `react-router/dom` needs `moduleResolution` bundler/node16/nodenext (Phoenix changed its tsconfig in the same commit) | guide, CHANGELOG 7.0.0 (#11851) |
| `react-router-dom/server` removed from the exports map (even with `react-router-dom` 7); its 7 names are in `react-router` | TS2307 | *A, rewrite ready* `dom-server-entry`: the specifier only | exports map of `react-router-dom@7`; not in the guide |
| `future` prop removed from BrowserRouter, HashRouter, (unstable_)HistoryRouter, MemoryRouter, Router, StaticRouter, RouterProvider | TS2322 | *A, rewrite ready* `future-prop`: the edit removes an inline object of `v7_*` boolean literals only, the router resolved through its import (aliases included); a variable (Lago's shared `ROUTER_FUTURE_FLAGS`) or computed value would stay with the agent, who removes what only fed it. Not wired: the final truth's only sites (Lago's) pass a variable | CHANGELOG 7.0.0 (flag removals) |
| The same prop passed through untyped props (`createElement(actual.BrowserRouter, { future, ...props })` in a jest mock) | no: the props are untyped | A `future-prop-untyped` (deprecated): syntactic detect of `createElement` on a router (imported, aliased or `x.BrowserRouter`) with a `future` key; v7 ignores the prop, so the site compiles and does nothing (Lago's own comment says so) | CHANGELOG 7.0.0 |
| `future` option of createBrowserRouter/HashRouter/MemoryRouter/StaticRouter/StaticHandler | no: v7 types it `{}` (TS2353 only from 8.4) | *A, rewrite ready* `future-option` (deprecated): inline v6 flag literals only; the options argument goes when it held only `future` | CHANGELOG 7.0.0, 8.4.0 |
| `json` / `JsonFunction` removed | TS2305 at the import; calls through the failed import are `any` | A `removed-json`: the import from the compiler, each call from syntax (`detect`, binding-aware, shadowed locals excluded). Options: return the value, `data(value, init)`, or `Response.json` | guide "json/defer", CHANGELOG 7.0.0 (#12146) |
| `defer`, `AbortedDeferredError`, `TypedDeferredData`, `UNSAFE_DeferredData`, `UNSAFE_DEFERRED_SYMBOL` removed | TS2305; calls and `instanceof` invisible | A `removed-defer`, same detection; raw promises are not aborted on navigation | guide, CHANGELOG 7.0.0 (#11744) |
| `Hash`, `Pathname`, `Search` (aliases of string), `V7_FormMethod`, `FutureConfig`, `UNSAFE_useRouteId` removed | TS2305/2724/2459 | A `removed-exports` | CHANGELOG 7.0.0 (#11840), export diff |
| `generatePath` param types (7.14.2): a required `:param` takes `string`, `null` is rejected (it threw at runtime); optional params may be omitted, extra keys allowed | TS2322 at the param | A `generate-path-params`: claims the compiler's `null … not assignable to type 'string'` at the param (the message never names generatePath) and the type diff of `generatePath`. Options (guard before building the path, an optional segment, or the proven value) are a decision; no non-null assertion or empty-string fallback | CHANGELOG 7.14.2 |
| `formMethod` always uppercase (`v7_normalizeFormMethod`) | TS2367/2678/2820 only where typed | *A, rewrite ready* `form-method-case`: comparisons and `case` clauses of a `.formMethod` read with a lowercase literal, in files importing React Router; found by syntax too, because through `any`/`string` the compiler is blind. `<Form method="post">` is untouched | guide, CHANGELOG 7.0.0 (#11697) |
| `<RouterProvider fallbackElement>` removed (`v7_partialHydration`) | TS2322 | A `fallback-element` → `HydrateFallback`/`hydrateFallbackElement`; B `partial-hydration` | guide, CHANGELOG 7.0.0 (#11725) |
| `unstable_dataStrategy`, `unstable_patchRoutesOnNavigation` (pre-6.28 names) | TS2353 | A `stabilized-options`; B `data-strategy` | CHANGELOG 6.28.0, 7.0.0 |
| `v7_relativeSplatPath` default | no | B `relative-splat-path`: applies when a multi-segment splat path exists and no setup enables the flag; options (extra `..` or split route) are a decision | guide |
| `v7_startTransition` default | no | B `start-transition`: routers without the flag | guide |
| `v7_fetcherPersist` default | no | B `fetcher-persist`: `useFetcher(s)` without the flag | guide |
| `v7_normalizeFormMethod` default | partly | B `normalize-form-method` plus the rule above | guide |
| `v7_skipActionErrorRevalidation` default | no | B `skip-action-error-revalidation`: route actions without the flag; options (validate first, or `shouldRevalidate`) are a decision | guide |
| navigate/submit/fetcher.load/submit/revalidate return promises | only where typed `void` | B `navigation-promises`: when an ESLint config enables no-floating/no-misused-promises | CHANGELOG 7.0.0 (#11521) |
| React 18 and Node 20 minimums | no | B `platform-minimums`: package.json react/engines, `.nvmrc`, `.node-version` | guide, CHANGELOG 7.0.0 |
| `@remix-run/router` folded in, no v7 release (`Router` → `DataRouter`, `Action` → `NavigationType`, history factories internal) | TS2305 when imported | B `remix-router-package`: declared or imported | CHANGELOG 7.0.0 (#11840) |
| `react-router-dom` dependency kept only as a re-export | no | B `dom-package`: declared in a package.json | react-router-dom 7.0.0 entry |
| `useFetcher<Data>` should become `useFetcher<typeof loader>`; `useLoaderData` is generic and returns `any` by default | no (still compiles) | N; optional adoption (Phoenix did it; excluded from its ground truth) | CHANGELOG 7.0.0 (#12180) |
| `v7_prependBasename`, `v7_throwAbortReason`, Remix-only renames (`createRemixStub`, `RemixContext`, `installGlobals`) | no | N for v6 code | CHANGELOG 7.0.0 |
| `react-router-native`, `react-router-dom-v5-compat` have no v7 | n/a | N, out of scope (the pack does not remove packages) | root CHANGELOG 7.0.0 |
| 7.x minors: 7.5.1 static handler loaderData, 7.8.0 `UIMatch.data` deprecated, 7.15.0 `useTransitions`, 7.18.0 data-mode SSR error serialization | some | `also-review` decision; generic compiler findings | CHANGELOG 7.5.1–7.18.0 |

No framework mode is introduced and no route structure is changed: the instructions forbid
both, and no rule edits route definitions.

### Mechanical boundaries

- `dom-imports` changes only the specifier of an import or re-export whose names all live in
  `react-router`. It is `deprecated` (v7 still works with `react-router-dom`), so `fix` applies it
  with `--include-deprecated`. The release group keeps both packages at the same exact version,
  so a file that still imports `react-router-dom` shares the router context with one that moved.
- `dom-imports` runs as assisted (UPT-96, 8% precision over 365 sites). No narrower match keeps
  the 29 true positives and drops the noise: Phoenix moved its imports and Lago kept all 335 of
  its, and the two look alike in the source (same specifier, same names, all in `react-router`).
  The only difference is a decision about the dependency, which a file does not show.
- Rewrites ready but not wired until ground truth exercises them: `future-prop` (removes only
  v6 flag literals, which v7 ignores whatever their value, the behavior they stood for being in
  the flag notes; a leading comment on the property declines it). The two inline-literal
  upgrades seen, wire-webapp and OpenMetadata, are out of the truth under the parent rule below,
  and Lago's four sites pass a variable. Also `dom-server-entry` (the
  specifier), `future-option` (the same literal-only removal as `future-prop`),
  `form-method-case` (uppercase the literal compared with a `.formMethod` read: v7 never produces
  lowercase). Their detection runs; `react-router.test.ts` keeps each edit tested.
- `json` and `defer` were never mechanical. They, the RouterProvider entry, `fallbackElement`,
  `generatePath` params and stabilized options all have options or cross-file consequences:
  assisted, and the agent is told to put its choice in decisions (the SDK agent prompt already
  turns guide options into "Decisions for you").

## Release group and peers

`react-router-dom` is the declared `releaseGroup` member: it is published at every
`react-router` 7 version and pins it exactly (7.x CHANGELOG; its 7.0.0 entry point re-exports
`react-router`). It is also the pack's **alternate lead** (#134): most v6 applications declare
only `react-router-dom`, so `check react-router` and `check react-router-dom` both run this pack
there, analyzing `react-router` at the version `react-router-dom` installs (hoisted, or beside it
in a pnpm store), and `fix` declares `react-router` at the target beside it before moving both.
`react-router-dom` is moved, not removed: v7 keeps it as a re-export and code still imports it;
removal belongs to the 7 → 8 upgrade (`dom-package` says so). Every upgrade drafted moved it with
the lead (Lago, and the excluded wire-webapp and OpenMetadata, to the same version; Phoenix
removed it). `@types/react-router-dom` is a v5-era stub nothing at v6 needs and is not
declared. `@react-router/*` packages are framework-mode tooling with no 6.x release, so no v6
repository has one installed: nothing to declare. `requiresBuild` is not set: the changes the
compiler cannot see are runtime behavior (flags), not build contracts; the one build-visible
change, `react-router/dom` under `moduleResolution: node`, is a type error tsc reports.

## Independent ground truth

**Final truth: Arize-ai/phoenix and getlago/lago-front.** Both are public, at the parent of a
merged upgrade; installs use their lockfiles with scripts off. Expectations were drafted with
`pnpm packs:truth` (repository TypeScript, target linked) and the upgrade diff, then reviewed by
hand before the pack was scored against them; no expected finding was changed after scoring.
`ground-truth.json`'s `$comment` records every inclusion and exclusion.

| Repository | Declares | Parent | Upgrade | Versions | Expected |
| --- | --- | --- | --- | --- | --- |
| [Arize-ai/phoenix](https://github.com/Arize-ai/phoenix/pull/6896) (`app/`, pnpm, TS 5.4.5) | both | `4d6c1dfb01e9406cf769efab14f0350ea2d0a0f8` | `3e9dc43bcc686e8ff3d57a028a9fcc15f3935490` | 6.25.1 → 7.4.0 | 29 `dom-imports`, 1 `dom-entry-imports` (no compiler diagnostic) |
| [getlago/lago-front](https://github.com/getlago/lago-front/commit/6055a5a3c8076522235fe2da452a209e99af8541) (pnpm, TS 6.0.3) | react-router-dom only | `84aa05d535edc326a4d104923e4e7293d1be6646` | `6055a5a3c8076522235fe2da452a209e99af8541` | 6.30.6 → 7.18.3 | 6 `future-prop` (4 typed, 2 untyped in a deleted jest mock), 8 `generate-path-params`, 1 `removed-exports` (`FutureConfig`), 3 `generic` (TS1192 default import; two test assertions v7 behavior breaks) |

Lago is the usual v6 setup, which only the alternate lead makes analyzable, and holds every
expectation under a breaking rule. Exclusions within the two, decided before scoring:

- Phoenix's `useLoaderData() as T` → `useLoaderData<typeof loader>()` refactor (v7 compiles the
  casts), its vite changes; merged imports where an existing `react-router` line only absorbed a
  moved name (the moved `react-router-dom` line is the site).
- Lago: renamed test titles and added assertions, a jest filter for a warning v7 no longer emits,
  Cypress flow edits, callers of the deleted mock helper and imports of the deleted flags, wallet
  `as string` casts the refactor removed though they compile, and four TS7006 in
  `InvoiceOverview.tsx` the draft reported and the upgrade never touched (linked-environment
  React types, as in the Next pack's RESEARCH).

### Parents that do not type-check

One rule, applied to every drafted repository before scoring: run the parent's **own project
compile** (its type-check script and tsconfig, not a bare `tsc`). A parent whose compile passes
is kept. A parent whose compile fails is excluded, as the Next pack excluded its broken parents,
unless every error comes from an unbuilt workspace package that the upgrade does not touch; that
is shown by building the package as the repository's own build does and compiling again, and
the repository is kept with a note saying so.

| Repository | Project compile at the parent | Errors | Outcome |
| --- | --- | ---: | --- |
| Arize-ai/phoenix | `tsc --noEmit` in `app/` (its `typecheck` script) | 0 | **kept** |
| getlago/lago-front | `node scripts/check-types.js` (`tsc --noEmit --incremental`, root `tsconfig.json`) | 188 | **kept, confined**: every error is in a file importing `lago-design-system`, whose `dist/types` is not built at a fresh install (TS2307 and its cascade; 0 elsewhere). The package is not part of the upgrade. With its declarations emitted as its build does (`tsc --build tsconfig.build.json` in `packages/design-system`), the parent compiles with 0 errors, the upgrade commit with 0, and the parent's code against the upgrade's dependencies reports exactly the 14 compiler sites in the truth (same files, lines and codes, none missing, none extra). Five files the upgrade edits carry design-system errors while it is unbuilt; that changes no expectation |
| wireapp/wire-webapp ([#22299](https://github.com/wireapp/wire-webapp/pull/22299), 6.30.6 → 7.18.0) | `tsc --project apps/webapp/tsconfig.type-check.json --noEmit` (its Nx `type-check` target) | 1979 | **excluded**: besides eight unbuilt workspace libraries (`@wireapp/api-client` 846, `react-ui-kit` 316, …), 140 errors come from `Components/icon`, a gitignored module generated by `bin/generate_react_icons.ts`, not a workspace package; and `testUtil.tsx`, which the upgrade edits, has 5 errors |
| open-metadata/OpenMetadata ([#31641](https://github.com/open-metadata/OpenMetadata/pull/31641), 6.30.4 → 7.18.1) | `yarn tsc:check` (`tsc --noEmit`, the UI directory's tsconfig) | 1481 | **excluded**: beyond the unbuilt `@openmetadata/ui-core-components`, it reports errors unrelated to any package build (TS6133 unused locals, TS2556 spread arguments, `ThreadType` TS2322), and `AppRoot.tsx`, which the upgrade edits, has a TS2307 |

Both excluded repositories were drafted and reviewed before the rule was set; their review
still informs the pack (below) but they are not scored. OpenMetadata's sixteen TS2322 in
`EntityVersionPage.component.tsx` were checked with a real scripts-off install of
`react-router-dom@7.18.1` and the repository's own `tsc`: the same sixteen exist at the parent and
only their text changes (`backHandler: () => void` becomes `() => void | Promise<void>` with v7's
navigate). Keyed on the message, the draft listed them as new and `check` reported one as a
breaking site; that is fixed in the engine by #141 (stacked under this PR): an error at the same
file, code and position whose chain of messages is unchanged once the type expressions it
prints are masked is pre-existing; a chain naming another member there is still reported.

### Screened out

- **jeffvli/feishin** `2504c0ec…` → `bf75dec0…` (6.30.1 → 7.9.4, ~40 import moves and a HashRouter
  `future` prop): its lockfile is out of sync at the parent and the unfrozen install needs a
  git-hosted dependency from codeload.github.com, which this environment's egress policy refuses
  (403). Worth adding where that host is reachable.
- **medusajs/medusa** `a2d800c8…` → `5105fec2…` (`json` ×9 and `defer` ×1 removed, which would
  exercise `removed-json`/`removed-defer`): the upgrade is one 79-file commit with a Vite 7
  migration across the monorepo, and the dashboard has no lockfile of its own. A candidate for
  the next round; the two rules stay assisted meanwhile.
- **twentyhq/twenty** (3 sites), **Kong/insomnia** (one `defer`; git-hosted dependencies),
  **coder**, **actual** (git dependency), **shlink**, **keycloak**, **medplum**: few or no
  compiler-visible sites, or mixed/unfetchable upgrades.
- marmelab/atomic-crm #94 and react-admin #10440: version bumps with no router code changes,
  mixed with dozens of unrelated bumps; mui/toolpad #4553: docs workspace only.

## Measured `pack test`

`pnpm uptide pack test react-router --write` on the final truth (Phoenix and Lago):
**verified** (2 public repositories, 0 breaking false positives, fixtures 9 cases and 29 sites
passing).

| Rule / scoring group | Precision | Recall | TP | FP | FN |
| --- | ---: | ---: | ---: | ---: | ---: |
| dom-entry-imports | 100% | 100% | 1 | 0 | 0 |
| dom-imports | 8% | 100% | 29 | 336 | 0 |
| future-prop | 100% | 67% | 4 | 0 | 2 |
| future-prop-untyped | 0% | n/a | 0 | 2 | 0 |
| generate-path-params | 100% | 100% | 8 | 0 | 0 |
| generic | 100% | 33% | 1 | 0 | 2 |
| removed-exports | 100% | 100% | 1 | 0 | 0 |
| Overall sites | 12% | 96% | 46 | 336 | 2 |
| Breaking sites | 100% | 88% | 14 | 0 | 2 |

- The 336 `dom-imports` false positives are `deprecated` import moves the upgrades did not make:
  Lago's commit kept all 335 of its `react-router-dom` imports (v7 still serves them), and
  Phoenix kept one (`ProjectsPage.tsx:16`). The rule is right that they can move, and the truth
  is right that the upgrade did not need them; `fix` applies the move only with
  `--include-deprecated`.
- The two `future-prop` misses are Lago's `routerFutureMock.ts:12` and `:14`, found but filed
  under `future-prop-untyped` (deprecated: v7 ignores a prop passed through untyped
  `createElement`), so they also count as the two `future-prop-untyped` false positives. The truth
  files them as `future-prop` because the upgrade deleted them for the same reason; the pack
  keeps them `deprecated` since nothing fails to compile or run there.
- The two `generic` misses are test assertions v7 behavior changes (`generatePath` escaping in
  `utils.test.tsx:348`, Link href normalization in `Link.test.tsx:94`): runtime behavior with no
  compiler site and no syntax to match (engine limit 7 below).
- Every other rule has no site in the final truth and is covered by fixtures and unit tests only.
  The compile-signal fix (#141) changes nothing here: scored without it, the final truth gives
  the same findings (it only mattered for OpenMetadata, now excluded).

## What the engine could not express

1. ~~A lead installed only transitively~~: resolved by alternate leads (#134). `check
   react-router` answered "not a dependency" for a repository that declares only
   `react-router-dom`.
2. **Ground truth in a monorepo workspace without its own lockfile** fails with
   `UNSUPPORTED_PACKAGE_MANAGER`: the installer runs in `directory`, not at the lockfile's root.
3. **A package the upgrade removed** (`react-router-dom` in Phoenix) cannot be expressed in
   `packs:truth`/`with`; it was linked at the target version instead, which is the install `fix`
   would produce. `packs:truth` also leaves out the lines of a file the upgrade deleted (Lago's
   `routerFutureMock.ts`), and keys new diagnostics on their message, so an error the upgrade
   only rewords is listed as new (OpenMetadata); `check` did the same until #141.
8. **A parent whose own compile needs a build step** (Lago's design system) is scored unbuilt:
   the ground-truth installer runs scripts off and builds nothing, so errors from the unbuilt
   package are in both the baseline and the target and cancel out. Lago's built-world check
   above shows they hide no expectation there; a repository where they did would be excluded.
4. **Fixtures cannot mark a detected site whose rewrite declines** (`keep` means neither), so
   movable and non-movable `react-router-dom` imports are two rules, and so are typed and untyped
   `future` props.
5. **Flag adoption per router**: `applies()` sees the inventory as text, so a flag enabled in one
   router setup silences its note for the whole repository.
6. A compiler error on a line that also holds an unrelated type-diff usage can be filed under
   that usage's symbol instead of the claiming rule (seen in a synthetic probe, not in the truth).
7. Behavior that only tests observe (generatePath escaping, Link href normalization, the
   transition opt-out) has no finding to attach to: notes are decisions, not sites, so these
   remain `generic` misses.
