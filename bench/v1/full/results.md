# UpgradeBench v1 full bench, phase 1: results (2026-10-20)

5 headline repositories from `../repos.md` (phase 1), two arms, once each, with the human commit checked the same way as the reference. Phase 1 only: no second or third run, no secondary set. **These 5 are the v1 dev set:** Uptide 0.18.2 was fixed by looking at them, so they never give headline numbers.

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

**Dev set.** These 5 repositories are the v1 dev set. Uptide 0.18.2's fixes (UPT-124, UPT-125, UPT-126, UPT-127/128) were made by looking at these runs, so no headline number comes from them. See `../repos.md`.

**Mergeable** means all of the following, from `ground-truth.md`, plus two rules settled on 2026-10-20 after phase 1 and applied to both arms the same way:
- Every check in `selection.json` passes, or fails exactly where the human commit fails.
- Fork CI passes, or fails only where the human commit's fails.
- **PR-template rule:** a check that only validates the pull request description's format against the repository's template is excluded from the bar. One check is affected: yea's `pr-body/description` (`scripts/check-pr-body.mjs`). The fork PR's body is the run's own output, not a description written to the repository's template.
- **Unrelated-changes rule:** a run that makes a change the upgrade doesn't require, in code or dependencies, is "not mergeable without edits". The judgement is by hand, per file, in the "unrelated changes" column below.

| repo | pack | Uptide 0.18.1 (Sonnet 5.5, $1) | Claude Code 2.1.283 (Opus 5.5, $5) |
|---|---|---|---|
| fortylove | zod 3→4 | **mergeable**; all checks ok, CI 2/2 as human; $0.04, 101 s | **mergeable**; all checks ok, CI 2/2 as human; $0.23, 78 s |
| ecommerce-store-api | redis 5→6 | **not mergeable**: type-check and lint fail; CI adds Type Check and Code Quality failures; typeorm 0.3 → 1.1 as a peer blocker (UPT-125); RESP3 **missed**¹; $0.51, 531 s | **mergeable**; all checks ok, CI fails only the human's 6; RESP2 pinned in the options builder (caught); $0.63, 215 s |
| support-dotcom-components | typescript 5→6 | **not mergeable without edits**: all checks ok², but it moved `@guardian/ophan-tracker-js` 2→3 unasked, with a wrong reason (UPT-126); $0.10, 198 s | **mergeable**²; all checks ok, same tsconfig fix; $0.23, 143 s |
| strut | ai 6→7 | **no PR**: refused ("Requested ai@7.0.105, but . resolved 7.0.146", UPT-124); 0/4 silent sites; $0.00, 35 s | **mergeable**³; all checks ok, CI pass; 4/4 silent sites fixed by edit, plus a regression test; $2.88, 392 s |
| yea | stripe 22→23 | **mergeable**; all checks ok; CI fails only `pr-body/description`, excluded by the PR-template rule; $0.14, 92 s | **mergeable**; all checks ok; CI fails only `pr-body/description`, excluded by the PR-template rule; $0.60, 147 s |
| **mergeable** | | **2 / 5** (fortylove, yea) | **5 / 5** |
| **silent sites caught** (5: ecommerce 1, strut 4) | | **0 / 5** (ecommerce missed at the location¹, strut never ran) | **5 / 5**, all by edit |
| **cost, total** | | **$0.791487**, SDK-reported⁴ | **$4.5672386**, hand-verified |
| **cost per mergeable run** | | **$0.396** ($0.791487 / 2) | **$0.913** ($4.5672386 / 5) |
| **wall, total (median)** | | 957 s (101 s) | 975 s (147 s) |

**Summary line (dev set, phase 1):** Uptide 0.18.1 2/5 mergeable, $0.79 total, $0.40 per mergeable run. Claude Code 5/5 mergeable, $4.57 total, $0.91 per mergeable run. Each of Uptide's 3 losses traces to one engine issue, fixed in 0.18.2:
- strut → **UPT-124**: yarn resolved a newer 7.x than the target, and Uptide refused.
- ecommerce-store-api → **UPT-125**: a peer blocker became typeorm's unpacked major.
- support-dotcom-components → **UPT-126**: the companion planner dragged `@guardian/ophan-tracker-js` 2→3.

