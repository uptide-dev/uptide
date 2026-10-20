# UpgradeBench v1 full bench, phase 1: results (2026-10-20)

5 headline repositories from `../repos.md` (phase 1), two arms, once each, with the human commit checked the same way as the reference. Phase 1 only: no second or third run, no secondary set.

- **Arm A, Uptide:** `uptide@0.18.1` from npm, `claude-sonnet-5-5`, $1 cap (`--max-cost 1`).
- **Arm B, Claude Code:** 2.1.283 (every run, per `meta.json`), `claude-opus-5-5` at medium effort, $5 cap (`--max-budget-usd 5`), with the prompt in `../arms.md` word for word.
- **Both:**
  - `ANTHROPIC_API_KEY`, not a logged-in session.
  - A parent-only repository with no remote.
  - TZ=UTC.
  - Node 22.20.0.
  - Lifecycle scripts off.

**Ground truth:** `ground-truth.md` and `selection.json`, committed in `8239a6d` and pushed to `bench/upgradebench-v1-full` at 2026-10-20T05:04:12Z. The first run started at 05:04:34Z and the last ended at 05:38:27Z, so every run is after it.

Raw results are in `runs/`, one directory per run with `meta.json`, `checks.json`, `ci.json`, `pr.json` and `isolation.txt`. `key.tsv` maps each run to its arm, and `scores.json` holds the scored rows.

**Reruns:** none. No run died on auth, a rate limit or infrastructure. strut's Uptide run ended at exit 2 on an engine refusal, not infrastructure, so it isn't rerun-eligible and stands as run.

## Summary

"Mergeable" is the bar in `ground-truth.md`:
- Every check in `selection.json` passes, or fails exactly where the human commit fails.
- Fork CI passes, or fails only where the human commit's fails.

| repo | pack | Uptide 0.18.1 (Sonnet 5.5, $1) | Claude Code 2.1.283 (Opus 5.5, $5) |
|---|---|---|---|
| fortylove | zod 3→4 | **mergeable**; all checks ok, CI 2/2 as human; $0.04¹, 101 s | **mergeable**; all checks ok, CI 2/2 as human; $0.23, 78 s |
| ecommerce-store-api | redis 5→6 | **not mergeable**: type-check and lint fail; CI adds Type Check and Code Quality failures; it moved typeorm 0.3 → 1.1 as a peer blocker; RESP3 named, not pinned²; $0.51¹, 531 s | **mergeable**; all checks ok, CI fails only the human's 6; RESP2 pinned (silent site caught by edit); $0.63, 215 s |
| support-dotcom-components | typescript 5→6 | **mergeable**³; all checks ok (cdk lint fixed by tsconfig, not by turning rules off); also moved `@guardian/ophan-tracker-js` 2→3 unasked (issue 5); $0.10¹, 198 s | **mergeable**³; all checks ok, same tsconfig fix; $0.23, 143 s |
| strut | ai 6→7 | **no PR**: refused ("Requested ai@7.0.105, but . resolved 7.0.146"); 0/4 silent sites; $0.00, 35 s | **mergeable**; all checks ok, CI pass; 4/4 silent sites fixed by edit, plus a regression test; $2.88, 392 s |
| yea | stripe 22→23 | **code mergeable, CI not**⁴: all checks ok; CI fails `pr-body/description` only; $0.14¹, 92 s | **code mergeable, CI not**⁴: all checks ok; CI fails `pr-body/description` only; $0.60, 147 s |
| **mergeable (written bar)** | | **2 / 5** (fortylove, support-dotcom-components) | **4 / 5** (all but yea) |
| **mergeable on code (yea's PR-template check aside)** | | **3 / 5** | **5 / 5** |
| **silent changes caught** | | 1 / 5 by the committed rule, 0 / 5 by edit (ecommerce named, not pinned; strut never ran) | **5 / 5**, all by edit |
| **cost, total** | | **$0.791 SDK-reported, reconciliation pending**¹ | **$4.567, hand-verified** |
| **wall, total (median)** | | 957 s (101 s) | 975 s (147 s) |

¹ **Arm A cost is SDK-reported and the reconciliation is pending.** It's `costUsd` from `uptide fix --json`, which 0.18.1 takes from the Agent SDK's `total_cost_usd`, with input and cache tokens merged into one `inputTokens` (issue 1). It can't be redone by hand from Uptide's output. The Console total for the bench key over the run window minus the hand-verified Arm B total gives the Arm A error. See "Cost" below.

² **ecommerce silent site:**
- By the committed rule (any mention in the PR body), Uptide's run counts as caught. Its body says "redis 6 changes client defaults: RESP3 instead of RESP2 … To keep 5's behavior, set `RESP: 2`" and asks the owner to decide.
- By the brief's stricter reading ("pins the protocol or mentions the change at that code location"), it's missed. The mention isn't at the options builder: it's a general bullet, and one more attached to the Postgres files it changed.
- Claude Code pinned `RESP: 2` in `buildNodeRedisClientOptions` and added a test.

³ **support-dotcom-components' CI on a fork:** the build job is skipped (it doesn't run on forks), and only `CORE4 label enforcement / require-label` runs. It fails for all three, the human's included, so fork CI gives no code signal. The local CI set (`selection.json`) is the bar, and every check passes.

