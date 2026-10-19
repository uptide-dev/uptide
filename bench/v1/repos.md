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