**Before the corrections** (the first version of this file, `fe03975`): Uptide 2/5 and Claude Code 4/5 by the written bar. support-dotcom-components was then mergeable for Uptide, and yea failed for both arms on `pr-body/description`. Two rules changed that: the unrelated-changes rule takes support-dotcom-components from Uptide, and the PR-template rule gives yea to both arms.

¹ **ecommerce silent site, scored by the brief's criterion:** "pins the protocol or mentions the change *at that code location*". Uptide's run neither pins `RESP` nor mentions RESP3 at `buildNodeRedisClientOptions` (`redis-connection.options.ts:21-40`) or at either of its callers. Its mention is a general PR-body bullet, plus one more attached to the Postgres files it changed. So it is **missed**. Looser than the brief: by the committed rule in `ground-truth.md` and `score.mjs`, any mention in the summary or PR body counts, and by that rule Uptide's run is caught: "redis 6 changes client defaults: RESP3 instead of RESP2 … To keep 5's behavior, set `RESP: 2`". That looser result is the `1/1 (edit 0)` in the score.mjs table below, and it is not used in any count here. Claude Code pinned `RESP: 2` in `buildNodeRedisClientOptions` and added a test.

² **support-dotcom-components' CI on a fork:** the build job is skipped (it doesn't run on forks), and only `CORE4 label enforcement / require-label` runs. It fails for all three runs, the human's included, so fork CI gives no code signal. The local CI set (`selection.json`) is the bar, and every check passes for both arms.

³ **strut, Claude Code's test edits:** judged related, not unrelated. The upgrade needs `aieo` 0.1 → 0.2: 0.1.x pins ai 6, and `aieo@0.2.0` declares the peer `ai ^7.0.105`. The human made the same bump (`^0.2.0`, locked at 0.2.0). Claude Code wrote `^0.2.4`, the newest 0.2.x, and aieo 0.2.4 maps the `sonnet` and `opus` aliases to `claude-sonnet-5-5` and `claude-opus-5-5`. So the 5 expected model names in `src/llm.test.ts` and `src/chat-endpoints.test.ts` changed.
- `aieo@0.2.0` was published at 2026-09-18 04:04Z and the human merged at 04:13Z. 0.2.1–0.2.4 didn't exist yet, and the human's own `^0.2.0` range resolves 0.2.4 on any fresh install. Taking the newest release of the required line is what the human did at their time.
- Claude Code's summary names the runtime effect: "anything using the `sonnet`/`opus` aliases … now runs on the newer `-5-5` models".
- The alternative reading, pinning aieo to 0.2.0 as the human's lock does, would make this run "not mergeable without edits" and Claude Code 4/5. It isn't taken, because the alias change comes from the required companion's current release, not from a package the upgrade doesn't need.