⁴ **yea's `pr-body/description`:** it checks only a pull request description's shape: Summary, Evidence, and "Door" and "Blast radius" under Merge danger (`scripts/check-pr-body.mjs`). The fork PR's body is the run's summary or PR body, which doesn't follow the template. The human's PR body did. Every code job (typescript 20 and 22, python, site, CodeQL, osv) passes for both arms. By the written bar it's a CI failure the human doesn't have, so neither arm counts as mergeable there.

## Scores (score.mjs)

`BENCH_OUT=<out> BENCH_SELECTION=bench/v1/full/selection.json node bench/score.mjs --unblind`

| repo | arm | exit | coverage | missed | unrelated | regressions vs human | silent changes caught | silent FP | states unverified | local checks | fork CI | cost | wall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ai-strut | claude | 0 | 27/39 | 12 | 5 | none | 4/4 (edit 4) | 0 | yes | install ok, typecheck ok, test ok, build ok | 1 pass, 0 fail | $2.88 | 7 min |
| ai-strut | human | 0 | 39/39 | 0 | 0 | none | 4/4 (edit 4) | 0 | no | install ok, typecheck ok, test ok, build ok | 1 pass, 0 fail | $0.00 | 0 min |
| ai-strut | uptide | 2 | 0/39 | 39 | 0 | none | 0/4 (edit 0) | 0 | no | install ok, typecheck ok, test ok, build ok | none | $0.00 | 1 min |
| redis-ecommerce-store-api | claude | 0 | 2/7 | 5 | 2 | none | 1/1 (edit 1) | 0 | yes | install ok, typecheck ok, lint ok, test ok, build ok | 10 pass, 6 fail | $0.63 | 4 min |
| redis-ecommerce-store-api | human | 0 | 7/7 | 0 | 0 | none | 1/1 (edit 1) | 0 | no | install ok, typecheck ok, lint ok, test ok, build ok | 10 pass, 6 fail | $0.00 | 0 min |
| redis-ecommerce-store-api | uptide | 1 | 0/7 | 7 | 20 | local typecheck, local lint, ci CI/Code Quality, ci CI/Type Check | 1/1 (edit 0) | 0 | yes | install ok, typecheck FAIL, lint FAIL, test ok, build ok | 6 pass, 5 fail | $0.51 | 9 min |
| stripe-yea | claude | 0 | 4/8 | 4 | 0 | ci pr-body/description | n/a | 0 | no | install ok, lint ok, test ok, build ok | 14 pass, 1 fail | $0.60 | 2 min |
| stripe-yea | human | 0 | 8/8 | 0 | 0 | none | n/a | 0 | yes | install ok, lint ok, test ok, build ok | 15 pass, 0 fail | $0.00 | 0 min |
| stripe-yea | uptide | 0 | 4/8 | 4 | 0 | ci pr-body/description | n/a | 0 | yes | install ok, lint ok, test ok, build ok | 14 pass, 1 fail | $0.14 | 2 min |
| typescript-support-dotcom-components | claude | 0 | 0/4 | 4 | 0 | none | n/a | 0 | no | install ok, typecheck ok, lint ok, test ok, build ok | 0 pass, 1 fail | $0.23 | 2 min |
| typescript-support-dotcom-components | human | 0 | 4/4 | 0 | 0 | none | n/a | 0 | no | install ok, typecheck ok, lint ok, test ok, build ok | 0 pass, 1 fail | $0.00 | 0 min |
| typescript-support-dotcom-components | uptide | 1 | 0/4 | 4 | 0 | none | n/a | 0 | yes | install ok, typecheck ok, lint ok, test ok, build ok | 0 pass, 1 fail | $0.10 | 3 min |
| zod-fortylove | claude | 0 | 1/4 | 3 | 0 | none | n/a | 0 | yes | install ok, typecheck ok, lint ok, test ok, build ok | 2 pass, 0 fail | $0.23 | 1 min |
| zod-fortylove | human | 0 | 4/4 | 0 | 0 | none | n/a | 0 | no | install ok, typecheck ok, lint ok, test ok, build ok | 2 pass, 0 fail | $0.00 | 0 min |
| zod-fortylove | uptide | 0 | 1/4 | 3 | 0 | none | n/a | 0 | yes | install ok, typecheck ok, lint ok, test ok, build ok | 2 pass, 0 fail | $0.04 | 2 min |

