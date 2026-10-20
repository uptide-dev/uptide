# UpgradeBench v1 repositories

The repositories the bench runs on, picked by the rule below before any arm ran. No repository is swapped after results. The pre-run's 5 are in `bench/v1/pre5/selection.json`, with their check commands.

## Rule

As given on 2026-10-18:

> Public GitHub repos that merged a human major upgrade of one of our verified packs (zod, react, next, stripe, express, vitest, typescript, sentry, redis, ai, lucide-react, joi, react-router), with a lockfile, a test script and CI. Rule: the most recent qualifying human upgrade commits, at most 1 repo per pack, 5 repos, excluding ground-truth repos, the 3 pilot repos (calmcp, dms-saas, enki) and alanagoyal.

### Amendment, 2026-10-19T10:04Z, before any arm ran

> Add a second candidate source to the rule: merged Renovate/Dependabot major-bump PRs where a human pushed fix commits before merge (at least one non-bot commit touching source files). Ground truth is the merged PR's final diff against its base. Keep every other rule (in a verified pack's range, not in any ground-truth.json, tsc clean at parent, public, license OK, max 1 repo per pack).

**Why:** human commit search alone turned up too few qualifying upgrades in the window. Most recent major bumps land as bot pull requests, and some of those carry the human's migration as extra commits. The amendment also states two clauses the first wording left implicit: "tsc clean at parent" and "license OK".

## How each clause is applied

`bench/v1/find-candidates.mjs` does the search and the GitHub-side checks. Repository-side checks were run on clones at the parent.

- **Window:** commits and merges from 2026-04-01 to 2026-10-19, newest first, compared in UTC.
- **Sources:**
  - Human: commit search for the package name with "upgrade", "migrate", "bump", "update" and the target major. Also merged pull requests with the package name in the title, opened by a human.
  - `--bots` (the amendment): merged pull requests by `app/renovate` or `app/dependabot` with the package name in the title. At least one non-bot commit in the PR must touch a `.js/.ts/.jsx/.tsx/.mjs/.cjs/.vue/.svelte/.astro` file other than manifests and lockfiles.
  - For a pull request, the commit is its merge commit, and the parent is that commit's first parent: the base.
- **Human:** the author isn't a bot (Dependabot, Renovate, GitHub Actions, Snyk, Greenkeeper). A human's merge of a bot branch (`Merge pull request … from …/dependabot/…`) is the bot's upgrade. Only the bot source can take it, and only with a human fix commit.
- **Pack range:**
  - A `package.json` or pnpm catalog line in the commit moves the package from the pack's from-major to its to-major.
  - The pack ranges are zod 3→4, react 18→19, next 15→16, stripe ≥14 (any major), express 4→5, vitest 4→5, typescript 5→6, `@sentry/browser` and `@sentry/nextjs` 10→11, redis 4→5 and 5→6, ai 6→7, lucide-react 0→1, joi 17→18, and `react-router` or `react-router-dom` 6→7.
  - Sentry means its two verified packs, browser and nextjs.
  - joi's pack is `candidate`, not verified, but it is in the list as given.
- **Merged:** the commit is on the default branch. Forks are excluded.
- **Lockfile, test script and CI:**
  - A lockfile at the repository root at the parent.
  - A `test` script in the root `package.json` or in the manifest that holds the bump. The npm default "no test specified" doesn't count.
  - At least one `.github/workflows` file.
- **License OK:** a license that permits copying, running and modifying the code.
  - No license file, or a proprietary one, drops the repository.
  - GitHub's `NOASSERTION` was resolved by reading the file.
- **tsc clean at parent:** a `tsconfig.json` in the manifest's directory or at the root, and the type-check passes right after a frozen install with lifecycle scripts off.
  - The repository's own `typecheck` script counts, or else `tsc --noEmit` there.
  - A type-check that needs a build or codegen step first doesn't count as clean.
  - JavaScript repositories can't meet this clause.
- **Exclusions (144 entries):**
  - Every repository in a pack's `ground-truth.json` or `verification.json`, or in `bench/excluded.json`.
  - The pilot's 3 repositories.
  - The 30 OSS-sample repositories, which Uptide has already run on.
  - The `alanagoyal` owner.
