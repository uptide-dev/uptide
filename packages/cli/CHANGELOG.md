# uptide

## 0.14.3

### Patch Changes

- [#191](https://github.com/uptide-dev/uptide/pull/191) [`db1d384`](https://github.com/uptide-dev/uptide/commit/db1d384d46cd361fb0bd0fa76e4a4b21ec2d4ebc) Thanks [@lucasbraum](https://github.com/lucasbraum)! - The ai pack now reports AI SDK 7 renames in tests that `vi.mock('ai')` or `jest.mock('ai')` without importing it: the mock factory's `stepCountIs` key, and `onFinish` and the other renamed options read by fakes of `ai` calls such as `toUIMessageStreamResponse`.

- [#196](https://github.com/uptide-dev/uptide/pull/196) [`fa6f788`](https://github.com/uptide-dev/uptide/commit/fa6f7884af0e71dcfdabae9753fcfa1158b4d2b6) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `fix` no longer runs out of memory type-checking monorepos whose root tsconfig includes every package: each workspace's program holds only the files that workspace owns, and the baseline check releases one workspace's program before building the next. When the analysis thread does run out of memory, `fix` says the repository is too large for analysis instead of crashing, and its temporary clone is removed on every exit path, a crashed or out-of-memory analysis thread included.

- [#190](https://github.com/uptide-dev/uptide/pull/190) [`cdf7f69`](https://github.com/uptide-dev/uptide/commit/cdf7f6969806f750012eb99af905be66200a512a) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `check <pkg>` no longer returns nothing for an outdated dependency used only through config files (typescript through tsconfig): it is always reported, with the reason, including when its workspace's analysis fails or the time budget runs out. Analysis no longer fails with ENAMETOOLONG on a package that links itself (Yarn `link:.`).

- [#186](https://github.com/uptide-dev/uptide/pull/186) [`5e01ef3`](https://github.com/uptide-dev/uptide/commit/5e01ef34a7fc7c99f186606f4cc93c145b085b24) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Keep the migration's starting branch and commit in reports and diff hints, including after re-verification. Default hints to `npx uptide`, use `uptide` only when the command on PATH resolves to the running binary, keep shared reports portable, and preserve explicit flags accepted by suggested commands, including peer retry budgets and workspace-root retries.

- [#197](https://github.com/uptide-dev/uptide/pull/197) [`b51ca9b`](https://github.com/uptide-dev/uptide/commit/b51ca9b4f0bc5f911a21cf90391b53e8af2b93e2) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Suggested commands no longer print `uptide` when the launcher found is a project-local `node_modules/.bin` entry (as under `pnpm run`/`pnpm exec` or npm scripts); only a real global install does, otherwise `npx uptide`.

- [#187](https://github.com/uptide-dev/uptide/pull/187) [`6fe81b4`](https://github.com/uptide-dev/uptide/commit/6fe81b42fe556b0f6032f5ba5146986941a36c04) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Prevent `fix` from failing with `spawnSync git ENOBUFS` when Git output exceeds 1 MiB in large repositories. Raise the buffered output limit to 256 MiB for shared Git operations and source-version status checks.

- [#185](https://github.com/uptide-dev/uptide/pull/185) [`98a3119`](https://github.com/uptide-dev/uptide/commit/98a311915bc180d2cd025e568b494f1c2066af5a) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Detect removed Zod error members on local results of schemas imported through repository modules, including awaited safeParseAsync calls, so their `.errors` reads can migrate to `.issues`.

- [#193](https://github.com/uptide-dev/uptide/pull/193) [`a68fea3`](https://github.com/uptide-dev/uptide/commit/a68fea3a1a1fd958a9bac099a4064d07a359428e) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `fix` no longer refuses on lockfile changes the upgrade didn't cause. When the install guard finds resolutions outside the upgrade's subtree, it runs the same install at the parent commit and judges the upgrade against that lockfile. Churn the parent install already produces is listed as "Lockfile churn the parent commit already has" and never blocks; changes only the upgrade makes are still refused, or listed for review in agent-led runs.

- [#180](https://github.com/uptide-dev/uptide/pull/180) [`549edc3`](https://github.com/uptide-dev/uptide/commit/549edc3373e6b8e76bbaea058ecb1e9241ef3239) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Update conflicting root pins automatically when preparing draft PRs, including App/Action runs, and list the changes at the top of the PR under "Root pins changed: review". Add `updatePins: false` in `uptide.yml` to opt out. Local runs still require explicit `--update-pins` consent.

- [#188](https://github.com/uptide-dev/uptide/pull/188) [`69b1c88`](https://github.com/uptide-dev/uptide/commit/69b1c882a5f404b39966a5c8c47666c0caa9c178) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Continue `fix` as an agent-led draft instead of exiting 2 when a preflight refusal has an assisting agent: peer blockers that need a major run as the plan's suggested command, root pins without consent are updated (an explicit `updatePins: false` still refuses), companions that cannot move together leave the lead alone, and the install check reports out-of-scope resolutions for review. The reason heads the PR body and the terminal summary, next to feedback rounds and spend. Without an agent, with `--no-llm`, or on a downgrade, `fix` still refuses.

- [#188](https://github.com/uptide-dev/uptide/pull/188) [`69b1c88`](https://github.com/uptide-dev/uptide/commit/69b1c882a5f404b39966a5c8c47666c0caa9c178) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `fix` makes the no-pack stop (no agent, or a major for a PR) before cloning or installing. When the check returns nothing to analyze for an outdated package, `fix` now says so instead of "has no upgrade", and an agent continues as a draft. Lockfile resolutions an agent-led install changed outside the upgrade are listed for review in the PR body and the terminal summary. Downgrades, key-like settings in `uptide.config.json`, credentials in `OPENAI_BASE_URL` and unsafe run reports throw `SafetyRefusal`, which no fallback continues past.

- [#194](https://github.com/uptide-dev/uptide/pull/194) [`7dd3259`](https://github.com/uptide-dev/uptide/commit/7dd3259d449dff5d91dc233f28075b260375f244) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Stop `fix` in preflight on npm when a package that moves, or a peer npm installs for it, rejects a package that stays installed: vitest 5 peers on vite, and vite 8 rejects the repository's esbuild 0.25. Before, npm refused the install after the clone. The row names the chain, and `--allow-peer` writes the override.

- [`4c3dc23`](https://github.com/uptide-dev/uptide/commit/4c3dc237be768863b17a0943ff0447a36165ff6e) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `uptide pack test` now prints the precision of every rule with a rewrite, breaking or not, and warns when one is below 80%. It is a warning only: no pack's status and no rule's run mode changes. The compatibility matrix lists each rewrite's precision.

- [#179](https://github.com/uptide-dev/uptide/pull/179) [`9112f2b`](https://github.com/uptide-dev/uptide/commit/9112f2b5aaffc39f94df9a37c4b2575578e2ebe4) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Add `fix --update-pins` to explicitly approve updates to conflicting root Yarn resolutions and npm/pnpm overrides for the target and its companions. Preserve unrelated pins, update root declarations and pnpm catalogs together, report pin changes, and reject ambiguous selectors before installation.

- [#192](https://github.com/uptide-dev/uptide/pull/192) [`3f81193`](https://github.com/uptide-dev/uptide/commit/3f811934d020b108d5b700a8ae794ec6af6f7d40) Thanks [@lucasbraum](https://github.com/lucasbraum)! - The `@sentry/browser` 10 to 11 pack is verified again: 5 public upgrades, 22 real breaking sites, breaking precision 100% and recall 50%. `@sentry/react` stays a candidate: its ground truth grew to 14 public upgrades and 29 breaking sites, with 3 false positives among its breaking findings.

- [#202](https://github.com/uptide-dev/uptide/pull/202) [`51a6f70`](https://github.com/uptide-dev/uptide/commit/51a6f7052677c24ab7ae752d7ca007971d6dea9b) Thanks [@lucasbraum](https://github.com/lucasbraum)! - The Sentry packs now read JavaScript files that only require another Sentry package (`@sentry/core`, a sibling SDK of the same release), which the TypeScript compile scope skipped. `@sentry/browser` breaking recall on public ground truth goes from 50% to 82% with no false positives.

- [#199](https://github.com/uptide-dev/uptide/pull/199) [`08da2a7`](https://github.com/uptide-dev/uptide/commit/08da2a7bc64e1461c3ce567c443cddf97a104ba2) Thanks [@lucasbraum](https://github.com/lucasbraum)! - The Sentry 10 to 11 pack no longer reports `beforeSendTransaction` or `ignoreTransactions` in a `Sentry.init` that sets `traceLifecycle`: the option keeps transactions, so they still work.

- [#189](https://github.com/uptide-dev/uptide/pull/189) [`5d1d350`](https://github.com/uptide-dev/uptide/commit/5d1d35000b5e795c0c83410dd1436500837cfbe2) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Avoid shared registry-cache write races during parallel checks, publish complete package extractions atomically, and print package failure reasons on stderr when check exits 2.

- [#195](https://github.com/uptide-dev/uptide/pull/195) [`15b3b3e`](https://github.com/uptide-dev/uptide/commit/15b3b3e29ebc66f8d24cc81918a13716680ad1f8) Thanks [@lucasbraum](https://github.com/lucasbraum)! - The vitest pack now reads `vite.config.*` and `vitest.config.*` files and jest-dom setup files that never import `vitest` (a config that takes `defineConfig` from a shared file, a setup file that only does `import '@testing-library/jest-dom/vitest'`), so it reports their bare-directory coverage patterns and jest-dom registrations.

## 0.14.2

### Patch Changes

- [#176](https://github.com/uptide-dev/uptide/pull/176) [`738a57b`](https://github.com/uptide-dev/uptide/commit/738a57bceb6ba8255dd57eae05162216223068b1) Thanks [@lucasbraum](https://github.com/lucasbraum)! - setup PRs pin Action v0.14.1

## 0.14.1

### Patch Changes

- [#172](https://github.com/uptide-dev/uptide/pull/172) [`a4b0767`](https://github.com/uptide-dev/uptide/commit/a4b0767a09c6b06bb05d01b8f550bb204a898527) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Fix standard-library resolution in TypeScript 7 repositories using the bundled compiler, avoiding invented baseline errors such as missing Object.hasOwn. Compare the parent baseline with the repository's tsc directly without running package scripts, identify that checker in report notes, and report mismatches as an Uptide setup problem.

- [#170](https://github.com/uptide-dev/uptide/pull/170) [`666759b`](https://github.com/uptide-dev/uptide/commit/666759be7f3d49e2e24e75937a8aa10959b6e96e) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Stop treating unrelated packages in the same npm scope as upgrade companions. Include the blocking package, requirement range, and next step in planner refusal messages.

- [#173](https://github.com/uptide-dev/uptide/pull/173) [`5298b85`](https://github.com/uptide-dev/uptide/commit/5298b8558c23eb339f42a3c5c58870cdb2ea1e0c) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Pin the Uptide Action to v0.14.0

- [#174](https://github.com/uptide-dev/uptide/pull/174) [`90485aa`](https://github.com/uptide-dev/uptide/commit/90485aa2f028cf5075e994cbb78dd765f88a2b04) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Repair upgrade-caused type, build, and test failures with bounded agent feedback, retain draft agent-led upgrades when pack verification cannot proceed, and report feedback rounds and budget. Guard test edits against deletion, skipping, and weakened assertions; flag explained expected-value migrations for review.

- [#171](https://github.com/uptide-dev/uptide/pull/171) [`97119ea`](https://github.com/uptide-dev/uptide/commit/97119ea7c315d9bd094ad6de80ff77eb9cee8854) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Prepare missing workspace declarations for fix verification, and rebuild internal packages affected by upgraded dependencies even when build output exists. Use the configured verification build script and report each build. A build that cannot run or fails is reported, never thrown. Standalone checks run no repository scripts and count the files importing a workspace with missing output as not verified (`needs build of <workspace>`) while the rest still compiles.

## 0.14.0

### Minor Changes

- [#160](https://github.com/uptide-dev/uptide/pull/160) [`2062939`](https://github.com/uptide-dev/uptide/commit/2062939f6e4fbb406bd42fd3cdff87b0152bf8dc) Thanks [@lucasbraum](https://github.com/lucasbraum)! - The typescript 5 to 6 and express 4 to 5 packs are now verified, so `check`, `list` and `fix` use them by default. Both measure verified under the stricter gate on unchanged ground truth: typescript across 7 public repositories (1,399 real breaking sites, no breaking false positive; its `downlevel-iteration`, `import-assertions` and `module-keyword` rewrites stay assisted until a real site exercises them), express across 4 (86 real breaking sites, no breaking false positive).

### Patch Changes

- [#168](https://github.com/uptide-dev/uptide/pull/168) [`7c14ad0`](https://github.com/uptide-dev/uptide/commit/7c14ad03e18d68548ae9122c0cc386e6419d10ca) Thanks [@lucasbraum](https://github.com/lucasbraum)! - The redis (node-redis) 4 to 5 and 5 to 6 pack is verified: 5 public upgrades, 20 real breaking sites, breaking precision 100% and recall 83%; its four rewrites no real site exercises (`keepAlive`, `quit`/`disconnect`, scan iterators, `unstableResp3`) run as assisted. It now reports numeric SCAN cursors in files that use the client through the repository's own module (`getRedisClient` from `../config/redis`, `redisClient` from `~/utils/redis.server`) without importing redis, including files the compile scope left out under the importer memory cap, and treats `scan(cursor)` after `let cursor = 0` as a numeric cursor. The resolver behind it, shared with the zod pack's form-error rule, moves to `check/importers.ts` as `packageImports`.

- [#160](https://github.com/uptide-dev/uptide/pull/160) [`2062939`](https://github.com/uptide-dev/uptide/commit/2062939f6e4fbb406bd42fd3cdff87b0152bf8dc) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `uptide pack test` counts a ground-truth site that a folded finding lists as its evidence as covered by that finding, so recall reflects what `check` reports. The typescript pack's breaking recall goes from 17% to 99% on unchanged ground truth: its TypeScript 6 `types` default errors fold into one tsconfig finding each.

## 0.13.1

### Patch Changes

- [#161](https://github.com/uptide-dev/uptide/pull/161) [`1d05cab`](https://github.com/uptide-dev/uptide/commit/1d05cabd0b732ddab454b86ef326ce3feeff8474) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `check` prints what moves with a package, what the target requires, what blocks it, the `@types` stubs it removes and what stays on every row that has any, a row where nothing breaks included, in the summary and in `--details`; such a row is never folded away. `pack test` reports removals. A site's fixability now comes from the same dry run as the plan, so the summary, `--details` and `--json` agree (an unpinned Stripe client is `mechanical` in all three). The PR body says each decision once: an agent's restatement of a decision the pack already asks for is dropped, and the same choice in several files is one bullet.

- [#164](https://github.com/uptide-dev/uptide/pull/164) [`8b80410`](https://github.com/uptide-dev/uptide/commit/8b80410524d18083dc9cef9437bb4c274afe874e) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Peer warnings in `check` and `plan` report the version the upgraded package actually resolves, found from its own installed directory as Node does, instead of another copy of the peer the repository has (an older one nested under a workspace, for example).

- [#162](https://github.com/uptide-dev/uptide/pull/162) [`5eccf06`](https://github.com/uptide-dev/uptide/commit/5eccf06d9179bd7f101d6d2655b305e762992d3e) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Pin the Uptide Action to v0.13.0

## 0.13.0

### Minor Changes

- [#134](https://github.com/uptide-dev/uptide/pull/134) [`b795705`](https://github.com/uptide-dev/uptide/commit/b7957054aff8462fec3f83af2ad5cd0eeb7ef501) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Packs can name alternate leads: packages a repository declares instead of the pack's own (`react-router-dom` for `react-router`). `check` and `fix` asked for either name use the pack; where only the alternate is declared, the lead is analyzed at the version installed through it, pnpm stores included, and `fix` declares it beside the alternate at the target before upgrading both.

- [#149](https://github.com/uptide-dev/uptide/pull/149) [`3303118`](https://github.com/uptide-dev/uptide/commit/3303118c4c6c2a0ad2efa13e3139cb2faf800b4a) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Add a candidate express 4 to 5 migration pack. Route strings that path-to-regexp 8 rejects or reads differently are found on calls of an Express app or router (including lists registered in a loop); `req.params` values widened to `string | string[]`, `req.param`, `res.sendfile`, `express.static.mime` and `express.query` are claimed from the compiler; `res.redirect(url, status)`, `app.param(fn)`, `res.redirect('back')` and `res.send(<number>)` are found in the source; runtime defaults (async errors, `req.body`, the query parser, `urlencoded`, dotfiles, Node 18) go to decisions. No rule rewrites. With the pack in use, `check` no longer adds its text-matched express 5 runtime findings.

- [#148](https://github.com/uptide-dev/uptide/pull/148) [`5143c46`](https://github.com/uptide-dev/uptide/commit/5143c46b0ee9e8076f1c1d3cbaff7dacb308a006) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Add a candidate joi 17 to 18 migration pack. `new ValidationError(message, {}, original)`, which stops compiling for code written against joi 17.0–17.6, is rewritten to pass `[]`; the Node.js 20 requirement and the top-level domains joi 18 no longer accepts in `email()`, `domain()` and `uri()` are reported as decisions. Scored against two public repositories, one of them a negative control.

- [#131](https://github.com/uptide-dev/uptide/pull/131) [`413d3da`](https://github.com/uptide-dev/uptide/commit/413d3da396dbcbbd03226ad99aa06d4eb387bc46) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Add a verified lucide-react 0.x to 1.x migration pack. Brand icons removed in 1.x are found at their imports and every use, with a guide whose replacement choice goes to the owner; icon names dropped during 0.x are renamed at the import or member; deep `dist/` imports, untyped icon lookups, the `absoluteStrokeWidth` and `IconNode` deprecations, and the `aria-hidden` default for repositories before 0.489.0 are reported. Lucide's lockstep packages move together and the consumer's build is required. Verified against three public repositories, one of them a negative control.

- [#132](https://github.com/uptide-dev/uptide/pull/132) [`107c107`](https://github.com/uptide-dev/uptide/commit/107c10782272e4e38ad56b97ec0319e45bc2bdc5) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Add a verified React Router 6 → 7 migration pack, which also runs for applications that declare only `react-router-dom`. It moves `react-router-dom` imports to `react-router`. It reports, with a guide for the agent, the rest of the upgrade: the removed `future` prop and router option, `react-router-dom/server`, lowercase `formMethod` comparisons and `json`/`defer` calls (found by syntax where the compiler is blind), the other removed exports, and `generatePath` calls that pass `null` for a required parameter. The six v6 future flags that become defaults are reported as decisions where the repository's router setup has not enabled them. React Router 7 → 8 is a separate upgrade.

- [#142](https://github.com/uptide-dev/uptide/pull/142) [`9c57934`](https://github.com/uptide-dev/uptide/commit/9c57934682065de2df07c5481a8a235c31c049ad) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `check` and `fix` plan what the target version requires: a package the target, or anything moving with it, declares as a peer or dependency at a range the installed copy rejects moves to the lowest release of its major that satisfies it (openai 7 moves zod 3.24.2 to 3.25.0), shown apart from release-group companions ("moved because openai 7.4.0 requires zod ^3.25 || ^4.0"). A move only a new major makes is never made: it is reported as a blocker with the exact range in `check`, the PR body and `pack test`. The npm install scope guard no longer lets a declared root dependency change because a moved package peers on it.

- [#128](https://github.com/uptide-dev/uptide/pull/128) [`06f11ab`](https://github.com/uptide-dev/uptide/commit/06f11ab1275b498226e11c016ab2e1983d980231) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Add verified Sentry JavaScript SDK 10 to 11 migration packs for `@sentry/nextjs` and `@sentry/browser`, with the SDK's lockstep release group, a required build for Next.js, and inventory-scoped decisions for data collection, span streaming, sampling and platform minimums. Mechanical rules move `withSentryConfig` to `@sentry/nextjs/config` and the removed build options under `webpack`, remove `enableLogs`/`enableMetrics: true`, and rename exports, integration names and `httpIntegration` options; privacy, sampling, profiling and OpenTelemetry choices stay assisted and are reported for the owner. Fix `uptide pack new` dropping registry entries long enough to be wrapped.

- [#155](https://github.com/uptide-dev/uptide/pull/155) [`922c5ab`](https://github.com/uptide-dev/uptide/commit/922c5ab4e028525305dd0ea3d43c2e22a3bf6845) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `uptide pack test` applies a stricter verified gate: at least five expected breaking sites across the public ground-truth repositories, besides two repositories and no breaking false positive. Upgrades the compiler cannot see are gated on their behavior notes instead. Mechanical rules no real site exercises are recorded as unexercised, and `check` and `fix` run their sites as assisted. `@sentry/browser` and `@sentry/react` become candidates (fewer than five real breaking sites). A pack can lower the minimum only with a written reason in its RESEARCH.md. The README packs table shows each pack's breaking-site count. The output shows the gate's class, site counts and every reason a pack is a candidate.

- [#147](https://github.com/uptide-dev/uptide/pull/147) [`0b88170`](https://github.com/uptide-dev/uptide/commit/0b88170ce3cb6066b0d1def0d3da145fe618c1ed) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `check` and `fix` remove a deprecated `@types` stub instead of upgrading to it. When the release the upgrade would move `@types/<pkg>` to is deprecated on npm, and `<pkg>`'s target declares its own types (`types`, `typings` or a `types` export), the plan removes it: "Removed: @types/ioredis, ioredis 5 ships its own types", in `check` and in the PR body. `check` now diffs such a package against its own target types instead of failing on a stub with no declarations, and `fix` removes the entry in the same install, with the install scope guard allowing exactly that removal.

- [#150](https://github.com/uptide-dev/uptide/pull/150) [`4c3212b`](https://github.com/uptide-dev/uptide/commit/4c3212be7c8faecc0b2659c27a0d270ecb259f02) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `check typescript` judges a TypeScript 5 to 6 upgrade with both compilers: every project of the workspace is compiled with the installed TypeScript and with the target's, and what is new at the target is a finding; the bundled compiler never stands in, and a target without a JavaScript API (TypeScript 7) is reported as not compiled. A candidate typescript 5 to 6 pack reports the tsconfig options 6.0 deprecates where they are set, the rootDir default, module-keyword namespaces and import assertions. A peer that rejects the target (typescript-eslint on TypeScript 6) is now reported as a peer conflict even when it is not grouped with the package.

- [#137](https://github.com/uptide-dev/uptide/pull/137) [`21894d7`](https://github.com/uptide-dev/uptide/commit/21894d74b807b9bf6c4fdc06cf69cd9f361ff190) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Add `verify.build` to uptide.yml: the package.json script a migration pack's required build runs. Unset, Uptide runs `build:ci`, then `build-ci`, then `build`. When a build fails before the framework's build starts because it needs an environment variable or a database (`prisma db push` without `DATABASE_URL`), the pull request and the report say so ("build needs DATABASE_URL; set verify.build") instead of a bare "build failed". `uptide init` writes the setting as a comment.

### Patch Changes

- [#141](https://github.com/uptide-dev/uptide/pull/141) [`9debb6d`](https://github.com/uptide-dev/uptide/commit/9debb6d6dc5e6087d266a054a8ca403863ac338e) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `check` no longer reports a pre-existing type error as a breaking site when the upgrade only changes its wording, such as a type the message prints in full. An error at the same place with a different reason is still reported.

- [#129](https://github.com/uptide-dev/uptide/pull/129) [`e796e4c`](https://github.com/uptide-dev/uptide/commit/e796e4c68ca0bbb72edd7f33f52001fd5ec83ab9) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Add a candidate ioredis 5 to 6 migration pack: client constructions that inherit the RESP3, reconnect and keep-alive defaults ioredis 6 changed, compiler-blind sites (`mode === 'subscriber'`, commands in a `connect` listener with the offline queue off, AUTH recognized by command name), dependents that bundle ioredis 5, instrumentation that stops patching ioredis 6, and Node 20. It is scored against five public upgrades and stays a candidate: none of them has a breaking site to verify it with.

- [#139](https://github.com/uptide-dev/uptide/pull/139) [`9ba005a`](https://github.com/uptide-dev/uptide/commit/9ba005ad346ad46e6912242d12db1e6c14d5100a) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Allow local check and fix smoke tests of registered candidate packs with --allow-candidate, with an explicit unverified banner. Reject candidate opt-in in the Action and with publication flags, and prevent stored candidate runs from being published. Label pack-claimed assisted sites by rule id even with --no-llm.

- [#157](https://github.com/uptide-dev/uptide/pull/157) [`f3af6a1`](https://github.com/uptide-dev/uptide/commit/f3af6a1e57a43c803eec8f0be3bc4afed9cd997a) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `check` no longer reports a blocker for a direct dependency whose plain dependency range rejects the target (`@azure/ai-projects` on `openai ^6`, verdaccio pinning express 4): the package manager gives it its own nested copy, so it is listed as staying, with the new major that would accept the target when there is one. `pack test` counts a `with` move that `check` leaves and explains (a blocker, a new-major stay or a peer conflict) as explained, and one of a package that does not depend on the lead as the repository's choice; neither fails the run.

- [#130](https://github.com/uptide-dev/uptide/pull/130) [`5ced450`](https://github.com/uptide-dev/uptide/commit/5ced4504940e3f05d56178b3edff9954da5f92fe) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Add a candidate openai 4 to 7 migration pack: named path parameters, `del` → `delete`, promoted beta chat helpers, renamed runner events, removed entry points and request-option overloads are rewritten where unambiguous; tool-call unions, `httpAgent`, `fileFromPath` and the other removals get agent guides; `APIError.headers`, Web `Response` bodies and double-encoded path ids are detected even in code typed `any`; Node 22, zod, fetch and client-subclass decisions carry repository evidence. It stays a candidate (the dependency is still checked and fixed as generic) until two engine gaps its ground truth exposed are closed.

- [#136](https://github.com/uptide-dev/uptide/pull/136) [`578a042`](https://github.com/uptide-dev/uptide/commit/578a0424dc4c4643123dbcddee793ef93123117c) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Fold implicit-any errors (TS7006, TS7031, TS7019) inside an option the target removed into the pack finding on that option, as downstream evidence: the callbacks lost the types the option gave them, and the same edit resolves them. They no longer stand as separate breaking sites.

- [#143](https://github.com/uptide-dev/uptide/pull/143) [`883e587`](https://github.com/uptide-dev/uptide/commit/883e5877c8513fceb1bcf92954215ea9decae515) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `uptide pack test` scores each expected site at the severity of the rule or behavior note it belongs to, so a missed note that only needs a look, or a decision, no longer counts as a missed break. Behavior-note sites get their own precision and recall in the output and in `verification.json` (`behavior`, with the counts behind each rate), false negatives show their severity, and a rate with nothing to measure prints `n/a` instead of 100%, in `pack test` and in the README's packs table.

- [#154](https://github.com/uptide-dev/uptide/pull/154) [`7aa3d58`](https://github.com/uptide-dev/uptide/commit/7aa3d58b65c170d42e789f9db4b01a95af2b462b) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `uptide pack test` fails a pack's `verification.json` only when it claims more than the run measures (recorded verified, measured candidate). A pack recorded as candidate on purpose passes, with `recorded candidate by choice; measures verified`, and a record whose numbers differ gets a note instead of a failure. A `generic` ground-truth site now counts as a true positive for the rule that claims it.

- [#152](https://github.com/uptide-dev/uptide/pull/152) [`ca31aee`](https://github.com/uptide-dev/uptide/commit/ca31aee4e0635464648adfff663fea7cc6272a2f) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `uptide pack test` takes several packs: `uptide pack test zod ai`.

- [#159](https://github.com/uptide-dev/uptide/pull/159) [`1e157fd`](https://github.com/uptide-dev/uptide/commit/1e157fd9ec80f3d827136a041d6fe5357fc1554d) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `uptide pack test --json` times each ground-truth repository: `timing` gives the fetch, install and check wall time and the process's peak memory.

- [#144](https://github.com/uptide-dev/uptide/pull/144) [`0881185`](https://github.com/uptide-dev/uptide/commit/0881185bf57c8c332238b98ad3ea84663c279c64) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Ground truth can name a site for an upgrade that only adds lines inside an existing call, such as an option added to a constructor: the site is the call's start line, so a pack finding there scores as a true positive instead of a false positive. `pnpm packs:truth` drafts these anchors from insert-only hunks for review, and docs/packs.md and CONTRIBUTING describe the rule.

- [#156](https://github.com/uptide-dev/uptide/pull/156) [`9039e3c`](https://github.com/uptide-dev/uptide/commit/9039e3c194801d85df561bce0db7b4221de67e0a) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Public ground truth now exercises three rules that ran as assisted: zod `error-params`, stripe `api-version-unpinned` and next `stable-cache-exports`. Their rewrites run mechanically again. All three packs stay verified.

- [#138](https://github.com/uptide-dev/uptide/pull/138) [`0db5640`](https://github.com/uptide-dev/uptide/commit/0db5640c0106b7154e044c1e0467af897f31df0a) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Respect repository tsconfig file selection, recursive project references, and workspace project options when checking dependency upgrades. Compiler diagnostics outside every TypeScript project no longer produce breaking findings; pack rules and build-configuration findings retain their own scope. Repositories without a tsconfig retain importer-based compilation, with that fallback stated in the report.
  
  Anchor missing members supplied by dependency augmentations at their setup import, retaining affected calls as evidence instead of counting each call as a separate breaking edit.

- [#151](https://github.com/uptide-dev/uptide/pull/151) [`9ddaaff`](https://github.com/uptide-dev/uptide/commit/9ddaaffddfd9ac0ca3876e52494a20130dae9c45) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Add a candidate redis (node-redis) 4 to 5 and 5 to 6 migration pack, one rule set per major: an upgrade gets the rules of the majors it crosses, so 4 to 6 gets both. 4 to 5 covers `legacyMode`, `commandOptions` and isolation, scan iterators that yield batches, string SCAN cursors, boolean replies that became numbers, enums that became constants, `keepAlive`, `@redis/graph` and internal `dist` imports; 5 to 6 covers the RESP3 client type, `unstableResp3`, and the client defaults 6 changes (RESP3, command timeout, keep-alive delay, maintenance notifications) with a decision per client. Scored against five public upgrades; it stays a candidate until the stricter verified gate lands, since the core 4 to 5 API changes have no real site yet.

- [#135](https://github.com/uptide-dev/uptide/pull/135) [`42a3b54`](https://github.com/uptide-dev/uptide/commit/42a3b54a7c12c85cf28a5bc06a031d7076291c8b) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Move only packages released with the upgraded one. A pack's declared release group now bounds the lead's npm scope, and without one a same-scope package moves only when a pin, a peer or a release at the target relates it to the group. Packages of the scope that are versioned on their own (`@sentry/vite-plugin` 5.x, `@sentry/cli`, the old `@sentry/utils` 8.x) are reported as "stays at X" in `check`, the pull request and `pack test` instead of making `fix` refuse the whole upgrade. Registers the verified `@sentry/react` 10 to 11 pack.

- [#146](https://github.com/uptide-dev/uptide/pull/146) [`09b8682`](https://github.com/uptide-dev/uptide/commit/09b8682a0e5aeabc1c995a43e60f955b4d1bc0fd) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Report Stripe clients pinned to different API versions at the top of `check` and of the PR body, as a decision for the owner: every `new Stripe(...)` in TypeScript and JavaScript sources, scripts included, with the version it speaks after the upgrade (an unpinned client speaks the SDK default). The PR's decisions list, for each client behind the target, the changelog entries it would cross for the resources it calls. No pin is rewritten.

- [#140](https://github.com/uptide-dev/uptide/pull/140) [`bc428d1`](https://github.com/uptide-dev/uptide/commit/bc428d1a73eca0e4c47880f373c024770d9ec534) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Keep migration PR bodies within their size budget while preserving summaries, representative diffs, decisions, review warnings and verification ahead of changelog and transitive detail. Keep every evidenced Stripe change visible and uncapped; group and cap only other changes to used resources, link the full changelog, and identify omitted text in the retained report.

- [#145](https://github.com/uptide-dev/uptide/pull/145) [`3c8902d`](https://github.com/uptide-dev/uptide/commit/3c8902d0f63b7b335c91426829875f688e85ca5f) Thanks [@lucasbraum](https://github.com/lucasbraum)! - The zod pack migrates `ZodError#errors` to `.issues` by rule: reads (`error.errors[0].message`, `error?.errors`) and destructuring (`const { errors } = error` becomes `const { issues: errors } = error`) where the type checker resolves the receiver to `ZodError`, and reads off an untyped catch binding of a zod parse. Writes are left to the agent.

- [#127](https://github.com/uptide-dev/uptide/pull/127) [`c4ead4f`](https://github.com/uptide-dev/uptide/commit/c4ead4f594a675912ff093da18b33e8757d181e6) Thanks [@lucasbraum](https://github.com/lucasbraum)! - zod: `check` now reports `ZodError#formErrors` and `#errors` read off an untyped catch binding of a zod `parse`/`parseAsync` (`catch (error: any) { return error.formErrors.fieldErrors }`), which zod 4 removed and the compiler cannot see. Files that only import a schema from the repository's own module (`@/lib/zod`) are covered too. `fix` rewrites `<err>.formErrors.fieldErrors` and `<err>.formErrors.formErrors` to `z.flattenError(<err>)`, importing `z` where it is missing; every other read goes to the agent.

## 0.12.1

### Patch Changes

- [#125](https://github.com/uptide-dev/uptide/pull/125) [`609781b`](https://github.com/uptide-dev/uptide/commit/609781bc3c3670c282792a9126709ccc89170b4b) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `uptide init` pins the Uptide Action of v0.12.0

## 0.12.0

### Minor Changes

- [#114](https://github.com/uptide-dev/uptide/pull/114) [`ac2755f`](https://github.com/uptide-dev/uptide/commit/ac2755fd80d0ca16ebc83f06b7f8b7a37be9fc66) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Add a verified Next.js 15 to 16 migration pack with source-backed rules, lockstep release-group companions, required consumer builds, scoped config/convention discovery, and transactional middleware-to-proxy edits. Verify against two unchanged public upgrade baselines and document remaining generated-type, deprecation and runtime coverage limits.

### Patch Changes

- [#124](https://github.com/uptide-dev/uptide/pull/124) [`01553c7`](https://github.com/uptide-dev/uptide/commit/01553c76a8fad9d56a202ec90179205002da6e58) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Retain accepted agent patches and show migration choices in PR decisions. Merge paired compiler and pack findings, bound repeated test output, and scope Next platform minimum warnings to missing or insufficient versions.

- [#123](https://github.com/uptide-dev/uptide/pull/123) [`079f496`](https://github.com/uptide-dev/uptide/commit/079f496202a00e7553400d4b7b9bdeca8876fc2b) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Allow pnpm peer-suffix and non-resolution lockfile metadata changes during upgrades. Continue checking each unrelated package and importer specifier/resolved version, with named diagnostics for importer changes. npm and Yarn scope checks are unchanged.

- [#123](https://github.com/uptide-dev/uptide/pull/123) [`079f496`](https://github.com/uptide-dev/uptide/commit/079f496202a00e7553400d4b7b9bdeca8876fc2b) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Render applicable behavior notes under “Decisions for you” when a migration pack has no custom decision hook. Next 16 decisions now cite repository configuration, scripts, runtime declarations and missing parallel-route fallbacks instead of generic migration notes.

- [#121](https://github.com/uptide-dev/uptide/pull/121) [`3da4978`](https://github.com/uptide-dev/uptide/commit/3da49784dd6dd29594a40a374f0d55072874e0eb) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `uptide init` pins the Uptide Action of v0.11.2

## 0.11.2

### Patch Changes

- [#118](https://github.com/uptide-dev/uptide/pull/118) [`40b3c1f`](https://github.com/uptide-dev/uptide/commit/40b3c1f3d06f46bda4432056373898b014fa7f7e) Thanks [@lucasbraum](https://github.com/lucasbraum)! - The onboarding generator (`uptide/onboarding`, the "Add Uptide" pull request) writes
  `minReleaseAgeDays` to `uptide.yml`, with a comment, when the settings set it. Before, the
  setting was kept in the returned config but left out of the file.

- [#117](https://github.com/uptide-dev/uptide/pull/117) [`d1e7388`](https://github.com/uptide-dev/uptide/commit/d1e7388baccd115beb0845024b519ca8193c3ef4) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Let packs inspect declared config and convention files without imports and apply verified multi-file create, delete, write and rename transactions.

- [#116](https://github.com/uptide-dev/uptide/pull/116) [`4419673`](https://github.com/uptide-dev/uptide/commit/4419673a640909f5cf119cd9c3513c0fa07a316f) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Allow migration packs to require a successful repository build before publication, including subsequent verification runs.

- [#120](https://github.com/uptide-dev/uptide/pull/120) [`b7e0f42`](https://github.com/uptide-dev/uptide/commit/b7e0f42cb917544431fa0b1bc6eccc8b79129bdf) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `uptide pr` (and `fix --pr`) publishes when the migration branch is already on GitHub, as it is after a pull request was closed without merging. A branch holding only Uptide's commits is replaced with `--force-with-lease`, and an open Uptide pull request on it is updated instead of a second one being opened. A branch with anyone else's commit is never overwritten: the run goes to the next free `<branch>-2`, `-3`, … and the pull request says so. When publication fails in the Action, the job summary and run report name the reason.

- [#115](https://github.com/uptide-dev/uptide/pull/115) [`17cb9a2`](https://github.com/uptide-dev/uptide/commit/17cb9a21528bc387f379d0f8d938749229ddd843) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Support explicit pack release groups so installed lockstep companions move with their lead even without dependency edges or incompatible peers.

## 0.11.1

### Patch Changes

- [#112](https://github.com/uptide-dev/uptide/pull/112) [`b545027`](https://github.com/uptide-dev/uptide/commit/b5450273aecaa45683bd182a42c63e0b82f226fc) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `uptide init` writes a workflow that runs the Uptide Action of v0.11.0 (pinned by commit), the
  release that requires `anthropic-api-key`, instead of v0.9.0.

## 0.11.0

### Minor Changes

- [#109](https://github.com/uptide-dev/uptide/pull/109) [`7cf3bb8`](https://github.com/uptide-dev/uptide/commit/7cf3bb8410760e7cc31a6d67ee430f9e194f4ee8) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Uptide no longer opens a pull request for an upgrade it could not analyze. A major upgrade
  that no verified pack covers is never published: `uptide fix --pr` refuses it before anything
  changes, `uptide pr` refuses a stored run of one, and the Action reports it as `skipped` with
  `analysis: "none"` and the reason `no pack yet` instead of migrating it. A minor or patch
  without a pack is published only when the repository's own `build` script and tests pass
  after the bump; `fix` now runs the build for runs without a pack and records it in
  `verification.build`. Every PR description has a **Verified by** row naming what vouched for
  it (the pack, the type-check, the build, the tests) and what did not run.

### Patch Changes

- [#110](https://github.com/uptide-dev/uptide/pull/110) [`bb4c4d3`](https://github.com/uptide-dev/uptide/commit/bb4c4d3ad2159992639c30986bb3ad9ff2f4fdaf) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Nothing Uptide waits on can hang a run any more. Every registry request has a deadline that
  covers its body, and a stalled one fails with `REGISTRY_TIMEOUT` (answered from the cache
  when an expired entry exists). Local git commands have one too, and so does the shallow fetch
  of a ground-truth repository. `uptide pack test` runs each pack in a process of its own: one
  that runs longer than `--pack-timeout` (minutes, default 20) is stopped with everything it
  started and fails with the pack's name, and the other packs still run.

## 0.10.0

### Minor Changes

- [#108](https://github.com/uptide-dev/uptide/pull/108) [`38dcd4b`](https://github.com/uptide-dev/uptide/commit/38dcd4b6a5390504e531d5caed292416fda8be7f) Thanks [@lucasbraum](https://github.com/lucasbraum)! - The Uptide Action now requires the Anthropic API key. Without `anthropic-api-key` (or with it
  empty), in any mode, it stops before doing anything: the job summary says to add the
  repository secret `ANTHROPIC_API_KEY` (Settings → Secrets and variables → Actions), the run
  report has no upgrades and an error starting with `LLM_KEY_MISSING`, and the job fails.
  `uptide.run/v1` gains `llmKey` (`present` or `missing`; never the key). `uptide init` no longer
  writes `llm.enabled`, and refuses an existing `uptide.yml` that sets it to `false`, which the
  Action rejects. The CLI on your own machine still runs without a key.

- [#101](https://github.com/uptide-dev/uptide/pull/101) [`8452329`](https://github.com/uptide-dev/uptide/commit/845232920100cfa989f222ee98bb6535b04d1eed) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `list`, `check`, `fix`, `plan` and the Action never target a release younger than the
  repository's release-age policy: npm `min-release-age` (`.npmrc`), pnpm `minimumReleaseAge`
  with `minimumReleaseAgeExclude` (`pnpm-workspace.yaml`), or Yarn `npmMinimalAgeGate` with
  `npmPreapprovedPackages` (`.yarnrc.yml`). When none is set, the default of the pinned package
  manager version applies (pnpm 11 and 12, Yarn 4.15 and later: one day), labelled as such.
  When the newest release is too young, the newest one old enough is the target and the output
  says why (`4.6.7 is 2 days old; your policy is 7 days (min-release-age in .npmrc); targeting
  4.6.5`). When nothing newer than the installed version qualifies, the package is skipped with
  that reason, shown as `status: skipped` in `uptide.run/v1` and in the HTML list report.
  Companions and peers follow the same policy. `minReleaseAgeDays` in `uptide.yml` applies when
  the repository sets no policy itself. See `docs/config.md#release-age`.

### Patch Changes

- [#107](https://github.com/uptide-dev/uptide/pull/107) [`008f84a`](https://github.com/uptide-dev/uptide/commit/008f84a22fc8217340e3b3aea2637f9bd99abf75) Thanks [@lucasbraum](https://github.com/lucasbraum)! - The Action's commits are authored by the Uptide App's own bot account,
  `<app slug>[bot] <<bot user id>+<app slug>[bot]@users.noreply.github.com>`, resolved with the
  installation token, so GitHub links them to the App. When it cannot be resolved they keep
  `uptide[bot] <uptide@users.noreply.github.com>` and the job log warns.

- [#107](https://github.com/uptide-dev/uptide/pull/107) [`008f84a`](https://github.com/uptide-dev/uptide/commit/008f84a22fc8217340e3b3aea2637f9bd99abf75) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `uptide.run/v1` gains `verification.baselineHealth`: the repository before the upgrade in
  counts only (type errors, failing test runs, and missing-module errors under its own paths and
  in packages), so the dashboard can tell a run that could only compare from one that proved.
  No module or alias name leaves the fix report. Optional; absent in older reports.

- [#107](https://github.com/uptide-dev/uptide/pull/107) [`008f84a`](https://github.com/uptide-dev/uptide/commit/008f84a22fc8217340e3b3aea2637f9bd99abf75) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `check` analyzes a package's companions at the versions its upgrade moves them to, even when
  nothing imports them or they only carry types: `check react` in a Next app used to report
  `react-dom` and `@types/react` on their own at their installed versions, while `react` moved
  to 19. They are now members of `react`'s group, linked into the compile at 19, and the
  Action's job summary shows each one moving with `react`.

- [#102](https://github.com/uptide-dev/uptide/pull/102) [`78f1f7a`](https://github.com/uptide-dev/uptide/commit/78f1f7a3cbebb15e6d6c5c7413c4018246a7dd27) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `uptide init` writes a workflow that runs the released Uptide Action, `uptide-dev/uptide@2045c7dc0fcb7cd86522595de06308f154b1d8bf # v0.9.0`, and no longer notes that the action is not released yet.

- [#100](https://github.com/uptide-dev/uptide/pull/100) [`53f9f7d`](https://github.com/uptide-dev/uptide/commit/53f9f7ddf6e6c9a0409a21fc2f8fd9d108c91a1f) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `fix` reads pnpm lockfiles that install a package once per version of the upgraded one (`x@1(zod@3.25.76)` next to `x@1(zod@4.3.6)`) instead of failing with "Map keys must be unique". Variants that differ only by that version are compared as one entry; variants that differ in anything else are still checked one by one.

- [#107](https://github.com/uptide-dev/uptide/pull/107) [`008f84a`](https://github.com/uptide-dev/uptide/commit/008f84a22fc8217340e3b3aea2637f9bd99abf75) Thanks [@lucasbraum](https://github.com/lucasbraum)! - When Uptide refuses to publish a migration that did not verify, it words the reason as the
  run's verdict does: `1 type error introduced by the upgrade, 2 pre-existing` instead of
  `1 new type error`, and a test run that was already failing before the upgrade is named as
  such instead of as a failure of the migration.

- [#104](https://github.com/uptide-dev/uptide/pull/104) [`8fd120e`](https://github.com/uptide-dev/uptide/commit/8fd120e91500e28f2367dcd4ae9e4bbb97b91daf) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Reports no longer show a breaking count of 0 for a package without a migration pack: the
  terminal, the HTML report and the Action's job summary say `not analyzed: no pack yet`
  instead, and `uptide.run/v1` gains `analysis` (`pack` or `none`, absent when nothing was
  analyzed). A companion that `check` reports at its installed version (`react-dom` or
  `@types/react` with `react`) shows the versions it moves to and `moves with react`, carried as
  `movesWith`, instead of `up to date`; no upgrade kind is printed when nothing moves. The job
  summary lists breaking sites per package by path and line, and has no breaking-sites section
  when there are none. The generated workflow runs on `ubuntu-24.04` instead of `ubuntu-latest`.

- [#107](https://github.com/uptide-dev/uptide/pull/107) [`008f84a`](https://github.com/uptide-dev/uptide/commit/008f84a22fc8217340e3b3aea2637f9bd99abf75) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Reports say what the upgrade broke and what the migration left. `uptide.run/v1` gains
  `verification.typecheck.afterUpgrade`, the type errors right after the version bump and before
  any fix, next to `before` and `after` (optional; absent in older reports). The job summary
  prints `types 0 → 4 with the upgrade → 0 after Uptide`, and the pull request body and the
  terminal say `the upgrade broke 4 · Uptide left 0`.

## 0.9.1

### Patch Changes

- [#98](https://github.com/uptide-dev/uptide/pull/98) [`ef7a1ae`](https://github.com/uptide-dev/uptide/commit/ef7a1ae87df70559cd105632123fad40864cbd4a) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `fix` measures the repository before the upgrade and says first when it is unhealthy: "this repository does not type-check before the upgrade (205 errors, 129 from missing modules: …); verification can only compare, not prove". On such a baseline, a run that adds no error reads `no new errors` instead of `verification passed`, and a failing run says how many type errors the upgrade introduced and how many were already there. The gate is unchanged. `check` prints the pre-existing type errors under each compiled package, and the stored report carries `verification.baselineHealth` (type errors, failing test runs, missing modules grouped by path alias or package).

## 0.9.0

### Minor Changes

- [#93](https://github.com/uptide-dev/uptide/pull/93) [`765de77`](https://github.com/uptide-dev/uptide/commit/765de7789a5932c5111532a97d293c5b9ffa53f6) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `uptide fix <package>` with Anthropic selected runs assisted fixes as one Claude Agent SDK session in the temporary clone, covering the package's manual sites and their rule knowledge, gated once at the end of the session. It is the default when `@anthropic-ai/claude-agent-sdk`, an optional peer that is never bundled, is installed next to Uptide; without it, the patch executor runs and the output says what to install. Use `--agent patch` to opt out; other providers keep the patch executor. See `docs/decisions/0016-agent-sdk-executor.md`.
  
  Stripe period helpers accept both endpoint payload shapes, and both executors share the same period knowledge.

- [#94](https://github.com/uptide-dev/uptide/pull/94) [`5f54bad`](https://github.com/uptide-dev/uptide/commit/5f54bad1f393ae325b32dc555ce772b52cd59a5e) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `uptide/onboarding` loads where it broke: under plain Node ESM, Vitest and Turbopack, and in a browser bundle. It no longer inlines `yaml` (its CommonJS build called `require("process")` inside an ES module); `yaml` is now a dependency of the package. The entry is pure, with no file system and no Node globals: `loadUptideConfig` and `snapshotFromDisk` move to `uptide/onboarding/node` (breaking for code that imported them from `uptide/onboarding`). The command line is unchanged.

- [#92](https://github.com/uptide-dev/uptide/pull/92) [`b21a911`](https://github.com/uptide-dev/uptide/commit/b21a9118a9abf26257c4f088adf6d53752de5d4b) Thanks [@lucasbraum](https://github.com/lucasbraum)! - The Uptide Action: `action.yml` at the root of this repository now runs Uptide in a repository's own GitHub Actions (`mode: list | check | fix`, `package`, `config`, `anthropic-api-key`, `app-url`). It builds the engine of its own pinned commit, migrates with `--agent sdk` by default, and opens draft pull requests with a short-lived installation token of the Uptide GitHub App, obtained for the job's OIDC token, so those pull requests run the repository's CI. Each run writes an `uptide.run/v1` report to the job summary and sends it to the Uptide app; a failed upload is a warning. It replaces the earlier Renovate/Dependabot pull-request checker that lived at the same path; workflows pinned to an earlier commit keep running that one.
  
  New `uptide/report` export: the `uptide.run/v1` types, its JSON Schema (also `uptide/report/schema.json`), a validator and the summary renderer. The report holds no source code, diffs, snippets or environment values: paths, line numbers, symbol names and counts only.
  
  `uptide init` and the "Add Uptide" pull request now write `permissions: contents: read, id-token: write`; the Action pushes with the Uptide GitHub App's token instead of `GITHUB_TOKEN`.

### Patch Changes

- [#96](https://github.com/uptide-dev/uptide/pull/96) [`b9c1d71`](https://github.com/uptide-dev/uptide/commit/b9c1d71c386aa3102db9db916c5c9d3c1197f558) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Assisted fixes group two sites of one file into one task only when their fix is in the same place: the same repository declarations behind each compiler error, or none. Two React 19 `RefObject<T | null>` errors in one file whose prop types live in two components were sent as one task that could edit only the first component, and both stayed manual (a regression in 0.8.0).

## 0.8.0

### Minor Changes

- [#89](https://github.com/uptide-dev/uptide/pull/89) [`405f429`](https://github.com/uptide-dev/uptide/commit/405f429c88b417c3005f02090031d3dc5a09d1ce) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Experimental, hidden: `uptide fix <package> --agent sdk` runs assisted fixes as Claude Agent SDK sessions in the temporary clone, one per pack rule over its files, gated at the end of each task. Anthropic only; needs `@anthropic-ai/claude-agent-sdk` installed (an optional peer, never bundled). The default agent is unchanged. See `docs/decisions/0016-agent-sdk-executor.md`.

- [#91](https://github.com/uptide-dev/uptide/pull/91) [`d2ef2f1`](https://github.com/uptide-dev/uptide/commit/d2ef2f14d0b4a0f09efd860c4e1950f342c3fa56) Thanks [@lucasbraum](https://github.com/lucasbraum)! - New `uptide init`: writes `.github/workflows/uptide.yml` and `uptide.yml` for the repository, the same files the Uptide GitHub App proposes in its "Add Uptide" pull request. It detects the package manager, Node version and workspaces, pins every action to a commit, installs with lifecycle scripts off, and refuses with a reason (Bun, no lockfile, no package.json, a lockfile that disagrees with `packageManager`) instead of writing files that would not work. `--dry-run` prints the files and the pull request text. No commit, no push, no network.
  
  New `uptide.yml` settings file (`version: 1`, JSON Schema in `schema/uptide.v1.json`): `packages.allow`/`deny`, `schedule` (cron, or `manual` for a workflow that runs only when started by hand), `maxOpenPrs`, `llm.enabled`/`provider`, `maxCost` and `executor`. `list`, `check` and `fix` read it when present (or the file `--config` names), and flags override it; `fix` gains `--llm` to turn assisted fixes back on when the file turns them off. See `docs/config.md`.
  
  The generator is published as `uptide/onboarding` (ES module with types): `repoFacts` and `generateOnboarding` from the repository's root files, and the `uptide.yml` loader. It contains no analysis engine; the command line is unchanged.

### Patch Changes

- [#87](https://github.com/uptide-dev/uptide/pull/87) [`158d68e`](https://github.com/uptide-dev/uptide/commit/158d68e0e18358272e364f261704c1e45e318b32) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `fix` gets the assisted Stripe migration through on real repositories. The guide suggests the import the way the file's neighbours write theirs (a tsconfig `paths` alias such as `@/lib/stripe`, else an extensionless relative path; `.js`/`.ts` only where the repository already uses them), and no longer requires one spelling. A pre-existing error that an added import moves down a line is matched to itself, not reported as new. Sites of the same change in one file go to the agent as one task, with every enclosing function shown, and are accepted together. Jest related-tests runs pass the affected files before `--testPathIgnorePatterns`, which swallowed them; when a related-tests run fails before any test, or finds none, the repository's own suite runs and the report shows the scoped command and its output. Reports print the published CLI version instead of 0.1.0.

- [#89](https://github.com/uptide-dev/uptide/pull/89) [`405f429`](https://github.com/uptide-dev/uptide/commit/405f429c88b417c3005f02090031d3dc5a09d1ce) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Stripe pack: the subscription-period decisions now say that webhook payloads follow the API version set on each webhook endpoint, not the SDK pin, so a handler must read both the item-level and the subscription-level period until the endpoints move, and must not cast a missing timestamp into an Invalid Date.

## 0.7.5

### Patch Changes

- [#83](https://github.com/uptide-dev/uptide/pull/83) [`bda0b35`](https://github.com/uptide-dev/uptide/commit/bda0b353f80e29469eab58765df4d9475ad15d00) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Find more of what an upgrade breaks. Named checks now also compile the files that directly import a package's importers when what they import depends on the package, within a 20% memory budget relative to the same program's estimate (the same files on every machine), so a test calling a wrapped tool's `execute` is reported. Files the budget leaves out are named per workspace in the check and fix summaries, `report.json` and the HTML report. The `ai` pack flags `ToolLoopAgent`, `Agent` and `ToolLoopAgentSettings` type arguments, whose third position is now the runtime context, and finds renamed options inside spread objects, behind `as`/`satisfies`, and in an agent's `stream`/`generate` calls. Breaking recall: `ai` 36% → 82%, `zod` 71% → 74%, with no false positives.

- [#84](https://github.com/uptide-dev/uptide/pull/84) [`5c59257`](https://github.com/uptide-dev/uptide/commit/5c59257bcf0fb0c3ff56f7ee002481437d508d06) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Yarn 2 and 3 lockfiles: follow dependency references written without the `npm:` protocol, so a moved package's own subtree is recognized. `fix` no longer rejects a new major that swaps its dependencies (for example `cmdk` 0.2 → 1.0 replacing `@radix-ui/*` 1.0.0 with 1.1.x) as "changed resolutions outside the dependency subtree", and importer resolutions in these lockfiles are now compared too. Changes reached only from packages that did not move are still rejected. The report lists each allowed transitive change under the package that moved it.
  
  A root `resolutions`, `overrides` or `pnpm.overrides` entry that pins a package the upgrade moves now stops the run before the baseline and the install, naming the entry, instead of failing after the install (on medusa: 33 s instead of 11 min). With Yarn 2+, a moved package whose range the plan rewrote is pinned to the exact planned version too (it resolved the newest match before).
  
  Temporary clones are removed on exit, including after a failed or interrupted run. `--keep-temp` (or `--debug`, which also prints every phase) keeps one; `--keep` still works as before.

- [#85](https://github.com/uptide-dev/uptide/pull/85) [`0af3fed`](https://github.com/uptide-dev/uptide/commit/0af3fed93aa1114908bdce7911ce09c364af6594) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Fix a 0.7.4 regression: when a workspace declares the upgraded package both in `peerDependencies` and in `dependencies` or `devDependencies`, the widened peer range (for example `^18.3.1 || ^19.0.0`) replaced the installable range in the install and in the check that follows it. With Yarn it is no lockfile descriptor, so the check read an old copy and `fix` stopped with "Requested react@19.3.0, but … resolved 17.0.2". Peer ranges are now only validated and widened in the manifest: `dependencies`, `devDependencies` and `optionalDependencies` alone feed the install, `yarn set resolution` and the check.

- [#86](https://github.com/uptide-dev/uptide/pull/86) [`191c89e`](https://github.com/uptide-dev/uptide/commit/191c89e15048590128608768a3b1f0a89da24c47) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Fix `uptide pr --yes` opening a ready-for-review pull request when `--draft` is omitted. New pull requests now default to drafts, matching `fix --pr --yes` and the migration report's instructions.

- [#81](https://github.com/uptide-dev/uptide/pull/81) [`ac01a01`](https://github.com/uptide-dev/uptide/commit/ac01a01dc2d4d1924d1c1d7d0208dfadd09cfde4) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Respect the repository's JavaScript compiler setting when selecting scoped analysis roots. This prevents an `escapedName` crash during upgrades in mixed TypeScript/JavaScript monorepos while preserving analysis of enabled JavaScript files.

## 0.7.4

### Patch Changes

- [#79](https://github.com/uptide-dev/uptide/pull/79) [`560d87d`](https://github.com/uptide-dev/uptide/commit/560d87d546e224355ffb27955901ac960ec9895f) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Preserve workspace ranges that already accept upgrade targets, including companions, and report them as already compatible. Widen rejecting peer ranges without removing alternatives and give widening instructions for unsupported ranges. Fix the workspace-root command hint to retain the target and use positional package syntax without npx.
  
  Verify that installed target and companion versions exactly match the plan, including when ranges already accept the target. Preserve exact Yarn Berry resolutions without narrowing manifests and correct Yarn 3's build-suppression flag.
  
  Limit Yarn Berry descriptor pinning to unchanged compatible npm ranges and aliases, avoiding self-resolutions when an exact dependency is upgraded.

## 0.7.3

### Patch Changes

- [#77](https://github.com/uptide-dev/uptide/pull/77) [`38ffa16`](https://github.com/uptide-dev/uptide/commit/38ffa16d905f3b707e6b470049dfb72ed9a5cf46) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Present peer blockers in fix as a pending upgrade plan, without a failure marker or error prefix. Keep exit code 2, grouped blockers, and the Next command, and omit LLM spend when no call was attempted.

- [#70](https://github.com/uptide-dev/uptide/pull/70) [`d72e285`](https://github.com/uptide-dev/uptide/commit/d72e285b0272273ec1e53fd9f9633005f02950a4) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Let assisted fixes edit repository-local expected-type declarations linked by compiler diagnostics. Fix sites sharing a declaration together, while retaining program-wide type verification and strict patch scope.
  
  Identify verification diagnostics by source location, code and related locations so changed message details do not reject valid fixes. Resolve automatic type references against the target declarations, so React 19's removed global JSX namespace reaches the agent with the React pack guide.

- [#78](https://github.com/uptide-dev/uptide/pull/78) [`7662903`](https://github.com/uptide-dev/uptide/commit/766290311d2cffbf7e91a059022877286c6cb277) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Verify the exported migration branch has the exact tree that passed verification. Refuse success and publication when export fails, preserve the complete clone, and require the recorded verified tree before pushing a stored run. Report changed-file counts from the committed diff.
  
  Export fresh migrations to numbered branches when an existing branch has different content. Preserve identical packages' libc restrictions when older npm serializers omit them, without relaxing the resolution guard.

## 0.7.2

### Patch Changes

- [#69](https://github.com/uptide-dev/uptide/pull/69) [`6c5f163`](https://github.com/uptide-dev/uptide/commit/6c5f1637dc27b898130e193bb9f691815fd6a14a) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Automatically migrate single-argument Zod records to explicit string-key records, preserving the file's Zod import binding. Keep already explicit key/value schemas unchanged. Use the same unqualified target version in single-package check and fix suggestions.

## 0.7.1

### Patch Changes

- [#66](https://github.com/uptide-dev/uptide/pull/66) [`c5611f4`](https://github.com/uptide-dev/uptide/commit/c5611f44fb322f9a774de1b99844c93d331af453) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Include every advertised peer upgrade in the preflight's Next command, including blockers pulled along as companions, and replay the complete proposed upgrade set. Group blocker output by package with all rejected peers and preserve them in structured JSON on preflight failures and fix reports.

- [#65](https://github.com/uptide-dev/uptide/pull/65) [`35fe251`](https://github.com/uptide-dev/uptide/commit/35fe251a70983fb41e610d1ba34c0d412fc5a912) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Match compiler-confirmed React `useRef` symbol findings so zero-argument calls receive the existing initial-value fix. Route missing global `JSX` namespace diagnostics (TS2503) to the React 19 agent guidance without rewriting them automatically.

- [#68](https://github.com/uptide-dev/uptide/pull/68) [`4ed45ee`](https://github.com/uptide-dev/uptide/commit/4ed45ee54d3d2062b8d2fcd4647442c3545b9068) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Keep already-compatible peer companions at their installed versions, share the lowest compatible peer resolver with preflight, and reject planned downgrades before writing manifests or installing. Keep preflight versions authoritative throughout fix. Bound spinner text to terminal width, summarize install companions by count, and disable animation when stdout is piped.
  
  Handle npm's unavoidable reverse-peer re-resolution only when the upgrade stays within every previously declared range, keeps the major version, and never downgrades. List admitted packages and their ranges in the fix report and PR body, while preserving resolutions for other consumers and accounting for identical nested copies.
  
  Preserve grouped peer blockers and the complete Next command in JSON when the packaged CLI runs planning in its worker thread.

## 0.7.0

### Minor Changes

- [#60](https://github.com/uptide-dev/uptide/pull/60) [`7ec02e0`](https://github.com/uptide-dev/uptide/commit/7ec02e0a4e791558f83d9ddb64cca8cae5370241) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `check` reports one breaking finding when a member the target no longer sees was declared by
  your own code in an augmentation: a custom matcher on the global `jest.Matchers` in a test
  setup file, or an interface augmented in a `declare module "x"` block. The finding is anchored
  at that declaration (the `declare global` block, or the augmented interface), where the one
  edit is, and the call sites that fail (TS2339, TS2551) are listed under it as evidence, in the
  terminal, the HTML report and the JSON report. Before, each call site was a breaking finding
  of its own next to the declaration. The README's line budget no longer counts the generated
  "Verified packs" table, which grows one row per pack.

- [#64](https://github.com/uptide-dev/uptide/pull/64) [`86b24d2`](https://github.com/uptide-dev/uptide/commit/86b24d291685db47b57f4494da06efc2554f0f00) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Plan peer blockers before cloning or installing, suggest explicit compatible peer upgrades, and add repeatable `--allow-peer` with visible package-manager overrides and PR risks. Reject npm lockfiles that disagree with committed manifests before starting a migration.
  
  Collect peer blockers across the complete upgrade group and print one complete retry command. Include explicitly allowed peer packages in the old/new lockfile subtree union while retaining strict rejection of unrelated resolution changes.
  
  Accept same-content lockfile deduplication and descriptive metadata updates only when outside resolutions stay identical, and disclose accepted housekeeping in the fix report and PR description.

- [#63](https://github.com/uptide-dev/uptide/pull/63) [`8dcf5fb`](https://github.com/uptide-dev/uptide/commit/8dcf5fbac4e213a6f71b31b854fe8795739de7b6) Thanks [@lucasbraum](https://github.com/lucasbraum)! - A verified migration pack for Vitest 4 → 5, scored against votingworks/vxsuite and
  vitorvasc/opentelemetry-ecosystem-explorer at the commit before their own upgrade. It is verified
  with two public repositories and no false positive among breaking findings (recall 50%). Sites it finds: custom matchers declared on the global
  `jest.Matchers` or on a one-parameter `Assertion<T>`, `import '@testing-library/jest-dom/vitest'`
  registrations whose types stop reaching `expect`, the removed `bench` export, bare-directory
  `coverage.include` and `coverage.exclude` entries, and the removed `vitest/*` entry points
  (`vitest/coverage`, `vitest/reporters`, `vitest/environments` and `vitest/snapshot` are
  rewritten). What the compiler cannot see (mock history cleared by default, `testNamePattern`
  joined with " > ", hoisted `vi.mock` calls, un-awaited assertions, timers, report locations,
  browser mode) is listed for review.

### Patch Changes

- [#62](https://github.com/uptide-dev/uptide/pull/62) [`c0f8a70`](https://github.com/uptide-dev/uptide/commit/c0f8a70c5b73df11139d6ac01dac679a3b4de51a) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Preserve partial version ranges such as `^18`, `~18.2`, and `18.x` when fixing packages and their companions, including workspace manifests and pnpm catalogs. Reject unsupported complex ranges before cloning or spending on assisted fixes, with the declaration location and an installed-version replacement suggestion.

## 0.6.1

### Patch Changes

- [#56](https://github.com/uptide-dev/uptide/pull/56) [`c64ba2c`](https://github.com/uptide-dev/uptide/commit/c64ba2c74cd5ba5275a729c2274ae714240b33f3) Thanks [@lucasbraum](https://github.com/lucasbraum)! - The HTML report's light theme uses `#6A675F` for dimmed text (5.1:1 on the page background,
  was 4.2:1, below WCAG AA's 4.5:1), and the package's homepage is https://uptide-dev.github.io/docs.

- [#54](https://github.com/uptide-dev/uptide/pull/54) [`c502cc8`](https://github.com/uptide-dev/uptide/commit/c502cc831fd45a817b6e5de6e8a405e957e76995) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `fix` and `verify` install a repository that pins Yarn 2 or later in `packageManager` even
  when the `yarn` on PATH is classic 1.x or absent: the pinned version runs through corepack
  (`corepack yarn install ...`, download prompt off) without enabling corepack or changing
  anything on your machine outside corepack's cache. Before, Yarn stopped the run with "the
  current global version of Yarn is 1.22.22". When corepack is missing, the run stops before
  cloning with exit code 2 and the command to run (`corepack enable`); when corepack cannot
  fetch the pinned version, the message names `COREPACK_NPM_REGISTRY` for corporate mirrors.

## 0.6.0

### Minor Changes

- [#46](https://github.com/uptide-dev/uptide/pull/46) [`458aa14`](https://github.com/uptide-dev/uptide/commit/458aa144d3c3ab5739d70cdc0d44a29642563cd5) Thanks [@lucasbraum](https://github.com/lucasbraum)! - What changed in `check`:
  
  - **Breaking means confirmed.** A type-surface change is reported as breaking only when the
    compiler rejects your code against the target at that site, the runtime probe saw the
    export go, or a migration pack found it, in the verified tier as in the generic one. What
    nothing confirmed is listed as "possible impact", apart from the breaking count.
  - **Coverage, under every package.** `compiled 355 of 356 files in 5 workspaces; skipped:
    <reason (count)>` says how much of the code that uses the package the compiler judged, and
    the verdict says "types partly verified" when not every file was.
  - **TypeScript-version-aware defaults.** A repository on TypeScript 5 is read with
    TypeScript 5's defaults for what its tsconfig leaves unset (`strict` off, automatic
    `@types`), not the bundled TypeScript 6's. Monorepos compile far more of their files:
    workspace packages declared `workspace:*` under Yarn and npm resolve to their source,
    scoped programs keep the tsconfig's ambient declaration files, and a workspace that only
    peer-depends on a package finds the hoisted copy.
  - **Companions.** `check` and `fix` move `@types/<pkg>` with `<pkg>`, and a package released
    in lockstep with it (react-dom with react): `check react` 18 → 19 moves react-dom,
    @types/react and @types/react-dom together.
  - **One finding for a root cause that is one edit.** A compiler option (the global `JSX`
    namespace `@types/react` 19 removes, read by `"jsx": "preserve"`) and a repository
    parameter several call sites trip are each one finding at the place to edit, with the
    compiler errors as evidence.

- [#51](https://github.com/uptide-dev/uptide/pull/51) [`a18bebd`](https://github.com/uptide-dev/uptide/commit/a18bebde1b45819f275f8194ed589db742df25b9) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `check` reports one breaking finding when call sites in different workspaces trace back to
  the same local declaration (a parameter or prop whose type names something from the upgraded
  package): the finding is anchored at the declaration, where the one edit is, and the call
  sites are listed under it as evidence with an `N call sites in M workspaces` line, in the
  terminal, the HTML report and the JSON report. Before, a site alone in its workspace stayed a
  finding of its own, so a hook typed `RefObject<HTMLElement>` and called from three
  workspaces was three findings plus the one that mattered. The JSON report gains `root` on
  call-site findings and `workspace` on evidence sites; nothing is renamed or removed. The pack
  test scorer counts the anchor as the predicted site and never the evidence under it.

- [#49](https://github.com/uptide-dev/uptide/pull/49) [`2e5c510`](https://github.com/uptide-dev/uptide/commit/2e5c510c54b88bda11e1b889ca538b54089d518d) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Two fixes to `check`:
  
  - **A project whose tsconfig cannot be resolved is not compiled.** A tsconfig that `extends` a
    package or file that is not installed describes options the repository never builds with, so
    what a compiler reports there is not a place to change. `check` skips it, never turns its
    diagnostics into findings, and says so in the coverage line (a file governed by such a
    nested project is dropped from the workspace that happens to reach it):
    `compiled 5 of 7 files in 2 workspaces; not compiled: docs/tsconfig.json (extends "@tsconfig/docusaurus/tsconfig.json" cannot be resolved)`.
  - **A package that only peers on the package is left in place when its peer range rejects the
    target.** What always moves with the package stays as before: the release group published at
    the target's own version (`react-dom`), `@types/*`, the exact pins of the target, and the
    packages a pack names in `companions` (each with the official page that says so), even when their installed range already accepts the
    target. Any other package whose installed peer range rejects the target is not moved and not
    compiled at another version; `check` lists it under possible impact, never as breaking:
    `? possible impact, peer conflict: next-mdx-remote-client 1.1.2 declares react >= 18.3.0 < 19.0.0`.

- [#53](https://github.com/uptide-dev/uptide/pull/53) [`d33bdd0`](https://github.com/uptide-dev/uptide/commit/d33bdd0d1fff9e2b1ffeb50f9bdca3c02b292a5f) Thanks [@lucasbraum](https://github.com/lucasbraum)! - A verified migration pack for React 18 → 19, scored against excalidraw/excalidraw and
  tldraw/tldraw at the commit before their own upgrade. Rewrites by rule: `useRef<T>()` →
  `useRef<T>(undefined)`, `ref={(el) => (x = el)}` → a block body, and `React.MutableRefObject`
  → `React.RefObject`. `RefObject<T | null>`, the removed global `JSX` namespace, untyped
  `element.props`, the removed react-dom APIs and `PropsWithRef` go to the agent with the guide;
  what the compiler cannot see (errors no longer re-thrown, removed legacy APIs, `act` moved to
  "react", Strict Mode and Suspense changes) is listed for review. 2 public repositories, 100%
  precision on breaking findings (89 sites, none false), recall 69% on breaking sites; the
  sites it misses are listed in the pack test output.

### Patch Changes

- [#48](https://github.com/uptide-dev/uptide/pull/48) [`94611a9`](https://github.com/uptide-dev/uptide/commit/94611a9e5ed0ca1da332c286118bcd66b09795c2) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `check` compiles your code with the repository's own TypeScript (the `node_modules/typescript`
  its build uses, found the way `fix` has found it since verification), and falls back to the
  bundled compiler only when the repository installs none. Errors and their positions are the
  ones your `tsc` would print: a repository on TypeScript 4.9 is no longer judged by TypeScript
  6's rules. The coverage line says which compiler judged: `compiled 355 of 356 files in 5
  workspaces with the repo's TypeScript 4.9.5`.
  
  A workspace without a tsconfig of its own is now configured by the nearest one above it (a
  monorepo root whose `include` covers the workspace), for its options only; synthetic defaults
  apply only when no tsconfig exists anywhere.

## 0.5.0

### Minor Changes

- [#39](https://github.com/uptide-dev/uptide/pull/39) [`b9f9974`](https://github.com/uptide-dev/uptide/commit/b9f9974dba7237e8e411ead80f793453ab5ebc43) Thanks [@lucasbraum](https://github.com/lucasbraum)! - A verified migration pack for the AI SDK (`ai`) 6 → 7: the renamed options (`system` →
  `instructions`, `onFinish` → `onEnd`, `onStepFinish` → `onStepEnd`, `experimental_telemetry`
  → `telemetry`), `stepCountIs` → `isStepCount`, `fullStream` → `stream`, `totalUsage` → `usage`
  and the removed `experimental_*` options are rewritten by rule; telemetry `metadata`, tool
  `context` and the stream result helpers go to the agent with the guide; what the compiler
  cannot see (telemetry registration, results that now cover every step, rejected system
  messages) is listed for review. Scored against vercel/chatbot and miurla/morphic at the
  commit before their own upgrade: no false positive. `uptide pack test` gains
  `--update-fixtures`, fixture markers take the compiler's `message`, and ground-truth
  repositories can use bun.

- [#39](https://github.com/uptide-dev/uptide/pull/39) [`b9f9974`](https://github.com/uptide-dev/uptide/commit/b9f9974dba7237e8e411ead80f793453ab5ebc43) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `check` and `fix` upgrade a package together with the packages that must move with it,
  using the groups `list` already draws (family, peer link, shared pin), each at the version
  that agrees with the target. `fix ai` also bumps `@ai-sdk/react`, `@ai-sdk/provider` and the
  installed `@ai-sdk/*` providers in one install and one commit; check's plan, the fix summary
  and the PR description say which and why, and `fix` stops before changing anything when a
  member has no release that agrees. npm and pnpm installs resolve the exact version first,
  so a `^` range keeps the version the target pins. Ground-truth entries take `with`, the
  packages the real upgrade moved, and `pack test` fails when check would leave one behind.

- [#38](https://github.com/uptide-dev/uptide/pull/38) [`adaf8f9`](https://github.com/uptide-dev/uptide/commit/adaf8f915e746cc01f24cd60ed959989069db138) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Migration packs are a public, testable contract (docs/packs.md). `uptide pack new` scaffolds
  a pack (an example rule, a fixture pair, a test, empty ground truth) and registers it;
  `uptide pack test` scores packs against their fixtures and against public repositories at the
  commit before their upgrade, with precision and recall per rule, every false positive and
  false negative, and `--json` for CI. A pack is labeled verified only with ground truth from at
  least two public repositories and no false positive among its breaking findings; otherwise it
  ships as a candidate and `check`, `list` and `fix` treat the dependency as generic.

### Patch Changes

- [#44](https://github.com/uptide-dev/uptide/pull/44) [`b4cc21f`](https://github.com/uptide-dev/uptide/commit/b4cc21f8a38b8336f55413b57177e4911f23d77b) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `check` no longer dies with "Manipulation error: A syntax error was inserted." on packages
  whose type aliases give their type parameters defaults (`type-fest` 4 → 5, `i18next` 23 → 26):
  the alias body is read after the parameter list, not at the first default's ` = `, so these
  aliases are compared by the checker instead of breaking the comparison program.

- [#40](https://github.com/uptide-dev/uptide/pull/40) [`3e3a5fa`](https://github.com/uptide-dev/uptide/commit/3e3a5fa9f0774719421d3e8a75f2c0ed4d731ea1) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `fix` verifies with the repository's own TypeScript (its `node_modules/typescript`, or an
  ancestor's) or the bundled one, and never with a TypeScript that `NODE_PATH` or Node's global
  folders happen to provide. A machine with a global TypeScript 6 made verification report
  TS5107 deprecations the repository never sees.

- [#37](https://github.com/uptide-dev/uptide/pull/37) [`3e7f744`](https://github.com/uptide-dev/uptide/commit/3e7f744bc5f154ac1d3562928451df481970a926) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Gemini is labelled experimental: in `fix --help`, in the `LLM:` line `fix` prints, and in the
  docs. Its evaluation runs on the storefront fixture failed on service errors (HTTP 503/429),
  so its migration quality is not established yet.

## 0.4.0

### Minor Changes

- [#14](https://github.com/uptide-dev/uptide/pull/14) [`62b01d9`](https://github.com/uptide-dev/uptide/commit/62b01d9b911290ecb1e70426829ba79dbc32b116) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Uptide is now licensed under Apache-2.0

- [#3](https://github.com/uptide-dev/uptide/pull/3) [`bb2c00c`](https://github.com/uptide-dev/uptide/commit/bb2c00c635c5e79d95e52ee56a5ecd27def149b9) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Generic mode and support tiers.
  
  `uptide check` with no `--only` now analyzes every direct dependency that is behind, ranked
  by likely impact, within `--max-time` (default 60 s), and lists what it did not reach.
  Every dependency has a tier: `verified` (a migration pack) or `generic` (no pack: a finding
  is breaking only when the compiler or the runtime probe confirms it; the rest is in
  `--details`). One dependency failing no longer empties the report.
  
  `uptide fix --only <any dependency>` migrates a generic dependency with the agent under the
  same verification and publish gate, with `--max-cost` (default $1) and a pull request note
  that no pack covers the package. Without `ANTHROPIC_API_KEY` it says what it cannot do and
  changes nothing.
  
  `uptide plan` prints the order to upgrade in: target versions, peer-range constraints
  between packages and an effort estimate from the findings; also as JSON and HTML.

- [#34](https://github.com/uptide-dev/uptide/pull/34) [`089f7b9`](https://github.com/uptide-dev/uptide/commit/089f7b97177fd447e4dfe32cad6c77bb3e0224d0) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `list` reads well on large monorepos: one row per package, two priority tiers, names never truncated.
  
  #### Breaking for JSON consumers
  
  `uptide list --json` has **one entry per package** in `packages[]`, where it had one per
  installed version. A package that workspaces install at different versions now carries them
  all in a new field, and every other field describes the whole package:
  
  - `versions`: `[{ "version", "workspaces" }]`, oldest first, every installed version
    (outdated or not). Absent when all workspaces agree.
  - `current`: the oldest outdated version; `change`, `majorGap` and `tier` describe it.
  - `workspaces`: every workspace on an outdated version (was: those on `current`).
  - `usage` is counted once per package across the repository (it was repeated on each row).
  - `signals.security` covers the advisories of any installed version; its `fixedIn` is the
    first clean version above all of them.
  - New: `signals.drift` (`{ majors, workspaces }`) and `priorities[].tier`
    (`urgent` | `planning`); `priorities[].signal` can be `drift`.
  - `packages.length` (and the `outdated` count) is the number of packages, no longer of
    package versions.
  
  To read the old shape, expand each entry:
  `p.versions?.filter((v) => v.version !== p.latest).map((v) => ({ ...p, current: v.version, workspaces: v.workspaces })) ?? [p]`.
  `uptide plan` does exactly this, so it still plans each installed version.
  
  #### Changes
  
  - Workspaces on different versions share a row (`5.0.52, 7.0.59 → 7.0.128`), with
    `2 versions in 3 workspaces` in the last column (under the row when the terminal is too
    narrow). A new priority signal, version drift (different majors across workspaces), ranks
    below unsupported and above blocking.
  - PRIORITIES has two tiers: **Urgent** (advisories, deprecations) with a count, then **Worth
    planning** collapsed to its count until `--all`.
  - Names are never truncated: the name column fits the longest name (up to 45 characters, then
    the name gets its own line) and narrow terminals drop trailing columns instead.
  - `major ×2` reads `2 majors behind` in `list` and `check`, terminal and HTML; JSON keeps
    `majorGap`.
  - Compilers and bundlers (`typescript`, `@swc/core`, `esbuild`, `@babel/core`, `vite`,
    `webpack`) are tooling even when a script imports them, and a new major of one shows under
    TOOLING while it is collapsed: `compiler major: check build and tsconfig`.
  - A group whose labels would repeat (`@supabase/* 2 · @supabase/* 0`) lists its target majors
    alone (`→ 2.x · 0.x`); a group heading keeps its target and puts the command under it when
    the line is too long.

- [#20](https://github.com/uptide-dev/uptide/pull/20) [`197a414`](https://github.com/uptide-dev/uptide/commit/197a4148797a0621ec1cd7a5130b56cb72e84628) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `uptide list` opens with PRIORITIES: up to five rows, most urgent first, each with a one-line
  reason and the command to run. Signals are known advisories for the installed version (one
  request to npm's bulk advisory endpoint, public packages only; “advisories not checked” on
  failure), a deprecated installed version, a major line with no release in a year, a peer range
  holding another upgrade back and two or more majors behind; cheaper upgrades come first among
  equals. Runtime dependencies rank before dev-only ones (a dev package's advisory drops one
  severity step; dev rows say so), and an advisory row names its smallest fix, `fixed in 3.2.5
  (patch, same major)` or `needs 4.1.11 (major)`, ranks same-major fixes first and checks that
  version. `--no-advisories` (or `"advisories": false` in uptide.config.json) never sends the
  request. When nothing is urgent, it suggests the cheap batch. `Next` points to the top priority.
  Rules and weights: docs/priorities.md. No LLM calls.
  
  Groups: a scope is one family (`@radix-ui/*`) whatever versions its members are at, and
  packages group across scopes when a peer range of one's latest version needs the other or both
  pin the same exact dependency version (`ai + @ai-sdk/*`). Each group says why.
  
  The HTML report's tiles (Outdated, Major, Minor, Patch, Groups, Tooling, Priority, Verified,
  Possibly unused) filter the table, with the filter in the URL hash; each tile's count is the
  number of rows it shows. A Priorities block opens the report.

- [#5](https://github.com/uptide-dev/uptide/pull/5) [`f4a4674`](https://github.com/uptide-dev/uptide/commit/f4a467413b95f6e4e95bb826dbee8d9979db4e03) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Split fast dependency discovery (`uptide list`) from explicit analysis (`uptide check <package...>`). Check now requires package names and removes the implicit time budget. Plan uses discovery plus optional saved check results, with unknown effort until analyzed. Add positional fix names, memory-aware workspace scheduling, root-cause grouping and clear per-package recursion failures.
  
  Scope named checks and baseline compilation to importing files and their reachable dependencies. Calibrate memory estimates to that graph, use the full reservation for serial work, and retry parallel memory failures serially before skipping. Expand grouped root-cause locations only in detailed output.

- [#7](https://github.com/uptide-dev/uptide/pull/7) [`0dfed37`](https://github.com/uptide-dev/uptide/commit/0dfed37fed469b7ca3fecc2d2835edbffe977d55) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Support Anthropic, OpenAI and Gemini assisted fixes with provider/model selection, environment-only credentials, and a strict pre-call cost budget (default $1 per package). Keep the same patch verification and publish gate; add privacy-safe provider/model telemetry and documented model pricing.
  
  Select Sonnet 5.5 with medium effort after live storefront evaluation. Respect model-specific tool capabilities, retry rate limits within budget, and use Chat Completions for custom OpenAI-compatible endpoints.

- [#6](https://github.com/uptide-dev/uptide/pull/6) [`3820ca8`](https://github.com/uptide-dev/uptide/commit/3820ca83704b57b3f1a4ddf7ea86ef45ca499288) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Add anonymous telemetry with explicit opt-in, local on/off/status/show controls, CI opt-out, a strict privacy allowlist and best-effort PostHog EU capture configured at release time.

### Patch Changes

- [#32](https://github.com/uptide-dev/uptide/pull/32) [`36871e6`](https://github.com/uptide-dev/uptide/commit/36871e60b25a45f5028eb0417098f7f77652fa68) Thanks [@lucasbraum](https://github.com/lucasbraum)! - A package whose analysis fails no longer changes the results of the packages checked after it
  in the same run. A failure inside TypeScript's printer (a stack overflow, as `@types/node`
  20 → 22 caused before [#31](https://github.com/uptide-dev/uptide/issues/31)) left its partial output in the shared printer, and the next
  package's signatures silently began with it. Printing now recovers from a failed print, and
  after any package fails, `check` discards the shared TypeScript state (printer, the
  repository's program and checker, cached surfaces) before the next one.

- [#15](https://github.com/uptide-dev/uptide/pull/15) [`cbd7236`](https://github.com/uptide-dev/uptide/commit/cbd72365c468eb1f88da59a7321ec6aa164e4526) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `uptide fix` migrates the commit you have checked out, cloned from your local repository,
  instead of the remote's default branch: a repository whose local branch was ahead of `origin`
  failed with "no package.json". A branch that differs from its upstream is said to in one line,
  uncommitted files are left out and listed, and `--pr` stops before any work when the base
  branch on `origin` does not contain your commit (`--base <branch>` names another base) or the
  working tree is dirty (`--allow-dirty`).

- [#9](https://github.com/uptide-dev/uptide/pull/9) [`d04d569`](https://github.com/uptide-dev/uptide/commit/d04d569e7e8f6e672574cc272440d9af6c7f82c9) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Honor npm INI parsing and registry/auth configuration precedence for dependency discovery,
  with host/path-scoped credentials kept out of output and persistent caches. Fetch abbreviated
  metadata with 16 concurrent requests, 10-second per-attempt timeouts and one retry on timeout/5xx.
  Stop calling a host only after 401/403/405. Keep unresolved packages counted as unknown,
  group repeated diagnostics by host/reason, and retain one incomplete HTML row per package.
  
  Recognize package.json tooling fields, installed bins, AngularJS/gulp/Karma and hook configs,
  stylesheet imports and HTML node_modules assets before flagging possibly unused dependencies.
  Keep that section collapsed with cautious wording and per-package reasons. Number HTML
  sections sequentially according to the sections present.
  
  Classify non-registry declarations and aliases as intentional skips, with collapsed terminal/HTML
  reasons and no error exit. Resolve npm registry aliases by their real package names, preserve
  local import usage, and read the correct pnpm/Yarn alias versions from lockfiles.
  
  Recognize tool rc files, hook/task commands, generic package configuration fields, Karma
  short names and auto-loaded plugins, colliding bins and required direct dependencies.
  Show the actual shared failure reason in discovery summaries. Add opt-in list --verbose
  phase timings and file counts, and preserve pnpm default/named catalog discovery.
  
  Preserve independently used group members' classifications and reasons. Read legacy lint-staged
  linters maps alongside flat configs, keeping ignore globs separate from commands. Prune vendored,
  generated and Git-ignored sources, prefilter with text/lexical gates before full parsing,
  and distribute large syntax batches across CPU workers. Report per-reason skip counts in verbose
  output while retaining complete group membership in JSON and check commands.
  
  Keep tool-specific ignores out of source discovery: formatting/linting scopes do not imply
  unused code. Warn in the summary, HTML, JSON and verbose output when Git rules exclude more
  than half of candidate application sources, naming the responsible patterns. Count Git-ignored
  sources from filenames only; retain usage under blanket prettier/eslint/lint-staged ignores.

- [#8](https://github.com/uptide-dev/uptide/pull/8) [`3815579`](https://github.com/uptide-dev/uptide/commit/381557937995a132b4cb39a38627e551ec8762cd) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Correct dependency discovery for NestJS and other script/config-driven projects: separate tooling and required peers from possibly unused packages, group lockstep and peer-coupled upgrades, count imported value references, hide zero-count symbols, show major-version gaps, and omit workspace columns in single-package repositories.
  
  Add `uptide list --html [--open]` using check's report template and styling, with group check commands, copy buttons and collapsed tooling/possibly-unused sections. Reports exclude source code and local paths by default; `--details` adds file lists. Add a synthetic single-package pnpm NestJS regression fixture.
  
  Add scope/lead-package group names and `check --group` expansion, peer member labels, width-aware terminal columns and details-only symbols. Share an offline light/dark report design between list and check with one command per group, responsive rows and private default output. Read the installed CLI version for report headers, including when a package is versioned after bundling.
  
  Count only visible upgrade groups in list summaries, reserve scope titles for the primary
  lockstep set, and use unique lead-package selectors for independent groups. Align terminal
  version arrows and show only target ranges in group headers. Keep standalone HTML copy
  actions in the package row with accessible command labels and manual-copy fallback.

- [#33](https://github.com/uptide-dev/uptide/pull/33) [`278ec5c`](https://github.com/uptide-dev/uptide/commit/278ec5c8edb63103c9195a5424660b5eb4822280) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Polish from a real run of `list` and `check`:
  
  - A group mixing families is named after its hub, the package joining them that is nobody's
    peer (`ai + @ai-sdk/*`, `--group ai`), even when a family member is used in more files. Its
    target names each major when they differ (`→ ai 7 · @ai-sdk/* 4`) instead of a range.
  - A group member's priority reads `<member> <reason>`, dev first: `dev · @eslint/js deprecated: …`.
  - `check` states every analyzed package's verdict and what verified it, zero included:
    `0 breaking · compiled against 4.6.5: 0 new type errors`, or `types not verified: <why>`; in
    the terminal, the HTML report and JSON (`verdict`, and `compile.newErrors`).
  - "by rule / by agent" reads "auto-fixable / need the agent (LLM)" in `check` and `plan`, and
    "auto-fixed / fixed by the agent (LLM)" in what `fix` did.
  - Every suggested command is written the same way, `npx uptide …` (`npx uptide@next` from a
    prerelease), `list` included.

- [#31](https://github.com/uptide-dev/uptide/pull/31) [`7790986`](https://github.com/uptide-dev/uptide/commit/77909861a539c60f23737cfac4e92e7e18e2fb6e) Thanks [@lucasbraum](https://github.com/lucasbraum)! - `check` no longer overflows the call stack on packages whose declarations refer back to
  themselves, such as pino 10's `declare namespace pino { export { pino as default, pino } }`
  ([#4](https://github.com/uptide-dev/uptide/issues/4)). Extraction emits a name that reaches a declaration it is already inside, and stops
  there, recorded as `recursive type pino (compared by name)`; walks nested deeper than 32
  levels are cut the same way. The diff compares through those cuts by what they stand for, so
  `pino.pino.stdTimeFunctions` is not reported as removed when `pino.pino` became `pino` itself.

- [#2](https://github.com/uptide-dev/uptide/pull/2) [`6d4d75a`](https://github.com/uptide-dev/uptide/commit/6d4d75aa00929c1139831d92bbb52cd2472b1057) Thanks [@lucasbraum](https://github.com/lucasbraum)! - New tagline, "Migrations you can merge.", in the CLI help and the package description.

- [#17](https://github.com/uptide-dev/uptide/pull/17) [`2bea992`](https://github.com/uptide-dev/uptide/commit/2bea992bfdceb69008800308d5301104a5e884a0) Thanks [@lucasbraum](https://github.com/lucasbraum)! - Workspaces are read from `pnpm-workspace.yaml` with a real YAML parser: the flow form
  `packages: ['packages/*', 'apps/*']`, quotes, comments, `**` at any depth and `!` exclusions
  such as `'!**/test/**'` now work, where before the flow form found no packages and Uptide
  silently checked only the root. package.json `workspaces` is read as an array (npm, yarn) or
  as `{ packages: [...] }` (yarn). A workspace file whose patterns match no package is now an
  error that names the file and the patterns, instead of a check of the root alone.

## 0.3.0

First public release.

- First public release: `npx uptide` shows where zod and stripe stand, `uptide check` lists
  the call sites an upgrade breaks, and `uptide fix` migrates them on a verified branch.
- `uptide check` opens with one screen: a row per dependency, a line per change rule saying
  whether `fix` migrates it by rule, by agent or not at all, and the exact commands to run
  next. Progress is a single live line that disappears; `--details` lists every site, reason
  and compiler message, and `--verbose` now means one progress line per phase.
- Commands printed by the CLI and written into PR descriptions name the build that printed
  them: `npx uptide` for a stable version, `npx uptide@next` for a `next` prerelease.
- stripe: a test fixture that was already cast straight to an SDK type (`{...} as
  Stripe.Subscription`) and stops compiling after the bump is widened by rule to
  `as unknown as`, and reported as "Test fixture casts widened"; a fixture with only the old
  subscription period fields gains the item that carries them. Casts the agent adds are still
  rejected. The `subscriptionPeriod` helper is placed by rule above the doc comment of the
  function that needs it when no shared client module is in reach.
  The Tests line adds workspaces up: "5 tests in 3 files passed".
- `fix --pr` and `pr-body` share one gate: a failed verification or a run from an Uptide
  checkout with uncommitted changes is never published, and the CLI says why. Tests are
  detected the same way everywhere (workspace script, the vitest or jest config covering the
  workspace scoped to related tests, root script) and the report says what ran. A PR body
  only contains what its own run found, and a stripe body says when no API change affects
  the code.
  `fix` formats the files it edited, and only those, with the repository's formatter, and runs
  the repository's lint on them; a new lint failure fails verification. `uptide verify`
  verifies a migration branch again where it stands, adding commits and never rewriting
  history. A failing test outside the affected files is rerun once. The zod pack finds what
  depends on zod 3's default error messages and fixes the test that fails on them; the stripe
  pack makes tests follow the pinned API version.
- A registry that rate limits (HTTP 429) or is briefly down is retried with backoff, and a
  dist-tag it answered before is taken from the local cache when it cannot answer now. When
  it still fails, `check` exits 2 and says so, instead of "not analyzed" with exit 0.
  Under `Node16`/`NodeNext` module resolution, `check` now finds usages of packages that ship
  separate declarations for `import` and `require` (stripe 22 and newer); they were reported
  as not imported.
- Verification no longer touches your services: tests that need a database, cache or queue
  are opt-in (`--with-services --yes`, after printing what they connect to), and by default
  only unit tests run, with the integration tests counted in the report.
  `fix` and `verify` work in a temporary clone, never in your checkout, with lifecycle scripts
  and git hooks disabled for every command they run; the checkout is compared before and
  after. `verify --push --yes` pushes new commits from the clone, fast-forward only.
  The temporary clone is removed when the run is over and kept, with its path printed, only
  when the run fails, with `--keep`, or when it holds commits that are nowhere else.
  `uptide clean` removes kept clones older than 7 days.