Columns:
- **coverage:** human code hunks the run also changed.
- **silent changes caught:** sites caught by an edit or by a mention (ADR 0017, `selection.json` `silent`).
- **states unverified:** the run's summary or PR body says what it didn't verify.

strut's Uptide row shows "ok" checks because its head is the parent: it changed nothing.

## Per repository

| repo | arm | mergeable | silent caught / missed | build / lint / test vs baseline | cost | wall | PR body explains decisions |
|---|---|---|---|---|---|---|---|
| fortylove | Uptide | yes | n/a (no sites) | all as baseline, all pass | $0.037 (SDK-reported) | 101 s | yes: "Decisions for you", `.prefault("false")` over `.default(false)`, with the reason |
| fortylove | Claude Code | yes | n/a | all pass | $0.231 | 78 s | yes: the uuid → `z.guid()` choice and the `.email()` kept, each with a reason; says build not run |
| ecommerce-store-api | Uptide | no | 1/1 by the committed rule (mention); missed at the location (strict) | **type-check FAIL, lint FAIL** (baseline pass); test, build pass | $0.514 (SDK-reported) | 531 s | yes: an agent-led draft that names the typeorm peer blocker, 3 test files left, and the RESP3 decision for the owner |
| ecommerce-store-api | Claude Code | yes | 1/1 by edit (`RESP: 2` + test) | all pass | $0.626 | 215 s | yes: the protocol decision and `quit()` kept, with reasons |
| support-dotcom-components | Uptide | yes | n/a | all pass | $0.096 (SDK-reported) | 198 s | yes: `moduleResolution` "bundler" over "nodenext", `types` pinned, with reasons |
| support-dotcom-components | Claude Code | yes | n/a | all pass | $0.230 | 143 s | yes: the `rootDir` addition and no changeset, with reasons |
| strut | Uptide | no (no change) | 0/4 | not applicable: unchanged parent | $0.000 | 35 s | no PR body: exit 2 before any change |
| strut | Claude Code | yes | 4/4 by edit | all pass (813 → 814 tests) | $2.877 | 392 s | yes: every v7 rename, the final-step `response`, test changes and the sandbox workaround |
| yea | Uptide | no (CI pr-body check) / yes on code | n/a | all pass | $0.144 (SDK-reported) | 92 s | yes: pinned to endive, with the changelog items listed |
| yea | Claude Code | no (CI pr-body check) / yes on code | n/a | all pass | $0.603 | 147 s | yes: endive compared field by field, and the cut-off-body message change |

Neither arm's cap was exceeded: `overCapUsd` is 0 on every run. The highest is strut's Claude Code run at $2.88 of $5.

### Notes by repository

- **fortylove:**
  - Both arms moved the `.default` site. Uptide used `.prefault("false")` and Claude Code `.default(false)`. Both keep `remove_document` opt-in.
  - Both also moved `uuidSchema` (`lib/input-validation.ts:27`) to `z.guid()`, keeping v3's accepted ids. The ground truth lists that change as informational and doesn't score it. Claude Code also changed the two inline `.uuid()` calls. Neither arm added the human's regression test.