- **One per pack:** each pack takes its newest qualifying candidate. Packs are then ordered by that candidate's date, and the first 5 run.

## Pre-run: the 5

| # | repo | pack | from → to | human commit | parent | source | license |
|---|---|---|---|---|---|---|---|
| 1 | dekkerglen/CubeCobra | express | 4.22.2 → 5.3.0 | `d63b749f` (#3052, 2026-10-19 01:15Z) | `486571bf` | human | Apache-2.0 |
| 2 | ZM-BAD/DAG-chat | vitest | 4.1.12 → 5.0.5 | `2f6f686e` (2026-10-18 19:36Z) | `340e0b09` | human | MIT |
| 3 | brendanlong/lion-reader | sentry (`@sentry/nextjs`) | 10.75.0 → 11.6.0 | `cb4729a7` (#1971, 2026-10-18 18:08Z) | `57c03c32` | Dependabot + human fix | MIT |
| 4 | sCypher-me/cypher-browser | lucide-react | 0.468.0 → 1.57.0 | `6307a23f` (#12, 2026-10-18 15:09Z) | `9e770c9e` | human | GPL-3.0 |
| 5 | GlennLab/LlamaDesk | react-router (`react-router-dom`) | 6.30.6 → 7.18.4 | `6034819c` (2026-10-18 09:42Z) | `2f0239df` | human | MIT-0 |

Full SHAs and check commands are in `pre5/selection.json`. Every human commit except lion-reader's moves more than the one package:
- CubeCobra refreshes all dependencies.
- DAG-chat also moves web-vitals and react-intersection-observer.
- cypher-browser also moves TypeScript to 7.
- LlamaDesk also moves echarts and vitest, and adds its LICENSE file.

## Next 5, for the full bench

The same rule, continued. Only 4 more packs had a qualifying candidate in the window; next, react, ai, joi and typescript had none left.

| # | repo | pack | from → to | commit | parent | source | license |
|---|---|---|---|---|---|---|---|
| 6 | kukukucode/fortylove | zod | 3.25.76 → 4.6.7 | `f11bf7a9` (#55, 2026-10-18 09:33Z) | `fe27ace3` | human | MIT |
| 7 | raouf-b-dev/ecommerce-store-api | redis | 5.8.0 → 6.3.0 | `857bbbdc` (#310, 2026-10-17 20:31Z) | `c9cd358a` | Dependabot + 3 human commits | MIT |
| 8 | clintongormley/waitron | stripe | 22.6.2 → 23.0.0 | `f4ef3630` (#1181, 2026-10-17 00:55Z) | `c7bd97bf` | Dependabot + 2 human commits | Elastic-2.0, source-available: confirm "license OK" before the full bench |
| 9 | (none) | | | | | | |
| 10 | (none) | | | | | | |

All three install and type-check clean at the parent. The full bench can widen the window to fill 9 and 10, with the rule unchanged.

## Candidates the rule matched and dropped

Every candidate that matched the search and the GitHub-side checks, and was newer than its pack's pick, is listed here, newest first.

| date (UTC) | repo | pack | why dropped |
|---|---|---|---|
| 10-19 06:54 | jeremylongshore/j-rig-skill-binary-eval | typescript | not tsc clean at parent: `typecheck` needs the workspace's `@j-rig/core` built first |
| 10-19 06:53 | warp-ds/elements | vitest | not tsc clean at parent: 112 errors, generated `locales/*/messages.mjs` missing until a build |
| 10-19 05:11 | ambystechcom/AmbyKit | zod | a human's merge of Dependabot PR #19 with no human change |
| 10-19 02:43 | sjclark76/metvuw-mobile | typescript | no license |
| 10-19 01:58 | esaueng/OpenFEA | lucide-react | not tsc clean at parent: 88 errors, workspace `@openfea/core` unbuilt |
| 10-19 00:53 | weudlll-cyber/seasonal-race-claude | express | JavaScript (no tsconfig): the tsc clause can't hold |
| 10-18 23:04 | gmartins-dev/portfolio-v4 | lucide-react | no license |
| 10-18 21:07 | HanielCota/Cotani-Painel | typescript | proprietary license ("Todos os direitos reservados") |
| 10-18 20:07 | SquareMediaGroup/destinychurch | stripe | no license |
| 10-18 19:51 | answerLoops/answerLoops | stripe | not tsc clean at parent: 3 errors, generated `@/.source/server` missing |
| 10-18 18:54 | niclydon/nexus-public | zod | not tsc clean at parent: 18 errors, workspace packages unbuilt |
| 10-18 16:11 | HamaFx/Kestrel | redis | not tsc clean at parent: `@kestrel/shared` unbuilt |
| 10-18 14:08 | BurhanRajkot/StreamVault | redis | no license |
| 10-18 12:41 | himanshu-nakrani/OpenRoleKB | sentry | a human's merge of Dependabot PR #32 with no human change |
| 10-17 07:24 | piquet-h/the-shifting-atlas | react-router | frontend install needs a private GitHub Packages dependency (401), and backend's `package-lock.json` is out of sync |
| 10-07 08:10 | DEFRA/trade-imports-animals-frontend | joi | JavaScript (no tsconfig): the tsc clause can't hold |

**Older candidates not taken:** these qualify but are older than their pack's pick: AdamWyatt34/FFXIVCraftingCompanion (sentry, 10-18 14:13), oaslananka/mcp-suite (react-router, 10-07).

**Search-level drops:** across the three searches, about 4,000 commit hits didn't bump a pack's package across its range in a manifest. These are search noise: minor bumps, other packages, and lockfile-only changes. Also dropped:
- About 1,450 hits by bot authors, and 73 human merges of bot branches.
- About 3,800 bot pull requests with no human source commit.
- The rest: no license, excluded, forks, no lockfile at the root, no CI, no test script, out-of-range majors (for example react-router 7→8), and a few commits GitHub wouldn't return.

## Notes

- **Timebox:** the selection was time-boxed to 30 more minutes on 2026-10-19 at about 00:15 PDT. The last searches spent most of their time waiting out GitHub's search and API rate limits and finished at 02:58 PDT, about 2.5 hours later. Selection was then closed with what they had found, without more search tuning.
- **Rule clauses settled before any run:** the bot-merge clause, the no-build reading of "tsc clean", and the license reading were all fixed during selection, before either arm ran, and are written above.

## Full bench, phase 1: the 5 headline repositories

**These 5 are the v1 dev set (2026-10-20).** Uptide 0.18.2's fixes (UPT-124 strut, UPT-125 ecommerce-store-api, UPT-126 support-dotcom-components, UPT-127/128 cost) were made by looking at their phase-1 runs. Results on them are reported only as dev set, never as headline numbers. The headline numbers come from the secondary set below, which the engine has never seen.

**Timebox:** 60 minutes, from 2026-10-20T04:30Z. Selection closed at 04:58Z with 5 repositories.

### Rule, as given for the full bench

> Public repos, permissive license, a real upgrade of a dependency that has a pack or breaking changes, sourced from either (a) a human PR or (b) a bot PR (Renovate/Dependabot) that a human then fixed by pushing commits. Base commit must build and pass tests before the upgrade. Do not reuse any pre5 repo.

Three repositories came with the brief and were re-verified here: fortylove, ecommerce-store-api and support-dotcom-components. The two others were picked from stripe, next, react, ai and joi.

### Clauses settled before any run

- **Permissive license:** MIT, Apache-2.0, BSD, ISC, MIT-0 or MPL-2.0. That drops waitron, the pre-run's 8th pick (Elastic-2.0, source-available), along with AGPL, CC-BY-NC and "all rights reserved".
- **Human:**
  - A commit whose author is a coding agent is not a human's, so it drops: `claude`, `mistral-vibe`, or any `*[bot]`.
  - A commit by a human with a `Co-Authored-By:` trailer naming an AI assistant is the human's. strut and yea are in on this reading.
- **Builds and passes tests:**
  - At the parent, with lifecycle scripts off, the repository's own CI commands for type-check, lint, tests and build all pass.
  - A build step CI runs before its tests counts (yea).
  - Generated code that only a lifecycle script makes doesn't count (CircleSfera's Prisma client).
- **Same Node for all:** Node 22.20.0, the machine's default. ecommerce-store-api asks for Node ≥24 (CI runs 24), and its 1,724 tests pass on 22 too.

### The 5

| # | repo | pack | from → to | PR, merged (UTC) | parent | source | license |
|---|---|---|---|---|---|---|---|
| 1 | kukukucode/fortylove | zod | 3.25.76 → 4.6.7 | #55, 2026-10-18 09:33 | `fe27ace3` | human | MIT |
| 2 | raouf-b-dev/ecommerce-store-api | redis | 5.8.0 → 6.3.0 | #310, 2026-10-17 20:31 | `c9cd358a` | Dependabot + 3 human commits | MIT |
| 3 | guardian/support-dotcom-components | typescript | 5.9.3 → 6.0.3 | #1856, 2026-10-19 13:59 | `4a256bfe` | Dependabot + 11 human commits | Apache-2.0 |
| 4 | stakwork/strut | ai | 6.0.235 → 7.0.105 | #11, 2026-09-18 04:13 | `41fb9678` | human, Claude co-author trailer | Apache-2.0 |
| 5 | yea-protocol/yea | stripe | 22.6.2 → 23.0.0 | #268, 2026-10-16 00:22 | `e1e4b7b0` | human, supersedes Dependabot #259; Claude co-author trailer | Apache-2.0 |

- Full SHAs and check commands are in `full/selection.json`.
- Diffs, silent changes and "mergeable" are in `full/ground-truth.md`.
- None of the 5 is in a pack's `ground-truth.json` or `verification.json`, in `bench/excluded.json`, in the OSS sample, in the pilot or in pre5.

### Re-verifying the three given

- **fortylove:**
  - The claim holds: no silent change, and tsc catches the `.default` change (TS2769 at `lib/server-action-validation.ts:29` on the bump-only tree).
  - Zod 4's stricter `.uuid()` and `.email()` also apply, but the human kept them, so they aren't scored.
- **ecommerce-store-api:**
  - The claim holds: 1 silent change (RESP3), and the human accepted it with a doc line at the options builder. The bump-only tree passes all 1,724 tests.
  - It fails lint (an unnecessary assertion), once the eslint cache is cold.
- **support-dotcom-components:**
  - The claim holds: the human change is tsconfig and eslint only, and root jest needs TZ=UTC (8 of 620 fail in America/Los_Angeles).
  - The human's change is needed for `cdk` lint, which the bump-only tree fails.

### Candidates looked at and dropped (stripe, next, react, ai, joi)

| repo | pack | why dropped |
|---|---|---|
| clintongormley/waitron | stripe | Elastic-2.0, not permissive (pre-run pick 8) |
| icco/etu-web#230 | stripe | CC-BY-NC-4.0 |
| coding4vinayak/aw-leadgenius#13 | stripe | "All rights reserved" |
| The-Obstacle-Is-The-Way/naltrexone-university#400 | stripe | proprietary license |
| Soluciones-Alexendros/saas-afiladocs#47 | stripe | "Todos los derechos reservados" |
| RubenOussoren/roms-finance#112, ghostfolio/ghostfolio#8182 | stripe | AGPL-3.0 |
| hideokamoto/kotodayori#107 | stripe | every commit authored by `claude` |
| JIGLE/situs#206 | stripe | authored by `claude`, no license file |
| hideokamoto/pricectl#43 | stripe | 35 commits, 56 files: review fixes mixed with the upgrade |
| CircleSfera/CircleSfera#253 | stripe | the backend's tsc and tests need `prisma generate`, which only a lifecycle script runs: 1,903 TS errors at the parent |
| FlorentDub/BouffePourTous#38 | next | every commit authored by `mistral-vibe` |
| workos/next-b2b-starter-kit#16 | next | no test script; also moves React 19, AuthKit 4 and ESLint 9 together |
| ncuyyGans/By-Sy#16, Ljupce11/next-food-delivery-app#9 | next | no license |
| anyuer678/lumen#19 | react | the React app in `web/` has no test script |
| MAXOUXAX/Isabelle#347 | ai | AGPL-3.0 |
| ringotypowriter/yachiyo#70 | ai | 65 files across two apps; strut is newer to check and smaller |
| (joi) | joi | no human 17 → 18 upgrade in the window: only Snyk patch bumps within 18 |

**Search:**
- `bench/v1/find-candidates.mjs` (`ONLY=stripe,next,react,ai,joi`, both modes) ran for 17 minutes and was stopped.
  - Its bot mode had read 611 bot pull requests, newest first, back to 2026-10-19 22:05Z. None had a human source commit.
  - Its human mode returned nothing in that time.
- The picks came from GitHub pull-request search instead. It covered human upgrade titles, Stripe's `endive` API version, Next 16's middleware-to-proxy rename and AI SDK v7, plus 96 bot bump PRs for stripe, next and joi. None of those 96 had a human, non-merge commit touching source.

### Disclosures (added 2026-10-20, after the phase-1 runs started; no scoring or ground-truth change)

- **AI co-author trailers:** strut (#11) and yea (#268) are counted as human. Each commit's author is a human (Evanfeenstra; solomonjames), and the commits carry a `Co-Authored-By: Claude` / `Claude Opus 5.5` trailer. The clause above was settled before any run. A stricter reading, human-only commits, would drop both.
- **fortylove, Zod 4's stricter `.uuid()` and `.email()`:** listed in the ground truth as informational, not scored. The reasons:
  - `.uuid()` (`uuidSchema`, `lib/input-validation.ts:27`, plus inline `z.string().uuid()` in `faq-actions.ts:158` and `chatbot/preview/route.ts:18`):
    - It validates ids that the app's own pages send back: event, FAQ, category, submission and user ids. Every table makes them with `gen_random_uuid()` (`supabase/schema.sql`, `supabase/migrations/*`), and user ids come from Supabase auth. Both are RFC 4122 v4 UUIDs, which Zod 4 accepts.
    - Behavior changes only for an id that isn't RFC-versioned, such as the all-zero or `00000000-0000-0000-0000-000000000001` fixtures. Those are now rejected where v3 accepted them. No id the app generates is one.
    - The human left it as it was.
  - `.email()` (`lib/ops-policy.ts:4`, `lib/server-action-validation.ts:84`):
    - It validates an admin's notification and escalation address in settings forms. Zod 4's pattern is stricter: unusual local parts and some unicode domains that v3 accepted are rejected.
    - The input is a settings form an admin fills in, so a rejection shows there.
    - One read path also parses the stored value (`lib/server/ops-notifications.ts:7`, `notificationSettingsSchema.parse`). An address saved under v3 that v4 rejects would make that read throw. Whether such an address exists depends on production data, which the bench can't see.
    - The human left it as it was.
  - Neither is scored: the human's merged change is the reference, and it kept both. A run that changes either one is neither credited nor penalized beyond the coverage and unrelated-hunk columns.
- **ecommerce-store-api's Node:** `package.json` declares `engines.node >=24.0.0`, and CI runs Node 24. Every phase-1 run used Node 22.20.0, the machine's default for all arms. The parent passes all 1,724 tests on Node 22 (and on 24.22.0).
- **support-dotcom-components' mergeable bar:** the CI set.
  - The checks are root lint and prettier, root tsc and tests, the production server build and the dotcom build, plus `cdk` lint, prettier and synth.
  - Out of the bar: `cdk`'s own `tsc` build (TS5107 at the parent's tsconfig on TS 6, and TS5107 + TS2688 on the human commit) and `cdk`'s jest snapshot (fails at the parent and on the human commit). CI never runs the `cdk` tsc build.
  - The bump-only finding in `cdk` anyway: `pnpm --dir cdk lint` fails with 5 errors, all in `cdk/lib/dotcom-components.test.ts`: 4 `@typescript-eslint/no-unsafe-call` ("Unsafe call of a type that could not be resolved", at 5:1, 6:2 and 15:3 twice) and 1 `no-unsafe-member-access` (`.toMatchSnapshot`, 15:29). The jest globals' types no longer resolve without `"types": ["jest", "node"]`. The human turned that rule and `no-unsafe-member-access` off in `cdk/eslint.config.mjs`.

## Full bench, phase 2: the secondary set

The headline set: 5 repositories the engine has never seen. Picked by the procedure below, written and committed before any search was run.

**Timebox:** 90 minutes, from 2026-10-20T20:30Z.

### Rule

The same as phase 1: public, permissive license (MIT, Apache-2.0, BSD, ISC, MIT-0 or MPL-2.0), a real upgrade of a dependency with breaking changes (a major), from a human PR or a Renovate/Dependabot PR a human fixed with commits, and a base that installs, builds and passes its tests under TZ=UTC with lifecycle scripts off. The human clause is phase 1's: an upgrade commit authored by a coding agent (`claude`, `mistral-vibe`, `copilot`, `codex`, `devin`, `cursor`, any `*[bot]`) drops; a human author with an AI `Co-Authored-By:` trailer counts as human and is disclosed.

### Exclusions

`secondary/excluded.txt`, 134 entries, lower case, built from:
- phase 1's list (120): every pack's `ground-truth.json` and `verification.json` as of phase 1, `bench/excluded.json`, the 30 OSS-sample repositories, the pilot's 3 (calmcp, dms-saas, enki), the pre5 repositories and the `alanagoyal` owner;
- every `repo` field and every `github.com/<owner>/<name>` in every `packages/core/src/packs/*/ground-truth.json` and `verification.json` on `main` (`c64fb88`), in PR #269 (Prisma: AlexAgo83/cr-league, BearStudio/start-ui-web, MarvinLeRouge/HexaRot, basaltkit/basalt, bcgov/nr-permitconnect-navigator-service, jqlang/playground, openwallet-foundation-labs/ehr-wallet) and in PR #105 (recharts: hyperdxio/hyperdx, shadcn-ui/ui), the only open pack PRs;
- the pre5 and dev-set repositories (`pre5/selection.json`, `full/selection.json`).

### Search procedure (fixed before looking)

- **Dependencies, in this order,** alternating a verified Uptide 0.18.2 pack and a dependency with no pack:
  1. zod 3 → 4 (pack, verified)
  2. tailwindcss 3 → 4 (no pack)
  3. express 4 → 5 (pack, verified)
  4. eslint 9 → 10 (no pack)
  5. vitest 4 → 5 (pack, verified)
  6. jest 29 → 30 (no pack)
  7. next 15 → 16 (pack, verified)
  8. mongoose 8 → 9 (no pack)
  9. react-router / react-router-dom 6 → 7 (pack, verified)
  10. @prisma/client 6 → 7 (no pack in 0.18.2: the pack is draft PR #269)
- **Window:** pull requests merged 2026-07-01T00:00Z to 2026-10-20T20:30Z.
- **Source, per dependency:** `gh search prs <package> --merged --merged-at 2026-07-01..2026-10-20 --language typescript --sort created --order desc --limit 100`, kept when the title names the package and the target major (`v4`, `@4`, ` 4`, `to 4`, `4.x`, or a `<from> to <to>` version pair). Candidates are screened newest merge first.
- **Taking picks:** round-robin over the list in order. Each dependency's first qualifying candidate is taken in turn, until 5 are picked. A second repository for a dependency comes only after every dependency has had its turn, and never a third. A dependency gets at most 8 screened candidates per turn; with none qualifying, it gives up its turn.
- **Screening, in this order, stopping at the first failure:** excluded or fork; license; author (human or bot-with-human-fix, never a coding agent); the merged diff moves the package across the major in a `package.json` or catalog; the diff changes a file other than manifests and lockfiles; the diff doesn't bundle other work (no other non-companion major, at most 40 files); lockfile at the root, a test script and CI; a frozen install, type-check, lint, tests and build pass at the base with TZ=UTC and scripts off.
- **Recorded for every candidate screened:** repo, PR, merge date, and kept or why dropped.
- **For each pick:** whether Uptide 0.18.2 has a verified pack for that upgrade, the human PR's merge date, license and author check.
