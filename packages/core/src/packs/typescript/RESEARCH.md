# TypeScript 5 → 6: evidence and verification limits

Read date for every source below: **2026-10-14**. Scope: `typescript` from 5.x to 6.x, defaulting
to 6.0.3, the latest 6.x. No codemod exists for this upgrade; nothing was downloaded beyond the
npm tarballs of `typescript` 5.9.3, 6.0.3 and 7.0.2 (installed with scripts off into a scratch
directory to read their diagnostics), and no `npx` was used.

## Source ledger

| Source | Pinned at |
| --- | --- |
| [TypeScript 6.0 release notes](https://github.com/microsoft/TypeScript-Website/blob/119f931a639c9215a27311fde459c6db0b8718e4/packages/documentation/copy/en/release-notes/TypeScript%206.0.md) (published as [typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html)) | TypeScript-Website `119f931a639c9215a27311fde459c6db0b8718e4` (2026-03-31) |
| [Announcing TypeScript 6.0](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/), 2026-03-23 | blog post, read 2026-10-14 |
| [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), 2026-07-08 | blog post, read 2026-10-14 |
| `typescript@5.9.3` | tag `v5.9.3`, `c63de15a992d37f0d6cec03ac7631872838602cb` |
| `typescript@6.0.3` | tag `v6.0.3`, `050880ce59e30b356b686bd3144efe24f875ebc8` |

Every diagnostic code below (TS5101, TS5107, TS5011, TS1540, TS2880, TS2882, TS2591) was read from
6.0.3 itself on a scratch project, not from the notes.

## One upgrade or two

Two. 6.0 deprecates options and syntax: each is an error (`TS5101`, `TS5107`) unless
`"ignoreDeprecations": "6.0"` is set, and the notes say 7.0 "will not support any of these
deprecated options". The 7.0 announcement confirms it removes them, so a 5.x repository passes
through 6 whatever it does, and `ignoreDeprecations: "6.0"` (the escape hatch three of the
screened upgrades used) only defers the work to 7. This pack is 5 → 6. `packs/queue.json` carries
6 → 7 as its own entry, **blocked**: `typescript@7.0.2` has no JavaScript compiler API (its main
entry is `lib/version.cjs`; the announcement says a new API comes with 7.1), so `check` cannot
compute a 7.x target's diagnostics (below).

## How `check` resolves the compiler

For every other package, Signal B swaps the package into an overlay and compiles the repository
with the repository's own TypeScript. When the upgraded package is `typescript`, that would
compile with the old compiler and judge nothing. `compileCompilerUpgrade`
(`adapters/typescript/compile.ts`) does this instead:

- **Installed side:** the repository's own `node_modules/typescript`, the nearest one from the
  workspace up, as its build finds it (`consumerCompilerDir`).
- **Target side:** the `typescript` copy `check` fetched at the target version, the same release
  `fix` installs, loaded from that directory.
- **Never the bundled compiler** (ts-morph's 6.0.2). Without an installed TypeScript the compile
  is skipped and the report says why. A target without `createProgram` (7.x) is skipped and named
  the same way. The coverage line names both versions: "with the repo's TypeScript 5.9.3 and 6.0.3".
- **What is compiled:** each side builds the workspace's projects as the TypeScript project
  scope finds them (UPT-49, `project-scope.ts`: every `tsconfig*.json`, their references, configs
  that are only extended left out). Every file of those projects is compiled, not only the files
  that import `typescript`, and a diagnostic counts only in a file a project covers, as for any
  package. A diagnostic present at 6.0.3 and absent at the installed version is new, matched the
  way the overlay matches: file, code and message, or place and message shape.
- **Diagnostics on tsconfig files** (TS5101, TS5107, TS5011) are not compile findings. The
  compiler reports an inherited option at the extending config's `compilerOptions`, not where it
  is set. The pack reports each one in the file that sets it, as a pack finding from the
  inventory (`{tsconfig*.json,**/tsconfig*.json}`). Pack findings are not subject to the
  TypeScript project scope (UPT-49, uptide-dev/uptide#138 keeps runtime pack findings out of
  it), and `check.test.ts` here pins a tsconfig outside every `include` to that.

`fix` installs 6.x at the same path the repository's 5.x was loaded from. `loadCompiler` now drops
Node's cached module when the version on disk differs, and the compiler cache is keyed by version,
so verification after the install is judged by 6.x.

## Classified changes (5 → 6)

| Change (notes section) | Compiler sees it | Reported as | Rewrite |
| --- | --- | --- | --- |
| `baseUrl` deprecated, no longer a lookup root | TS5101 at the tsconfig | `base-url`, found where set | assisted: the replacement (prefix `paths`) is exact, but bare imports resolved through `baseUrl`, and bundlers that read it (Next.js, vite-tsconfig-paths), can change |
| `moduleResolution: node` / `node10` deprecated | TS5107 | `module-resolution-node10` | assisted: `bundler` vs `nodenext` depends on what runs the code |
| `moduleResolution: classic` removed | TS5107 | `module-resolution-classic` | assisted |
| `target: es5` (and es3) deprecated | TS5107 | `target-es5` | assisted: raising it changes emitted JavaScript |
| `module: amd/umd/system/none` deprecated | TS5107 | `module-format-removed` | assisted: changes what consumers load |
| `outFile` deprecated | TS5101 | `out-file` | assisted: needs a bundler |
| `downlevelIteration` deprecated | TS5101 | `downlevel-iteration` | **mechanical**: remove the line. The notes say it only affected ES5 emit. Declined with an ES3/ES5 target, with `ignoreDeprecations` set, or when the property shares its line |
| `esModuleInterop` / `allowSyntheticDefaultImports` false | TS5107 | `interop-false` | assisted: emit interop changes, and namespace imports that are called need the compiler's sites |
| `alwaysStrict: false` | TS5107 | `always-strict-false` | assisted: emitted scripts gain "use strict" |
| `rootDir` defaults to the tsconfig directory | TS5011 at `outDir` | `root-dir`, found from `outDir` + one-directory `include` | assisted: the inferred directory depends on the file list |
| `module Foo {}` namespaces | TS1540 at the name | `module-keyword` | **mechanical**: `module` → `namespace` (the notes' replacement); declined for a quoted name |
| Import assertions `assert {}` | TS2880 at `assert` | `import-assertions` | **mechanical**: `assert` → `with` (the notes' replacement); declined unless `{` or `:` follows |
| `strict` default true | code errors (TS7006, TS18048, TS2345…) | compiler findings, and the `changed-defaults` decision | assisted; pin only as a decision |
| `types` default `[]` | code errors (TS2591, TS2593, TS2304) | compiler findings, and `changed-defaults` | assisted; the guide says to list `types` |
| `noUncheckedSideEffectImports` default true | TS2882 | compiler findings, and `changed-defaults` | assisted |
| `module` / `target` defaults | code errors where they matter | `changed-defaults` summary | decision |
| `no-default-lib` directive, `tsc file.ts` with a tsconfig (TS5112) | yes | compiler findings (generic) / not in scope | none: no ground-truth site; the CLI change is not code |

Default changes are not pinned by rule. The issue asks for the old value to be pinned unless the
repository opts in, with the choice under "Decisions for you". A static pin would be predicted in
every tsconfig that leaves `types` or `strict` unset, and in the ground truth most of those
compile cleanly at 6.0 (m-lyon/recipe, robrechtme/recipes), so it would be a false positive
there. So the choice is the `changed-defaults` decision. It names each tsconfig and the defaults
it leaves unset, following `extends` inside the repository; a package's config is not read. The
errors themselves are the compiler's findings. Borewit pinned `"strict": false` and signalk added
`ignoreDeprecations`, both visible in the ground truth as tsconfig sites under `changed-defaults`.

## Peers

Tooling that peers on `typescript` is planned like any peer (`companions.ts`). A release whose
range accepts the target stays; one that rejects it stays too and is reported as a peer conflict,
"left where it is, not compiled at another version". Before this change a peer that `list` does
not group with the lead (typescript-eslint, ts-jest) was planned and then dropped from the report.
`companionsOf` now returns its conflict, with a test from `@typescript-eslint/parser` 8.56.0
(`typescript >=4.8.4 <6.0.0`). Nothing is bumped across a major. The ground-truth repositories
had no such conflict: typescript-eslint 8.68 and tsup accept 6.0.

## Independent ground truth

Seven merged public upgrades, 5.x → 6.0.3. Each was drafted with `pnpm packs:truth` (6.0.3 linked
where the repository installs `typescript`, every `tsconfig.json` compiled before and after, and
the upgrade's diff), then assigned by rule and committed (`d128198`, the first commit of this branch) **before the first
`pack test` run**. Nothing was changed after scoring.

| Repository | Upgrade | Before | What it exercises |
| --- | --- | --- | --- |
| m-lyon/recipe (`client/`) | [#113](https://github.com/m-lyon/recipe/pull/113) | `f6e44b5`, 5.6.2 | `baseUrl` with ten `paths` entries |
| robrechtme/recipes | [#7](https://github.com/robrechtme/recipes/pull/7) | `0853747`, 5.9.3 | `target: es5`, `baseUrl` |
| JosephMaynard/dependency-radar | [#46](https://github.com/JosephMaynard/dependency-radar/pull/46) | `1920eb3`, 5.9.3 | `moduleResolution: node`, `types` default (Node builtins), TS2882 in a nested project |
| CroffZ/github-release-notifier | [#5](https://github.com/CroffZ/github-release-notifier/pull/5) | `d9353f2`, 5.9.3 | `baseUrl` in an extended base config, `rootDir` |
| SignalK/signalk-derived-data | [#239](https://github.com/SignalK/signalk-derived-data/pull/239) | `02f635e`, 5.9.3 | `moduleResolution: node` kept behind `ignoreDeprecations`, `types` default |
| shogo82148/typescript-action | [#487](https://github.com/shogo82148/typescript-action/pull/487) | `0f03405`, 5.9.3 | `rootDir` (TS5011), `types` |
| Borewit/music-metadata | [#2661](https://github.com/Borewit/music-metadata/pull/2661) | `783509b`, 5.9.3 | `baseUrl`, `strict` and `types` defaults across 60 test files |

How sites were assigned:

- Every code diagnostic new at 6.0.3 is a site under `generic`, one per line. No pack rule claims
  them: they are the compiler's.
- A TS5101/TS5107/TS5011 diagnostic on the line that sets the option takes that option's rule. An
  inherited option the compiler reports at an extending config (`packages/action/tsconfig.json:3`,
  `lib/tsconfig.json:3`, `test/tsconfig.json:3`) is the same change. Its one site is where the
  option is set (`tsconfig.base.json:14`, `tsconfig.json:7`).
- The `paths` entries rewritten when `baseUrl` was removed are part of the `base-url` change.
- A changed line with no diagnostic is a site of the change it belongs to:
  - dependency-radar `tsconfig.json:4`, where `module` moved to Node16 for the node16 resolution
    (`module-resolution-node10`);
  - CroffZ `packages/action/tsconfig.json:5`, where `rootDir` was added (`root-dir`);
  - tsconfig lines where `types` was added (`changed-defaults`);
  - 17 Borewit test lines the upgrade tightened with no diagnostic at the pinned commit (`generic`).
- Borewit's `lib/common/MetadataCollector.ts:211` is a deprecation (TS6385, `substr`), kept under
  `generic`.

### Screened out

From about 340 merged pull requests that touched a tsconfig or code with a lockfile, read
2026-10-14: chipster/chipster-web#87 (prepares for 6 without bumping it); AlaskaAirlines/auro-cli#341
(TypeScript 6 only transitively); vish288/move-prop-types#45 (also moves chalk 5 → 6, @types/node
22 → 26 and @eslint/js 9 → 10, so its errors are not only TypeScript's); several where TypeScript 6
only arrives through tsup's injected `baseUrl` (`ignoreDeprecations` only); upgrades from 4.x;
forks; and 7.0 or tsgo upgrades.

## Measured `pack test`

Measured 2026-10-14 against the ground truth committed before it:

```
uptide pack test typescript · verified, recorded candidate
fixtures      6 cases, 13 sites · pass
ground truth
  m-lyon/recipe@f6e44b530c4d                   typescript 5.6.2 → 6.0.3  predicted 1, expected 1, false positives 0, false negatives 0
  robrechtme/recipes@0853747427b7              typescript 5.9.3 → 6.0.3  predicted 2, expected 2, false positives 0, false negatives 0
  JosephMaynard/dependency-radar@1920eb3217b7  typescript 5.9.3 → 6.0.3  predicted 115, expected 116, false positives 0, false negatives 1
  CroffZ/github-release-notifier@d9353f2471c5  typescript 5.9.3 → 6.0.3  predicted 11, expected 12, false positives 0, false negatives 1
  SignalK/signalk-derived-data@02f635e8232a    typescript 5.9.3 → 6.0.3  predicted 417, expected 418, false positives 0, false negatives 1
  shogo82148/typescript-action@0f03405c7267    typescript 5.9.3 → 6.0.3  predicted 2, expected 3, false positives 0, false negatives 1
  Borewit/music-metadata@783509b27bac          typescript 5.9.3 → 6.0.3  predicted 831, expected 851, false positives 0, false negatives 20

  rule                         precision  recall    tp   fp   fn
  base-url                          100%    100%     4    0    0
  changed-defaults                   n/a      0%     0    0    4
  generic                           100%     99%  1371    0   18
  module-resolution-node10          100%     67%     2    0    1
  root-dir                          100%     50%     1    0    1
  target-es5                        100%    100%     1    0    0
  overall (sites)                   100%     98%  1379    0   24
  behavior notes (sites)             n/a      0%     0    0    4
  breaking (sites)                  100%     99%  1379    0   20
```

The false negatives, all expected:

- **Second-round compiler errors.** Borewit's 17 tightened test lines and the TS6385 deprecation.
  The compile reports errors, and those lines only error once the `types` fix gives `chai` and
  mocha their types back.
- **Same-change lines no rule predicts.** dependency-radar's `module` line and CroffZ's `rootDir`
  under `noEmit`. `root-dir` reads `outDir`, and CroffZ has none.
- **`changed-defaults` sites.** That note is a decision, not a finding, so its 4 sites are
  behavior-only misses, not missed breaks.

### After rebasing on UPT-49 (#138): the `types` default folds

On #138's project scope the compile also builds `tsconfig.*.json` projects. The first run there
found 14 breaking false positives in shogo82148/typescript-action `__tests__/`, through
`tsconfig.eslint.json`: `describe`, `it` and `expect` unresolved under `types: []`. The ground
truth, committed before scoring, does not change to make a run pass, so a redraft was reverted
(the `packs:truth` change that drafts on the same scope stays, for packs drafted from now on).

The engine changed instead. A person fixes the `types` default with one line, `"types": [...]`,
not at each use, as shogo did in `tsconfig.eslint.json`. So `foldTypesDefault` (`fold.ts`, the
pack's `foldFindings` hook, run after #136's option cascades) folds those errors into one
`changed-defaults` finding:

- **Which errors:** TS2580/2581/2582/2591/2592/2593, and TS2304/TS2503 when an `@types` package
  5.x included declares the missing name.
- **Where:** at the covering project that leaves `types` unset through its `extends`, on the
  config's root object line. The errors become its evidence (`anchorOnly`).
- **Severity:** the note's, `deprecated` ("needs a look"). A breaking anchor would be a
  breaking false positive wherever the original truth has no site for that tsconfig edit
  (dependency-radar's `types` insertion touched a changed line, so it was never anchored).

Re-scored 2026-10-15 on the original truth (unchanged since `d128198`):

- 0 breaking false positives; PASS. The run measures verified and the record stays candidate.
- Breaking recall **17% (240 of 1,399)**. 1,159 sites the original truth lists one per error line
  under `generic` are now evidence of one tsconfig finding each, so they score as misses.
- 8 `changed-defaults` false positives (deprecated, not breaking): the anchor is on the root
  object line, while the truth's lines for those edits follow each diff's shape (`:1` where the
  insertion went into an untouched object, the last property where a comma changed).

The recall figure measures the original truth's convention (every error line a site) against
the engine's (one site per edit). It is not a count of breaks `check` misses: every folded
error is listed under its tsconfig finding.

**Scoring the folded evidence.** Since then `pack test` counts a ground-truth site that an
anchored finding lists as evidence as covered by that finding, at the site's own rule and
severity (`predictedSites`, as for #136's option cascades). The ground truth did not change.
Re-scored 2026-10-15: breaking recall **99% (1,379 of 1,399)**, 0 breaking false positives,
the same as before the fold. The 20 breaking misses are the second-round and same-change lines
listed under "Measured `pack test`".

## Verified under UPT-48

`pnpm uptide pack test typescript --write` on main (`530f90c`, UPT-48's gate), with its own
`UPTIDE_CACHE_DIR`, 2026-10-15: **PASS, measures verified, recorded verified.** The ground truth
is unchanged (same digest as the candidate record).

- Repositories: 7 public (gate: ≥2).
- Real breaking sites: 1,399 expected (gate: ≥5).
- Breaking false positives: 0 (gate: 0). Breaking precision 100%, recall 17% (240 of 1,399; the
  folded `types` errors above), 99% (1,379) once the scorer counts folded evidence (above).
- Behavior notes: precision 20%, recall 50% (2 TP, 8 FP, 2 FN), all `changed-defaults` anchors at
  `tsconfig*.json:1`. Notes do not count against a breaking-class gate.
- Per-rule real-world true positives: `base-url` 4, `module-resolution-node10` 2, `target-es5` 1,
  `root-dir` 1 (all assisted).
- **Unexercised** (recorded in `verification.json`): `downlevel-iteration`, `import-assertions`,
  `module-keyword`. No real site exercises their rewrites, so `check` and `fix` run them assisted;
  the fixtures are their only evidence.
- `module-resolution-classic`, `module-format-removed`, `out-file`, `interop-false` and
  `always-strict-false` are detection only with no real site either. Each matches only the exact
  value 6.0 reports.

## Known limits

- **`extends` to a package** (`@tsconfig/node16`, `expo/tsconfig.base`). Options set there are not
  read: neither the deprecated-option rules nor `changed-defaults` see them. The compiler still
  reports their code fallout.
- **`root-dir`** reads one file. A `rootDir` set in an extended config is not seen. An `include`
  over several directories, or none, is not reported, even when the compiler reports TS5011
  there. CroffZ's `noEmit` case is a miss.
- **Second-round errors** that appear only after the first fixes are not predicted; `fix`'s
  verification compile sees them.
- **Deprecation suggestions** (TS6385) are not reported by the compile, which keeps errors.
- **6 → 7** is blocked until TypeScript 7 exposes a compiler API `check` can load.