- **ecommerce-store-api:**
  - Uptide stopped its mechanical path on a peer blocker (typeorm 0.3.31's `redis` peer) and continued as `uptide fix redis typeorm --target 6.3.0`. That moved typeorm to 1.1.0, a major with no pack. Its PR body counts 21 type errors from the upgrade and 3 left, in test files it didn't edit ("test edits are limited to expected values").
  - All 20 "unrelated" hunks are typeorm 1.x changes in Postgres repositories. The human kept typeorm and added `overrides.typeorm.redis` (issue 4).
- **support-dotcom-components:**
  - The human turned off 5 root and 2 cdk `no-unsafe-*` lint rules. Both arms fixed the cause instead: `cdk/tsconfig.json` gets `"types": ["jest"]` and `moduleResolution: "bundler"`. That's why coverage is 0/4: the human's hunks are all in eslint configs.
  - Uptide also moved `@guardian/ophan-tracker-js` 2.8.3 → 3.1.0 and widened `src/dotcom`'s peer range. Its reason, "@guardian/libs 33.0.0 pins @guardian/ophan-tracker-js 3.1.0", is wrong: `@guardian/libs@33.0.0` declares `^2.2.10` (issue 5).
  - Uptide's own verification ran the root jest in UTC: "620 tests in 49 files passed" (`agent.json` `.verification.tests`). Outside UTC, 8 of them fail.
- **strut:**
  - Uptide refused before changing anything: "Requested ai@7.0.105, but . resolved 7.0.146; verification cannot use a different target." yarn resolved a newer 7.x than the target, and Uptide stopped (issue 3).
  - Claude Code made every v7 change, with `responseMessages` at all 4 silent sites. It added a test that `returnMessages` keeps every step, and confirmed the test fails on the old final-step behavior.
  - Its 5 "unrelated" hunks are expected model names in tests that follow `aieo` 0.2's new aliases.
- **yea:**
  - Both arms moved `STRIPE_VERSION` to endive and updated the tests' expected version. Neither added the human's cut-off-body test.

## Cost

**Arm B, hand-verified.** Opus 5.5 at $4 input, $20 output, $0.20 cache read and $5 5-minute cache write per million tokens, from https://platform.claude.com/docs/en/about-claude/pricing (read 2026-10-19), row "Claude Opus 5.5".

Run `edfcd070` (fortylove), from `agent.json` `.usage`:

| tokens | count | rate | $ |
|---|---|---|---|
| input | 20 | 4.00 | 0.0000800 |
| output | 4,814 | 20.00 | 0.0962800 |
| cache read | 135,581 | 0.20 | 0.0271162 |
| cache write (5m) | 21,577 | 5.00 | 0.1078850 |
| **total** | | | **0.2313612** |

- That equals run.sh's `costUsd` (0.2313612) and Claude Code's own `total_cost_usd` (0.2313612).
- All 5 Arm B runs match Claude Code's own figure to the cent: $0.231, $0.626, $0.230, $2.877, $0.603. Total **$4.5672386**.

**Arm A, SDK-reported, reconciliation pending.**
- Total **$0.791487** by run: 0.0374048, 0.5142862, 0.0957694, 0.0000000, 0.1440119 (run `meta.json` `costUsd`).
- Not hand-verifiable from Uptide's output. Run `4982601e` reports `inputTokens 38140`, `outputTokens 833`, `costUsd 0.0374048`. At Sonnet 5.5 list prices, 38,140 uncached input tokens alone would be $0.0763. The figure implies a cache split that the JSON doesn't show.

**Reconciliation, pending the Console number:**
- **Window:** 2026-10-20 05:04:00Z to 05:39:00Z.
  - The first spend was Uptide's run `4982601e`, starting at 05:04:39Z.
  - The last run, Claude Code on yea, ended at 05:38:27Z.
- **Arm A cost error** = Console total for the bench key in the window − $4.5672386 (Arm B) − $0.791487 (Arm A, SDK-reported).

Every request made with the bench key outside the 10 arm runs:

| when (UTC) | what | billed |
|---|---|---|
| 2026-10-20 04:16:36 | `GET /v1/models` with the first, 10-character key in `~/.config/uptide-bench/env`: HTTP 401 | no: rejected, not the bench key |
| 2026-10-20 04:25:10 | `GET /v1/models` with the bench key: HTTP 200 | no: a models list uses no tokens |
| 04:29:51 and the 5 human-arm runs (05:04–05:34) | `run.sh human` loads the key file but runs no model | no requests |
| selection and verification, 04:30–05:04 | local installs, type-checks and tests; the key was not in their environment | no requests |
| the arms' and checks' test suites | strut's and yea's LLM tests point at local fake servers (`ANTHROPIC_BASE_URL=http://127.0.0.1:…`) with fake keys; yea's live Stripe smoke test needs `STRIPE_TEST_KEY` and was skipped | no requests |
| this Claude Code session | its own authentication, not the bench key | no |

So the window holds only the 10 arm runs. The 04:25Z check is outside it, and costs nothing either way.

## Isolation

Each arm's repository, before the arm started (`runs/<run>/isolation.txt`): one commit, the parent, and no remote. The human commit was fetched in only after the arm ended, for scoring.

```text
--- 4982601e zod-fortylove uptide
$ git log --all --oneline | head
fe27ace Add MIT license and expand security policy (#48)
$ git remote -v
$ date (TZ=UTC)
Tue Oct 20 05:04:39 UTC 2026
--- edfcd070 zod-fortylove claude
$ git log --all --oneline | head
fe27ace Add MIT license and expand security policy (#48)
$ git remote -v
$ date (TZ=UTC)
Tue Oct 20 05:06:25 UTC 2026
--- 270da38a redis-ecommerce-store-api uptide
$ git log --all --oneline | head
c9cd358 Sync develop into master (#340)
$ git remote -v
$ date (TZ=UTC)
Tue Oct 20 05:08:17 UTC 2026
--- f38f08f1 redis-ecommerce-store-api claude
$ git log --all --oneline | head
c9cd358 Sync develop into master (#340)
$ git remote -v
$ date (TZ=UTC)
Tue Oct 20 05:17:15 UTC 2026
--- 43f9733b typescript-support-dotcom-components uptide
$ git log --all --oneline | head
4a256bf Version Packages (#1871)
$ git remote -v
$ date (TZ=UTC)
Tue Oct 20 05:21:04 UTC 2026
--- a01d5711 typescript-support-dotcom-components claude
$ git log --all --oneline | head
4a256bf Version Packages (#1871)
$ git remote -v
$ date (TZ=UTC)
Tue Oct 20 05:24:28 UTC 2026
--- 8f8615ab ai-strut uptide
$ git log --all --oneline | head
41fb967 Merge pull request #9 from stakwork/claims-step-1
$ git remote -v
$ date (TZ=UTC)
Tue Oct 20 05:27:00 UTC 2026
--- dc9cb6b0 ai-strut claude
$ git log --all --oneline | head
41fb967 Merge pull request #9 from stakwork/claims-step-1
$ git remote -v
$ date (TZ=UTC)
Tue Oct 20 05:27:40 UTC 2026
--- 2fa0b0db stripe-yea uptide
$ git log --all --oneline | head
e1e4b7b refactor: the job call session, one deep module from plans to outcome (#280) (#293)
$ git remote -v
$ date (TZ=UTC)
Tue Oct 20 05:34:18 UTC 2026
--- 697bdb2e stripe-yea claude
$ git log --all --oneline | head
e1e4b7b refactor: the job call session, one deep module from plans to outcome (#280) (#293)
$ git remote -v
$ date (TZ=UTC)
Tue Oct 20 05:35:56 UTC 2026
```

## TZ=UTC

- **Evidence:**
  - Every run's `meta.json` records `"tz": "UTC"`.
  - `isolation.txt` prints `date` as UTC.
  - support-dotcom-components' root jest passes 620/620 in Uptide's own baseline and after verification (`agent.json`) and in `check.sh` for all 3 runs. In America/Los_Angeles, 8 of the 620 fail.
- **check.sh:** it ran in UTC too, from `987d34d` on. That's a harness commit made after every arm finished and before any check, the same for every run.

## Disclosures

No scoring or ground-truth change follows from these. The same disclosures are in `../repos.md`.

- **AI co-author trailers:**
  - strut (#11, by Evanfeenstra) and yea (#268, by solomonjames) are counted as human. Each commit's author is a human, and the commits carry a `Co-Authored-By: Claude` / `Claude Opus 5.5` trailer.
  - Three candidates whose commits were authored by an agent (`claude` twice, `mistral-vibe` once) were dropped.
- **fortylove, Zod 4's stricter `.uuid()` and `.email()`:** informational, not scored. The reasons:
  - `.uuid()` checks ids the app's own pages send back. Every table makes them with `gen_random_uuid()`, and user ids come from Supabase auth. Both are RFC 4122 v4 UUIDs, which Zod 4 accepts. Only non-versioned ids, such as `00000000-0000-0000-0000-000000000001`, change behavior.
  - `.email()` checks an admin's notification and escalation address. A stored address that v3 accepted and v4 rejects would make `lib/server/ops-notifications.ts:7` throw on read. Whether one exists depends on production data.
  - The human kept both.
- **ecommerce-store-api's Node:** it declares `engines.node >=24.0.0`, and CI uses 24. Every run used Node 22.20.0. The parent passes all 1,724 tests on 22.
- **support-dotcom-components' bar:** the CI set: root lint, prettier, tsc, test and build, and `cdk` lint, prettier and synth.
  - `cdk`'s `tsc` build and jest snapshot are excluded: both fail at the parent and on the human commit.
  - The bump-only `cdk` lint finding, listed anyway: 5 errors in `cdk/lib/dotcom-components.test.ts`. 4 are `no-unsafe-call` (5:1, 6:2, 15:3 ×2) and 1 is `no-unsafe-member-access` (15:29), because the jest globals' types don't resolve.
- **Claude Code's version wasn't pinned** with `DISABLE_AUTOUPDATER=1`, which the lost attempt's `run.sh` had. Every Arm B `meta.json` reports 2.1.283, so the version didn't move during the bench.
- **The Claude Code arm's sandbox allows `github.com`**, as `../arms.md` sets it. No run's `agent.json`, `agent.log` or summary names a fetch of the upstream repository. The only upstream URL is ecommerce's own `package.json` `repository` field, quoted back by Uptide.

## Candidate Linear issues (not filed, not fixed)

1. **`uptide fix --json` cost isn't auditable.**
   - In 0.18.1's SDK executor, `inputTokens` is `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`, and `costUsd` is the Agent SDK's `result.total_cost_usd`, not `pricing.ts`. `persistSession: false` leaves no transcript.
   - Evidence: run `4982601e`, `runs/4982601e/meta.json`.
   - Ask: per-kind token counts priced with `pricing.ts`, and the SDK's figure as a second field.
2. **`pricing.ts` prices Sonnet 5.5 cache reads at $0.20/MTok.**
   - `packages/core/src/llm/pricing.ts:27` on main `5ffd256` has `cached: 0.2`.
   - https://platform.claude.com/docs/en/about-claude/pricing, "Model pricing", row `Claude Sonnet 5.5 | $2 / MTok | $2.50 / MTok | $4 / MTok | $0.10 / MTok² | $10 / MTok`. Footnote 2: "Cache hits and refreshes on Claude Opus 5.5 and Claude Sonnet 5.5 are priced at 0.05x the base input price."
   - Read 2026-10-19.
3. **A caret range resolving above `--target` stops the whole run.**
   - strut, run `8f8615ab`: "Requested ai@7.0.105, but . resolved 7.0.146; verification cannot use a different target." Exit 2, no change.
   - yarn 1 resolved a newer 7.x for the range Uptide wrote. Uptide should write an exact pin, or resolve the target exactly, before verifying.
4. **A peer blocker became an unpacked companion major.**
   - ecommerce, run `270da38a`: typeorm 0.3.31's `redis` peer led Uptide to move typeorm to 1.1.0, which no pack covers. That gave 21 type errors, 3 left, and failing type-check and lint.
   - The human's fix was `overrides.typeorm.redis` in `package.json`. An override should be offered before a companion major.
5. **Wrong reason for a companion upgrade.**
   - support-dotcom-components, run `43f9733b`: Uptide moved `@guardian/ophan-tracker-js` 2.8.3 → 3.1.0, citing "@guardian/libs 33.0.0 pins @guardian/ophan-tracker-js 3.1.0".
   - `npm view @guardian/libs@33.0.0 peerDependencies` gives `"@guardian/ophan-tracker-js": "^2.2.10"`, which 2.8.3 satisfies.

Fork CI pull requests are in the `uptide-bench` organization, one per run (`runs/<run>/pr.json`). Nothing was opened, pushed or commented on any original repository.
