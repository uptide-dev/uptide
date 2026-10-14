# Next 15 → 16: evidence and verification limits

Read date for every source below: **2026-10-13**. Scope: stable Next 15 to stable Next 16,
including 16.4.0. Rebased onto main after #115–#117 (0.11.2). The unchanged two-repository gate now passes; remaining coverage limits are documented below.
No engine implementation changes are part of this pack.

## Source ledger

- [Next 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16).
- [Next 16 launch](https://nextjs.org/blog/next-16).
- Release notes: [16.0.0](https://github.com/vercel/next.js/releases/tag/v16.0.0),
  [16.1.0](https://github.com/vercel/next.js/releases/tag/v16.1.0),
  [16.2.0](https://github.com/vercel/next.js/releases/tag/v16.2.0),
  [16.3.0](https://github.com/vercel/next.js/releases/tag/v16.3.0),
  [16.4.0](https://github.com/vercel/next.js/releases/tag/v16.4.0).
- Minor announcements: [16.1](https://nextjs.org/blog/next-16-1),
  [16.2](https://nextjs.org/blog/next-16-2), [16.3](https://nextjs.org/blog/next-16-3),
  [16.4](https://nextjs.org/blog/next-16-4).
- [Official codemod catalog](https://nextjs.org/docs/app/guides/upgrading/codemods).
  Source inspected at **v16.4.0**, not a floating `latest` or `canary`:
  [async request APIs](https://github.com/vercel/next.js/tree/v16.4.0/packages/next-codemod/transforms/lib/async-request-api),
  [middleware-to-proxy](https://github.com/vercel/next.js/blob/v16.4.0/packages/next-codemod/transforms/middleware-to-proxy.ts),
  [next-lint-to-eslint-cli](https://github.com/vercel/next.js/blob/v16.4.0/packages/next-codemod/transforms/next-lint-to-eslint-cli.ts),
  [experimental turbo](https://github.com/vercel/next.js/blob/v16.4.0/packages/next-codemod/transforms/next-experimental-turbo-to-turbopack.ts),
  [remove-experimental-ppr](https://github.com/vercel/next.js/blob/v16.4.0/packages/next-codemod/transforms/remove-experimental-ppr.ts),
  [remove-unstable-prefix](https://github.com/vercel/next.js/blob/v16.4.0/packages/next-codemod/transforms/remove-unstable-prefix.ts),
  [cache-components-instant-false](https://github.com/vercel/next.js/blob/v16.4.0/packages/next-codemod/transforms/cache-components-instant-false.ts),
  [remove-partial-prefetch](https://github.com/vercel/next.js/blob/v16.4.0/packages/next-codemod/transforms/remove-partial-prefetch.ts).
- [Image priority](https://nextjs.org/docs/app/api-reference/components/image#priority),
  [revalidateTag semantics](https://nextjs.org/docs/app/api-reference/functions/revalidateTag).
- Published manifests: [next 16.0.0](https://registry.npmjs.org/next/16.0.0),
  [next 16.4.0](https://registry.npmjs.org/next/16.4.0),
  [next-i18next 15.4.2](https://registry.npmjs.org/next-i18next/15.4.2),
  [next-i18next 15.4.3](https://registry.npmjs.org/next-i18next/15.4.3),
  [eslint-config-next 16.4.0](https://registry.npmjs.org/eslint-config-next/16.4.0),
  [eslint plugin](https://registry.npmjs.org/@next/eslint-plugin-next/16.4.0),
  [bundle analyzer](https://registry.npmjs.org/@next/bundle-analyzer/16.4.0),
  [MDX](https://registry.npmjs.org/@next/mdx/16.4.0),
  [third parties](https://registry.npmjs.org/@next/third-parties/16.4.0).
- [Release publisher](https://github.com/vercel/next.js/blob/v16.4.0/scripts/publish-release.js)
  and [fixed-version release configuration](https://github.com/vercel/next.js/blob/v16.4.0/lerna.json).

## Classified changes

Each row links its source, read on the date above. **T** = type-visible rule; **M** =
mechanical rule; **C** = configuration/file convention decision; **R** = runtime/build
review decision. Deprecations and opt-in features are labeled separately from removals.
TypeScript can report some typed config properties as generic findings; that is not proof
that a pack can discover every config file or safely edit it.

| Change | Class and treatment | Source |
| --- | --- | --- |
| Synchronous cookies, headers, draftMode removed; UnsafeUnwrapped casts no longer valid | T `async-request-apis`, assisted await/caller propagation; no unsafe cast fallback | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#async-request-apis-breaking-change) |
| App Router params/searchParams must be awaited or unwrapped with React.use | T when generated route types diagnose it; otherwise R `metadata-promises`. Never change Pages Router context/query | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#async-request-apis-breaking-change) |
| Metadata image params and id become promises; generateImageMetadata params stay synchronous | R `metadata-promises`; local annotations alone may pass tsc | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#async-parameters-for-icon-and-open-graph-image-breaking-change) |
| sitemap id becomes Promise<string> | R `metadata-promises`; await and review numeric conversion | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#async-id-parameter-for-sitemap-breaking-change) |
| revalidateTag second argument required in declarations | T `revalidate-tag-profile`, binding-aware detection, **no rewrite**; freshness decision first | [API](https://nextjs.org/docs/app/api-reference/functions/revalidateTag) |
| unstable_cacheLife/cacheTag stabilize (not unstable_cache) | M `stable-cache-exports`, deprecated named imports; aliased imports only, preserve local names | [codemod](https://github.com/vercel/next.js/blob/v16.4.0/packages/next-codemod/transforms/remove-unstable-prefix.ts) |
| unstable_rootParams removed | T `removed-root-params`; generated replacement availability depends on target minor | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#unstable_rootparams) |
| AMP, useAmp, next/amp, route config.amp and next.config amp removed | T import diagnostic `removed-amp`; C `removed-options`; redesign required | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#amp-support) |
| next/config, serverRuntimeConfig/publicRuntimeConfig removed | T `removed-runtime-config`; C `removed-options`; preserve runtime evaluation and secret visibility | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#runtime-configuration) |
| next lint removed; build stops linting; next.config eslint removed | C `lint-removal`; scripts and lint gate require explicit replacement | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#next-lint-command) |
| ESLint plugin/config defaults to flat config | C `lint-removal`, companion migration; not a TS source rewrite | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#eslint-flat-config) |
| devIndicators appIsrStatus/buildActivity/buildActivityPosition removed | C `removed-options`; indicator itself remains | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#devindicators-options) |
| experimental.turbo moves to turbopack | C `config-conventions`; import-only discovery misses untyped config | [codemod](https://github.com/vercel/next.js/blob/v16.4.0/packages/next-codemod/transforms/next-experimental-turbo-to-turbopack.ts) |
| turbo minify/treeShaking/sourceMaps become turbopackMinify/turbopackModuleFragments/turbopackSourceMaps; memoryLimit and turbopackMemoryLimit removed | C `config-conventions`, exact codemod mapping, not blind object rename | [codemod](https://github.com/vercel/next.js/blob/v16.4.0/packages/next-codemod/transforms/next-experimental-turbo-to-turbopack.ts) |
| reactCompiler promoted to top level, opt-in | C `config-conventions`; do not enable it | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#react-compiler-support) |
| experimental.ppr and route experimental_ppr removed | C/R `cache-components`; cannot silently switch programming models | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#partial-prerendering-ppr) |
| experimental.dynamicIO and useCache removed | C/R `cache-components`; remove unused flags or deliberately adopt cacheComponents | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#experimentaldynamicio-and-experimentalusecache) |
| middleware filename/export deprecated in favor of proxy | C `middleware-proxy`; inventory detection and transactional exported-function rename; **deprecation, not a removal** | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#middleware-to-proxy) |
| Proxy runs only on Node; Edge middleware cannot be blindly renamed | R `middleware-proxy`; retain middleware for Edge | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#middleware-to-proxy) |
| middlewarePrefetch, middlewareClientMaxBodySize, externalMiddlewareRewritesResolve, skipMiddlewareUrlNormalize renamed; NextMiddleware/MiddlewareConfig type names also migrate | C `middleware-proxy`; coordinated change deferred | [codemod](https://github.com/vercel/next.js/blob/v16.4.0/packages/next-codemod/transforms/middleware-to-proxy.ts) |
| Local image src query strings require localPatterns.search | C/R `image-defaults`; no silent security relaxation | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#local-images-with-query-strings-breaking-change) |
| Image minimumCacheTTL 60 → 14400 seconds | R `image-defaults` | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#minimumcachettl-default-breaking-change) |
| Image default sizes drop 16 | R `image-defaults` | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#imagesizes-default-breaking-change) |
| Image qualities allowlist defaults to [75]; direct unsupported q returns 400 | C/R `image-defaults` | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#qualities-default-breaking-change) |
| Local IP image optimization blocked | R `image-defaults`; private-network exception requires review | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#local-ip-restriction-breaking-change) |
| Image redirects unlimited → maximum 3 | R `image-defaults` | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#maximum-redirects-breaking-change) |
| legacy/image and images.domains deprecated | C/R `image-defaults`; security and component behavior review | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#nextlegacyimage-component-deprecated) |
| Image priority deprecated | T `image-priority`, loading/preload decision at wrapper root | [API](https://nextjs.org/docs/app/api-reference/components/image#priority) |
| Turbopack defaults for dev/build; webpack configuration may cause build failure | R `turbopack-default`; choose migration or --webpack | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#turbopack-by-default) |
| Turbopack lacks Sass ~ imports and webpack fallback semantics; Sass loader modern API | R `turbopack-default`; review styles, loaders, plugins and client Node imports | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#sass-node_modules-imports) |
| Node >=20.9.0, TypeScript >=5.1.0; Chrome/Edge/Firefox >=111, Safari >=16.4 | R `platform-minimums`, both routers | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#nodejs-runtime-and-browser-support) |
| App Router includes React canary/19.2 features; Pages accepts React 18 | R `peers`; use published peer ranges, not mandatory latest React | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#react-192) |
| Prefetch layout deduplication/incremental requests | R `routing-build`; request counts change | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#enhanced-routing-and-navigation) |
| Parallel route slots require explicit default files | C/R `routing-build`; choose null or notFound, transactional creation is available, but the application must choose the intended fallback | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#parallel-routes-defaultjs-requirement) |
| Smooth scroll no longer overridden without data-scroll-behavior | R `routing-build`; CSS/HTML coordination | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#scroll-behavior-override) |
| Dev output .next/dev and process locks; build size/First Load JS metrics removed | R `routing-build`; inspect CI/output consumers | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#concurrent-dev-and-build) |
| next dev config loads in child; process.argv dev detection changes | R `routing-build`; use phase or NODE_ENV deliberately | [guide](https://nextjs.org/docs/app/guides/upgrading/version-16#next-dev-config-load) |

### Minor-version and experimental changes

These also require review when jumping from 15 to a later 16.x; they are not universal
16.0 rewrites. Release notes include internal refactors and bug fixes, which are not public
migration rules. In particular, a removal of an internal server struct is not a user API.

| Change / scope | Treatment | Source (read 2026-10-13) |
| --- | --- | --- |
| 16.0 cacheLife/cacheHandlers move out of experimental; enablePrerenderSourcemaps stabilizes; turbopack.moduleIds moves under experimental | C `minor-config`, inspect exact target types | [16.0 notes](https://github.com/vercel/next.js/releases/tag/v16.0.0) |
| 16.1 clientSegmentCache flag removed; dev filesystem cache stable/default | C/R `minor-config`; version-specific caching | [16.1 notes](https://github.com/vercel/next.js/releases/tag/v16.1.0), [announcement](https://nextjs.org/blog/next-16-1) |
| 16.2 adapterPath top-level; browser log forwarding stabilizes; devCacheControlNoCache removed; unstable_prefetch → unstable_instant during experimental adoption | C/R `minor-config`; do not enable new features | [16.2 notes](https://github.com/vercel/next.js/releases/tag/v16.2.0) |
| 16.3 Cache Components / partial prefetch adoption: instant=false codemod, remove route prefetch='partial' only after global opt-in | C/R `cache-components`; not safe baseline deletion | [codemods](https://nextjs.org/docs/app/guides/upgrading/codemods#163) |
| 16.4 appNewScrollHandler removed; agentUpgrade no longer accepts true; Turbopack shared runtime/CJS tree shaking/export mangling defaults; ensureStatic stabilized | C/R `minor-config`; preserve build and navigation behavior through actual build verification | [16.4 notes](https://github.com/vercel/next.js/releases/tag/v16.4.0) |

The async codemod is **not** wholesale ported: its Next 15 UnsafeUnwrapped fallback cannot
be used for 16, and async propagation changes caller contracts. The only mechanical port
is the named-import branch of remove-unstable-prefix. It changes the imported name while
keeping the alias, even `cacheTag as cacheTag`, to avoid editing local references or comments.
Unaliased imports stay assisted. The source detector uses syntax and binding identity,
not a text search for similarly named functions. No codemod was executed or downloaded
as an executable; no `npx` command was run.

## Companions and peers

Published `next@16.0.0` and `next@16.4.0` both declare **react and react-dom**:

```text
^18.2.0 || 19.0.0-rc-de68d2f4-20241204 || ^19.0.0
```

Other declared peers are `sass ^1.3.0`, `@playwright/test ^1.51.1`,
`@opentelemetry/api ^1.1.0`, and `babel-plugin-react-compiler *` (optional integrations).
The Node engine is `>=20.9.0`. The TypeScript minimum comes from the upgrade guide, not
an invented Next peer entry.

Declared `releaseGroup` members: eslint-config-next, @next/eslint-plugin-next,
@next/bundle-analyzer, @next/mdx, @next/third-parties. These are fixed-version release
packages, with official codemod/release sources in metadata. Next's own @next/env and
platform @next/swc packages are exact dependencies/optional dependencies; do not add
all platforms to a consumer. Other directly installed @next packages need release-group
entries rather than an unbounded wildcard package name.

`eslint-config-next@16.4.0` peers on `eslint >=9.0.0` and `typescript >=3.3.1` and pins
`@next/eslint-plugin-next 16.4.0`; it does **not** peer on Next. Neither bundle-analyzer nor
the ESLint plugin declares a Next peer. @next/mdx peers on the MDX packages, not Next.
@next/third-parties accepts `^13.0.0 || ^14.0.0 || ^15.0.0 || ^16.0.0` for Next.
The release-group planner introduced in #115 now moves these installed packages even without a Next peer edge.

Both **next-i18next 15.4.2 and 15.4.3 accept Next `>= 12.0.0`**, React `>= 17.0.2`,
i18next `>= 23.7.13`, and react-i18next `>= 13.5.0`. BoxyHQ currently declares 15.4.3.
Do not report a peer incompatibility that the published manifest does not express.
`peers.test.ts` checks that exact permissive range and a separately labeled synthetic
plugin requiring Next ^15. The latter must stop npm publication during preflight.
Existing engine tests also cover peer reporting on pnpm/Yarn; making every such conflict
an unconditional publication blocker across managers is a separate engine policy task.

## Independent ground truth

Both scored repositories are public, single-package App Router applications. Parent
installs use their lockfiles with scripts disabled. No third-party build, test, lifecycle
script, push, commit or PR was executed. The compiler is each repository's TypeScript 5.9.3.
`node node_modules/typescript/bin/tsc --noEmit --pretty false --incremental false` passes
at both parents. Target checks use separate scratch clones, editing only Next/companion
manifest versions and installing with `pnpm install --ignore-scripts --no-frozen-lockfile`.
The compiler/deprecation collector is Uptide's independent TypeScript script, not `check`.

| Repository | Parent | Merged upgrade | Versions | Expected root causes |
| --- | --- | --- | --- | --- |
| [sambecker/exif-photo-blog](https://github.com/sambecker/exif-photo-blog/pull/351) | `3f1a36354d203e5a28f7c2cd55eceda95a13e3bd` | `c8ea51cdd1c2604e0ad0f7f2420e7e07160a85fa` | 15.5.5 → 16.0.1 | 10 independent tag invalidations; middleware rename; shared image priority wrapper; 2 static-generation helpers |
| [stoczec/wortkarte](https://github.com/stoczec/wortkarte/pull/65) | `e3bd3679ae6ea60ce2a78aefebec0caa48c4febd` | `92f8a566fd5a54ac49e89fc98d1fb1de4fbd24a1` | 15.5.27 → 16.3.8 | removed next.config eslint object |

ExIF's ten TS2554 errors agree exactly with the old lines changed by its upgrade. Its
TS6385 priority warnings are grouped at `ImageWithFallback.tsx:16`; `PhotoForm.tsx:375`,
`PhotoLarge.tsx:230`, `PhotoMedium.tsx:82` inherit that same deprecated wrapper contract.
Static generation changes are anchored at `src/app/static.ts:24` and `:50`, not each
reindented line or the removed import. The renamed middleware expectation uses
**middleware.ts:13**, the parent path; the helper incorrectly drafts the new `proxy.ts` path.
Pure insertions (version badge/icon), comment-only lint changes, unrelated package bumps,
and optional JSX compiler-setting changes do not create source findings. Wortkarte's
ESLint flat-config rewrite belongs to its ESLint companion, while `next.config.mjs:3-5`
is one Next removal. Expectations were written before the pack test and are not adjusted
to its predictions.

### Screened out / not counted

- [BoxyHQ #2491](https://github.com/boxyhq/saas-starter-kit/pull/2491): body describes
  15.5.9 → 16.0.10, but merge `7de696815ee7c0bddbe35fd5be70da39e7117b2d` actually
  changes **15.5.9 → 15.5.14**. Its current main still declares 15.5.14. No qualifying
  merged Next 16 upgrade was established; do not trust Dependabot body text over the diff.
- [veganhacktivists/wildanimalsuffering #157](https://github.com/veganhacktivists/wildanimalsuffering/pull/157):
  real Pages Router 15.5.24 → 16.3.6, merge `d9c73b1cabca79c18512452187c7969ede78b546`,
  parent `6f4b8f48a073fb23aad84f6dd79d827518517eab`. Scripts-off install succeeds, but
  parent tsc fails at `pages/_app.tsx:24` (styled-jsx `jsx` prop absent from React style
  attributes). Excluded, not repaired or mislabeled clean.
- [Contentful #1488](https://github.com/contentful/live-preview/pull/1488): title says
  16.1.5, merged `33a537e78f90e3042cb3c125e33e52d46d0d605c` only changes 15.4.10 →
  15.5.10. Not a qualifying Pages Router upgrade.
- [rdtiv/chatprob #43](https://github.com/rdtiv/chatprob/pull/43): Pages Router, but
  13.5.11 → 16.3.2; outside this pack's source major.
- bestofjs #380 and alexmarqs/tech-companies-portugal-app #29 have actual upgrades but
  broader monorepo/config changes; the two clean single-package cases were preferred.

A clean public Pages Router baseline remains desirable follow-up coverage; a synthetic
negative test is not counted as a public repository.

## Measured pack test after 0.11.2

`pnpm uptide pack test next --write` passes **verified** against the unchanged ground truth.
The rebase is onto main `6f67430`. Both public parent commits and every expected finding
remain byte-for-byte unchanged. `requiresBuild: true` now blocks fix publication when the
consumer build is missing or fails; pack test measures detection, not a completed migration build.

| Rule / scoring group | Precision | Recall | TP | FP | FN |
| --- | ---: | ---: | ---: | ---: | ---: |
| revalidate-tag-profile | 100% | 100% | 10 | 0 | 0 |
| image-priority | N/A | 0% | 0 | 0 | 1 |
| middleware-proxy | 100% | 100% | 1 | 0 | 0 |
| lint-removal | 100% | 100% | 1 | 0 | 0 |
| generic | N/A | 0% | 0 | 0 | 2 |
| Overall sites | 100% | 80% | 12 | 0 | 3 |
| Breaking sites | 100% | 84.62% | 11 | 0 | 2 |

The other rules have no public expected sites and remain unmeasured. N/A means no
predictions; the CLI displays 100% for that zero denominator. Middleware is correctly
classified as deprecated, not breaking: Next 16 still supports middleware. The previous
candidate counted the unclaimed expectation as breaking by the scorer's default.

False positives: **none**. Remaining false negatives:

- ExIF `src/components/image/ImageWithFallback.tsx:16`: shared-wrapper deprecation/root-cause
  reporting is still missing from the engine.
- ExIF `src/app/static.ts:24` and `:50`: application-specific static-generation gating
  changes have no safe mechanical inference or compiler finding.

Companions now match the real upgrades: ExIF moves @next/bundle-analyzer,
@next/eslint-plugin-next and eslint-config-next from 15.5.5 to **16.0.1**; Wortkarte moves
eslint-config-next from 15.5.27 to **16.3.8**. No `with` expectations changed.

Config and convention detection uses the new scoped inventory, independently of imports.
Middleware rename keeps the **old path** as its finding anchor and returns a transactional
rename together with the scope-aware function edit. Explicit runtime declarations, middleware
type imports and ambiguous exports remain assisted. Existing proxy destination collisions
are rejected by the transaction engine. The removed static eslint block is found in ESM and
CommonJS configs; executable values, computed keys and wrappers are not silently removed.
Lint scripts, ESLint config and other config decisions still require review.

Four fixture cases cover six positive sites and negative controls. Convention fixtures use
an optional `filename.txt` logical path in the test harness; production detection contains no
fixture-path exceptions. Unit tests also exercise runtime exclusions, computed-key side effects,
last/sole property removal, compiler claiming, Pages Router exclusions and peer preflight.

## Separate engine tasks: current status

The original blockers below are retained as provenance. Items 1 and 2 are resolved by
#115 and #117 and used by this pack. The build-publication part of item 3 is resolved by
#116. Generated types, wrapper deprecations, truth linking, extraction and uniform peer
blocking remain follow-up work; they do not block the measured two-repository gate.

1. **Honor declared fixed-version companions without dependency edges.**
   `check/companions.ts` grows candidates through dependency/peer/shared-pin relationships;
   `lockstep` does not itself discover an unrelated installed package or force an
   already-compatible one to move. ExIF's three failures and Wortkarte's one are concrete
   reproductions. Add explicit release policy/version selection to the companion contract
   (same target version for Next release members), then apply it consistently to check,
   preflight, fix and pack-test. This is the direct blocker of the measured verified gate.
2. **Discover configuration/convention files independently of imported usages, and support
   atomic multi-file create/delete/rename operations.** `definePack.runtimeFindings` loops
   over `usages.map(u => u.file)`; transform returns only one file's text. That can inspect
   JS/MJS/TS already discovered by the engine, but cannot promise to find every
   `next.config.*`, package script, CSS file, missing route default or middleware filename.
   It cannot express middleware.ts → proxy.ts. Add a scoped file inventory and transactional
   edits with explicit runtime decisions; do not fake renames in a source string callback.
3. **Build/type-generation evidence and root-cause deprecation coverage.** A bare tsc on
   checked-in files cannot validate Next-generated route contracts when `.next/types` is
   absent. `ImageWithFallback.tsx:16` is a real independently measured TS6385 not surfaced
   at that root. Add generated-type/build prerequisites and preserve wrapper root causes,
   with downstream diagnostics as evidence, rather than changing expectations to each line.
   No monorepo-subdirectory or unbuilt-workspace failure was measured in the scored pair.
4. **Make ground-truth target linking preserve ambient dependency types.**
   `packs:truth` assembles Next under a temporary directory outside the consumer and links
   declared runtime peers. With these pnpm consumers, React's ambient `@types/react` no
   longer resolves as in an actual install. ExIF draft emits 56 diagnostics (including
   `app/layout.tsx:149`, false missing ScriptProps.src, and implicit-any cascades) and misses
   all ten true TS2554 errors; Wortkarte draft emits spurious `contacts/page.tsx:29` TS7006.
   A real scripts-off install yields exactly ten TS2554 errors for ExIF and zero errors for
   Wortkarte. Fix the helper's resolution environment; do not accept its artifacts as
   expected findings. Independently installed compiler evidence is recorded in
   `evidence.json`. Also preserve OLD filenames when drafting renamed-file expectations.
5. **Make extraction safe across processes.** Two concurrent truth commands both extracted
   eslint-plugin-import@2.32.0, producing ENOTEMPTY/ENOENT and an incomplete directory with
   `.uptide-complete`. The bad entry was moved aside and the jobs rerun serially. Use a
   process lock or unique staging directory plus atomic completion, and validate package.json.
   This was recovered locally; it is not a reason to change a source finding or gate score.
6. **Uniform peer publication blocking across package managers.** npm preflight already
   rejects non-allowed incompatible peers, and the pack regression test proves it for
   Next ^15 → 16. pnpm/Yarn preflight currently reports conflicts and can continue
   (`fix/peer-preflight.test.ts` explicitly tests that policy). Make rejection independent
   of package manager for publication, if the requirement is unconditional. Do not invent
   a next-i18next conflict: the checked published ranges accept 16. Next now passes the measured pack gate, so this cross-manager policy gap remains material.

No migration-engine implementation is bundled with this pack. The unchanged ground truth
was rerun after the merged engine work. Clean public Pages Router, async-request and
cache-export coverage should still be expanded before presenting the pack as comprehensive.