⁴ **Arm A cost is SDK-reported.** It's `costUsd` from `uptide fix --json`, which 0.18.1 takes from the Agent SDK's `total_cost_usd`. The SDK uses the correct Sonnet 5.5 rates: in [uptide-dev/uptide#268](https://github.com/uptide-dev/uptide/pull/268) (UPT-127), a real Sonnet 5.5 run's cost, computed from the published per-class rates, matched the SDK's `total_cost_usd` exactly ($0.1622007). Console reconciliation was not done. See "Cost" below.

## Dev set, Uptide 0.18.2 rerun (phase 2, Arm A only)

**Dev set: not a headline number.** These are the same 5 repositories, used to fix 0.18.2.

**Setup:**
- `uptide@0.18.2` from npm, pinned (`../arms.md`, phase 2), on `claude-sonnet-5-5` with a $1 cap.
- The same parents, the same parent-only isolation and TZ=UTC, 1 run each, from 2026-10-20 20:30:20Z to 20:51:08Z.
- Same `check.sh`, fork CI and `score.mjs`. Fork CI ran as PR #4 (strut #3) in each `uptide-bench` fork.
- The human references are phase 1's runs, copied over.
- **Claude Code is unchanged** (2.1.283, Opus 5.5), so its phase-1 runs stand, and none was rerun.
- `check.sh` still had the API keys in its environment for these 5, as in phase 1. The key-unsetting change came after.

Run outputs are in the session scratchpad, not the repository, as in phase 1.

| repo | run | mergeable | what happened | silent caught | cost (computed / SDK-reported) | wall |
|---|---|---|---|---|---|---|
| fortylove | `c4e7f538` | **yes** | all checks ok, CI 2/2 | n/a | $0.0387483 / $0.0387483 | 113 s |
| ecommerce-store-api | `b872563e` | **no** | UPT-125 holds: typeorm stays at 0.3.31, with `overrides.typeorm.redis` (the human's fix). It changed no code, so the `as AppRedisClient` cast stays, and `lint:check` fails: `redis.service.ts:52:19 no-unnecessary-type-assertion`. That's the bump-only lint failure in the ground truth. Uptide's verification ran type-check, build and tests, not lint. CI adds Code Quality. | RESP3 **missed** at the location: named under "Decisions for you", not pinned. The looser rule counts it as caught. | $0.00 / none (no agent) | 202 s |
| support-dotcom-components | `96eccb38` | **no** | UPT-126 holds: `@guardian/ophan-tracker-js` isn't moved. But the mechanical path stopped on "Build cannot run (.): no build script". The repository builds with `build-server` / `build-dotcom`. The agent's `cdk/tsconfig.json` fix was rejected: "test edit rejected: only explained expected-value changes are allowed". So `cdk` lint fails: 5 `no-unsafe-*` errors in `cdk/lib/dotcom-components.test.ts`, the bump-only finding. Exit 1, an agent-led draft. | n/a | $0.283652 / $0.283652 | 383 s |
| strut | `9676beac` | **no** | UPT-124 holds: it ran, with `aieo` 0.1.41 → 0.2.0 as a companion. After 3 feedback rounds ($0.97 of $1), "mid-stream socket death is resumed, not lost" still fails (812/813, the bump-only failure), locally and in CI. Its only source edit drops an `as any` in `src/createStrut.ts`. | **0/4 by edit**; 4/4 by mention under the committed rule (the looser reading) | $0.9655235 / $0.9655235 | 413 s |
| yea | `32d46893` | **yes** | all checks ok. CI fails `pr-body/description` (out of the bar by the PR-template rule) and `osv-scanner`. osv-scanner reports 3 advisories in `vite` 6.4.3, a dev dependency the upgrade doesn't touch. The human's phase-1 PR, rerun at 21:20Z, now fails it too (it passed on 2026-10-20 05:3x), so it's not a regression. | n/a | $0.135457 / $0.135457 | 106 s |
| **total** | | **2 / 5** | | 0 / 5 sites by edit | **$1.4234 computed**, SDK $1.4234 on the 4 agent runs | 1,217 s |

**Against phase 1:**
- The mergeable count is unchanged at 2/5 (fortylove, yea), under the corrected rules.
- Each 0.18.2 fix removed its own failure:
  - strut now runs.
  - ecommerce no longer takes typeorm's major.
  - support-dotcom-components no longer moves ophan-tracker.
- But each of those three repositories now fails for a different reason (candidate issues 6–8 below).
- **Cost:** computed and SDK-reported agree on every run, within float rounding.
- **Hand check, run `c4e7f538`** (`runs-0.18.2/c4e7f538/cost.json`, Sonnet 5.5 at $2 / $10 / $0.10 / $2.50 per million: input, output, cache read, 5m write). 10 × 2 + 865 × 10 + 37,908 × 0.10 + 10,515 × 2.50 = 38,748.3 → **$0.0387483**, equal to `costUsd` and `sdkReportedCostUsd`.
- Per-run records are in `runs-0.18.2/`.

## Key isolation proof (phase 2, before any secondary run)

`bench/keyprobe.sh`, 2026-10-20 ~21:45Z. The calling shell had `ANTHROPIC_API_KEY=set OPENAI_API_KEY=set`. Each arm ran a local probe repository whose only test prints this, never a value:

```text
--- Uptide arm, inside the repository's test process (Uptide's baseline and after verification):
probe: ANTHROPIC_API_KEY=unset OPENAI_API_KEY=unset PGHOST=127.0.0.1 postgres=reachable
probe: ANTHROPIC_API_KEY=unset OPENAI_API_KEY=unset PGHOST=127.0.0.1 postgres=reachable
--- Claude Code arm, inside the repository's test process (run by Claude Code's Bash tool):
probe: ANTHROPIC_API_KEY=unset OPENAI_API_KEY=unset PGHOST=127.0.0.1 postgres=reachable
--- costs: uptide 0, claude 0.042075
```

- Uptide reported `llm.available: true`, so it had the key itself. Claude Code authenticated through `apiKeyHelper`.
- **Gap:** Uptide's parent type-check fallback runs the repository's TypeScript compiler with the key in its environment (`../arms.md`, phase 2 amendment).

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

| repo | arm | mergeable | silent caught / missed | unrelated changes (by hand: file, reason) | build / lint / test vs baseline | cost | wall | PR body explains decisions |
|---|---|---|---|---|---|---|---|---|
| fortylove | Uptide | yes | n/a (no sites) | none. `uuidSchema` → `z.guid()` and the 2 inline `.uuid()` calls are Zod 4 changes (informational in the ground truth), not unrelated | all as baseline, all pass | $0.037 (SDK-reported) | 101 s | yes: "Decisions for you", `.prefault("false")` over `.default(false)`, with the reason |
| fortylove | Claude Code | yes | n/a | none (same `.uuid()` → `z.guid()` sites) | all pass | $0.231 | 78 s | yes: the uuid → `z.guid()` choice and the `.email()` kept, each with a reason; says build not run |
| ecommerce-store-api | Uptide | no | **0/1, missed** at the location (looser committed rule: 1/1 by mention, footnote ¹) | **yes**: `package.json` and `package-lock.json` typeorm 0.3.31 → 1.1.0, and 4 Postgres repositories (`postgres-role.repository.ts`, `postgres-user.repository.ts`, `postgres.order-repository.ts`, `postgres.payment-repository.ts`) rewritten for typeorm 1.x. The upgrade needs only the `redis` peer resolved, which the human did with `overrides.typeorm.redis` (UPT-125) | **type-check FAIL, lint FAIL** (baseline pass); test, build pass | $0.514 (SDK-reported) | 531 s | yes: an agent-led draft that names the typeorm peer blocker, 3 test files left, and the RESP3 decision for the owner |
| ecommerce-store-api | Claude Code | yes | 1/1 by edit (`RESP: 2` + test) | none. `eslint-suppressions.json` moves two unchanged entries to sorted order as eslint rewrites the file; the only count change is the human's (`redis.service.ts` 3 → 2) | all pass | $0.626 | 215 s | yes: the protocol decision and `quit()` kept, with reasons |
| support-dotcom-components | Uptide | **no, not without edits** | n/a | **yes**: `package.json` `@guardian/ophan-tracker-js` 2.8.3 → 3.1.0 and `src/dotcom/package.json`'s widened peer range. TypeScript 6 doesn't need it, and the stated reason is wrong: `@guardian/libs@33.0.0` declares `^2.2.10` (UPT-126) | all pass | $0.096 (SDK-reported) | 198 s | yes: `moduleResolution` "bundler" over "nodenext", `types` pinned, with reasons; the ophan reason is wrong |
| support-dotcom-components | Claude Code | yes | n/a | none. `tsconfig.types.json` `rootDir: "./src"` keeps the declaration output layout under TS 6's new `rootDir` default | all pass | $0.230 | 143 s | yes: the `rootDir` addition and no changeset, with reasons |
| strut | Uptide | no (no change) | 0/4 | none (no change) | not applicable: unchanged parent | $0.000 | 35 s | no PR body: exit 2 before any change (UPT-124) |
| strut | Claude Code | yes | 4/4 by edit | none. 5 expected model names in `src/llm.test.ts` and `src/chat-endpoints.test.ts` follow the required `aieo` 0.1 → 0.2 bump at its newest release (footnote ³) | all pass (813 → 814 tests) | $2.877 | 392 s | yes: every v7 rename, the final-step `response`, test changes, the alias change and the sandbox workaround |
| yea | Uptide | yes (PR-template rule) | n/a | none | all pass | $0.144 (SDK-reported) | 92 s | yes: pinned to endive, with the changelog items listed |
| yea | Claude Code | yes (PR-template rule) | n/a | none. `connectors/stripe/README.md` and `docs/framework/SPEC-connector-stripe.md` follow the new API version | all pass | $0.603 | 147 s | yes: endive compared field by field, and the cut-off-body message change |

score.mjs's own `unrelated` count (the table above) is mechanical: hunks in files the human left alone that never name the package. The hand-judged column is the one the mergeable bar uses.

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

**Arm A, SDK-reported.**
- Total **$0.791487** by run: 0.0374048, 0.5142862, 0.0957694, 0.0000000, 0.1440119 (run `meta.json` `costUsd`).
- 0.18.1's `costUsd` is the Agent SDK's `total_cost_usd`, with input and cache tokens merged into one `inputTokens`, so it can't be redone by hand from these runs' output.
- The SDK uses the correct Sonnet 5.5 rates. In [uptide-dev/uptide#268](https://github.com/uptide-dev/uptide/pull/268) (UPT-127), a real Sonnet 5.5 run's cost, computed from the published per-class rates, matched the SDK's `total_cost_usd` exactly ($0.1622007).
- **Console reconciliation was not done.** The bench key's Console total for 2026-10-20 05:04–05:39Z was never read. The only other requests made with the bench key were a `GET /v1/models` at 04:25:10Z, which uses no tokens, and one rejected with a 401 at 04:16:36Z. The human-arm runs and this session made no model calls with it.
- **Correction (2026-10-20, phase 2):** phase 1 said the key "was not in [the checks'] environment". It was: this machine's `~/.zshrc` exports `ANTHROPIC_API_KEY` (the bench key) and `OPENAI_API_KEY`, so every check and verification inherited them. No phase-1 check or verification log shows a live request. The only API-shaped errors, in strut's test logs, are the `"nope"` bodies of its local fake server. From phase 2 on, `check.sh` unsets both keys.

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

Filed and fixed since, in Uptide 0.18.2 (2026-10-20 18:08Z): 1 and 2 as UPT-127/128 ([uptide-dev/uptide#268](https://github.com/uptide-dev/uptide/pull/268)), 3 as UPT-124, 4 as UPT-125 and 5 as UPT-126. The text below is as written after phase 1.

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

## Candidate Linear issues from the dev-set 0.18.2 rerun (not filed, not fixed)

6. **A bump with no code edits skips lint, and an unneeded cast fails it.**
   - ecommerce, run `b872563e`: no source file was edited, so the lint of edited files didn't run. `npm run lint:check` fails on `redis.service.ts:52:19` (`no-unnecessary-type-assertion`), an assertion made unnecessary by redis 6's types.
   - Ask: run the repository's lint on files whose types the upgrade changes, or the whole lint script.
7. **"No build script" stops the mechanical path in a repository that builds through other scripts.**
   - support-dotcom-components, run `96eccb38`: "Build cannot run (.): no build script". The repository has `build-server` and `build-dotcom`.
   - The agent's correct `cdk/tsconfig.json` fix (`types`, `moduleResolution`) was then rejected for a test edit, leaving the `cdk` lint failing.
   - Ask: a missing `build` script should mean "build not checked", not a stop. A rejected test edit shouldn't discard the config edit with it.
8. **The ai pack leaves v7's error wrapping and final-step response to the agent, and the agent spent its cap without them.**
   - strut, run `9676beac`: 3 feedback rounds, $0.97 of $1. The failing test is still the bump-only one, and none of the 4 `responseMessages` sites was edited.
