# UpgradeBench v1 pre-run: results (2026-10-19)

5 repositories from `bench/v1/repos.md`, two arms from `bench/v1/arms.md`, once each. The human commit was checked the same way, as the reference.

- **Uptide:** `uptide@0.17.1`, `claude-sonnet-5-5`, $1 cap.
- **Claude Code:** 2.1.283, `claude-fable-5-1`, $5 cap.

Raw results are in `runs/`, one directory per run with `meta.json`, `checks.json`, `ci.json` and `pr.json`. `key.tsv` maps each run to its arm, and `scores.json` holds the scored rows.

## The selection rule was amended before any run

On 2026-10-19 at 10:04Z, before either arm ran, the rule gained a second source: merged Renovate/Dependabot major bumps that a human fixed before merge. Human commit search alone had found too few qualifying upgrades in the window. Two clauses were also stated outright: "tsc clean at parent" and "license OK". The amendment and every drop are in `../repos.md`, committed in 018e1ce and pushed before the first run.

## Reruns

**One, for an infrastructure failure:** LlamaDesk's Uptide arm.
- In run `771d9282`, Uptide made its branch `uptide/react-router-7.18.4`, named after the pack's lead package. The harness looked for `uptide/react-router-dom-*`, so it recorded the parent and opened no PR.
- `run.sh` now takes the branch from Uptide's `--json` `branch` field. The arm was rerun once as `6c81d9f3`.
- The first run spent $0.04 and is kept in `invalid.tsv`, outside the score.

No other run was repeated.

## Summary

"Mergeable" means two things:
- Every local check passes, or fails exactly where the human commit fails (environmental).
- Fork CI passes, or fails only where the human commit's fails.

| repo | pack | human: local / fork CI | Uptide 0.17.1 (Sonnet, $1) | Claude Code (Fable, $5) |
|---|---|---|---|---|
| CubeCobra | express 4→5 | test¹ fails, rest green / all 9 jobs skip on forks | **no PR**: refused before work (npm 10.9.0 pin vs npm 11), $0.00, 57 s | **no PR**: hit $5 after 53 turns, 28 files uncommitted, $5.09, 861 s |
| DAG-chat | vitest 4→5 | green / 15 pass | **no PR**: "vitest is not a dependency" (the app is in `frontend/`), $0.00, 0 s | **mergeable**: green, CI 15 pass, $0.73, 129 s |
| lion-reader | @sentry/nextjs 10→11 | test² and build² fail / 10 pass | **not mergeable**: type-check fails, CI fails Type Check, Unit, E2E; $0.48, 522 s | **no PR**: hit $5 after 79 turns, 8 files uncommitted, $5.06, 711 s |
| cypher-browser | lucide-react 0→1 | build³ fails / 1 pass | **mergeable**: as human, CI pass; exits 1 (not verified)⁴; $0.19, 109 s | **mergeable**: as human, CI pass; $1.33, 201 s |
| LlamaDesk | react-router 6→7 | green / 2 pass | **mergeable**: green, CI 2 pass, $0.05, 48 s (rerun) | **mergeable**: green except a flaky file⁵, CI 2 pass, $0.34, 53 s |
| **mergeable** | | | **2 / 5** | **3 / 5** |
| **cost**, total (median) | | | **$0.72 ($0.05)**, plus $0.04 in the invalid run | **$12.55 ($1.33)** |
| **wall**, total (median) | | | **12.3 min (57 s)** | **32.6 min (201 s)** |

¹ `packages/recommenderService` has no tests, so jest exits 1 with "No tests found" at the parent, on the human commit and on every arm. The parent also fails `lint:check` (prettier, 2 files), which the human commit fixes.
² `DATABASE_URL` unset for `next build`. The unit suites need the native modules (a Rust build that scripts-off skips) and Node ≥26 (machine: 22.20). Fork CI runs both green on the human commit.
³ The build runs `pwsh` (PowerShell) scripts, which aren't on this machine. CI's `windows` job builds it.
⁴ Uptide's verification fails the build both before and after the upgrade (the same `pwsh` failure), and then reports "not verified". See issue 4.
⁵ `src/pages/Settings.test.tsx` failed once in the full run ("spy called 0 times") and passed 6/6 alone, 5 times out of 5. The human commit passed it.

## Per repository

### 1. dekkerglen/CubeCobra: express 4.22.2 → 5.3.0

**Human (#3052, 66 files):** a dependency refresh with the Express 5 migration across `packages/server`: route parameter handling, `asyncHandler`, `types/express.ts` and route tests. It also covers React 19 component typing in `packages/client`, jest config and prettier fixes. Coverage: 85 hunks.

**Uptide (exit 2, no PR):**
- It stopped in 50 s with "Found npm@11.21.0, but this repository requires npm@10.9.0. No files were installed. Next: corepack enable npm …".
- The repository pins `"packageManager": "npm@10.9.0"`. The harness's own `npm ci --ignore-scripts` with npm 11 installs it cleanly, and so does Claude Code's on the same machine.
- No commit, no silent-change findings, coverage 0/85. Engine issue 1.

**Claude Code (exit 1, no PR):**
- It hit `error_max_budget_usd` after 53 turns, with 61k output tokens and 1.6M cache reads.
- Its uncommitted tree had 26 modified files and 2 new ones. The changes mirror the human's Express 5 work: route params through a new `routeParams.ts` with a test, `asyncHandler`, the routers, `types/express.ts`, and 5 route test files.
- It was never committed, so it isn't scored. Coverage 0/85.

**Fork CI:** every workflow job has `if: github.repository == 'dekkerglen/CubeCobra'`, so all 9 skip on the fork, the human commit's too. No CI signal for any arm.

### 2. ZM-BAD/DAG-chat: vitest 4.1.12 → 5.0.5

**Human (3 files):**
- Bumps vitest and `@vitest/coverage-v8`. In the same commit it also upgrades `web-vitals` 5→6, `react-intersection-observer` 10→11 and `@types/node`.
- Changes `__dirname` to `import.meta.dirname` in `frontend/vite.config.ts`, the one source hunk.

**Uptide (exit 2, no PR):**
- It stopped in 44 ms with "vitest is not a dependency of dag-chat".
- The root `package.json` only has commitlint. The app is `frontend/`, a separate npm project with its own lockfile, not a workspace.
- Engine issue 2.

**Claude Code (mergeable):**
- Changed `frontend/package.json` and its lockfile only. Every check is green, and CI passes 15/15.
- **Semantic diff vs human:** it didn't make the `vite.config.ts` change. It reported the `__dirname` warning as "pre-existing … one-line fix if you want it in a separate commit", which is defensible, since everything passes.
- Coverage 0/1 hunks. It didn't touch the other two packages the human moved, which the task didn't ask for.

### 3. brendanlong/lion-reader: @sentry/nextjs 10.75.0 → 11.6.0

Dependabot #1971 with a human fix commit.

**Human (8 files):**
- Adds `src/lib/sentry/data-collection.ts`, an explicit `dataCollection` with `cookies: false`, deny lists for headers and query params, and genAI, queues and graphQL off. It passes this in both `Sentry.init` calls.
- Moves IP stripping from `beforeSendTransaction` to `beforeSendSpan`, because v11 streams spans, and renames the IP span attributes (`client.address`, `network.peer.address`) and the db span attributes (`db.system.name`, `db.query.text`).
- Removes webpack `ignoreWarnings` from `next.config.ts` and rewrites `tests/unit/sentry-span-ip.test.ts`.
- Coverage: 30 hunks.

**Uptide (exit 1, not mergeable):**
- **What it changed:** it edited both `initSentry` calls:
  - `traceLifecycle: "static"`, which opts out of span streaming so `beforeSendTransaction` and the IP stripping keep working.
  - `attachStacktrace: false`.
  - A conservative `dataCollection`.
- **The failure:**
  - It couldn't update the test fixture in `tests/unit/sentry-span-ip.test.ts`, where `SpanJSON` now requires `status`. The gate rejected the agent's edit 3 times as "only explained expected-value changes are allowed; never delete, skip or weaken tests".
  - So the type-check fails locally and in CI.
  - CI's Unit Tests also fails on the repository's own test "resolved data-collection posture is conservative without us configuring it". That test pins the SDK's default, which v11 made permissive. The human rewrote it.
  - Engine issue 3.
- **Semantic risk no check catches:** Uptide's `dataCollection` has `cookies: { deny: ["-ip", "forwarded"] }`. As a deny list, it collects every other cookie, including session cookies, which v10 didn't send. The human set `cookies: false`. It also leaves `urlQueryParams`, `queues` and `graphQL` at v11's defaults.
- **Silent-change findings:** all 7 decisions were relevant:
  - `dataCollection` defaults.
  - Span streaming bypasses `beforeSendTransaction`.
  - `attachStacktrace` defaults to true.
  - Browser session and web-vitals changes.
  - The Vercel environment default.
  - The `tunnelRoute` and proxy interaction.
  - Span op and attribute renames.

  The human acted on the first, second and last of these.
- Coverage 0/30. Its edits are in the same 2 files, but not in the human's hunks.

**Claude Code (exit 1, no PR):**
- It hit the $5 cap after 79 turns, with 4.2M cache reads.
- Its uncommitted tree has the human's shape: a new `data-collection.ts`, changes to `client-sdk.ts`, `server/sentry.ts`, `next.config.ts`, the test, and `tests/setup.ts`.
- It was never committed, so it isn't scored.

### 4. sCypher-me/cypher-browser: lucide-react 0.468.0 → 1.57.0

**Human (#12):**
- Replaces the `Github` and `Youtube` icons lucide 1.0 removed with `CodeXml` and `CirclePlay`, and drops the unused imports in `App.tsx`.
- In the same commit it moves TypeScript to 7 and adds `assets.d.ts`.
- Coverage: 4 hunks.

**Uptide (exit 1, mergeable):**
- Makes the same 2 files' change with `GitBranch` and `Video`, and drops the same unused imports. Coverage 3/4: the missed hunk is `assets.d.ts`, which belongs to TypeScript 7.
- Checks match the human's (build fails on `pwsh`), and CI `windows` passes.
- It exits 1 only because its build verification fails at baseline the same way. Engine issue 4.
- **Silent-change finding:** 1, that icons became `aria-hidden` without an accessible name in 0.489.0. It is correct, and none of the three acted on it.

**Claude Code (exit 0, mergeable):**
- Vendors the removed GitHub and YouTube SVGs into `src/brand-icons.ts` with `createLucideIcon`, so the icons and class names stay exactly as before.
- Same checks as the human's, and CI passes. Coverage 2/4: it missed `assets.d.ts` and the `linkIcons` line, which it left unchanged because the names still resolve.

**Semantic change no check catches:**
- All three show different icons than before, except Claude Code's, which keeps the brand marks.
- Lucide removed them under its brand-logo policy, so vendoring them back is a choice the repository owner should see.
- Uptide's `GitBranch` and `Video` and the human's `CodeXml` and `CirclePlay` are different visual choices. Nothing checks them.

### 5. GlennLab/LlamaDesk: react-router-dom 6.30.6 → 7.18.4

**Human (2 files):** only `package.json` and the lockfile. The same commit also moves echarts 5→6 and vitest 3→5. No source hunks.

**Uptide (rerun, exit 0, verified, mergeable):**
- Bumps `react-router-dom` and adds `react-router` as a direct dependency.
- Every check is green, and CI passes 2/2.
- **Silent-change findings:**
  - The routers in `App.tsx` and the test utils lack `v7_startTransition`, so state updates now run in `startTransition`.
  - `react-router-dom` only re-exports `react-router` in v7.

**Claude Code (exit 0, mergeable):**
- Bumps `react-router-dom` and adds a CHANGELOG entry saying no source changes were needed.
- CI passes 2/2. Local tests had the one flaky failure in `Settings.test.tsx` (note 5).

## Losses and their reasons

**Uptide, 3 of 5 not mergeable:**

| repo | reason | engine bug? |
|---|---|---|
| CubeCobra | refused because the local npm (11.21.0) differs from `packageManager` (npm@10.9.0), though the repository installs with it | yes, issue 1 |
| DAG-chat | doesn't find a dependency declared in a nested, non-workspace project (`frontend/` with its own lockfile) | yes, issue 2 |
| lion-reader | the test gate rejected a type-only fixture update (`status` on `SpanJSON`), leaving the type-check red, and couldn't update the repository's test that pins the SDK's default data collection | yes, issue 3 |
| cypher-browser (not a loss, but exit 1) | reports "not verified" when the build fails identically before and after the upgrade | yes, issue 4 |

**Claude Code, 2 of 5 not mergeable:**

| repo | reason |
|---|---|
| CubeCobra | hit the $5 cap mid-migration (53 turns), with no commit, so its work is lost |
| lion-reader | hit the $5 cap after 79 turns, with no commit; the tree had the human's shape |

Both Claude Code losses are budget: the arm commits only at the end. Uptide had no budget losses. Its largest spend was $0.48 of $1.

## Linear-ready issues (Uptide engine bugs; not fixed here)

### Issue 1: `fix` refuses to run when the local npm differs from `packageManager`, though the repository installs

**What happens:**
- On dekkerglen/CubeCobra at 486571bf (`"packageManager": "npm@10.9.0"`), `uptide fix express --target 5.3.0` with npm 11.21.0 on PATH stops after the clone, with exit 2.
- The message is "Found npm@11.21.0, but this repository requires npm@10.9.0. No files were installed. Next: corepack enable npm && corepack prepare npm@10.9.0 --activate".
- `npm ci --ignore-scripts` with npm 11.21.0 installs the same checkout cleanly, and the lockfile is unchanged.

**Expected:**
- When corepack is available, run the pinned npm through it (`corepack npm@10.9.0 …`) in the temporary clone, the way pnpm is already run through corepack.
- Otherwise, proceed with the local npm when the major versions use the same lockfile format (lockfileVersion 3), and record a note.
- Refuse only when the install would rewrite the lockfile.

**Repro:**

```sh
git clone https://github.com/dekkerglen/CubeCobra && cd CubeCobra && git checkout 486571bf
npm ci --ignore-scripts
npx -y uptide@0.17.1 fix express --target 5.3.0 --yes --json
```

**Source:** UpgradeBench v1 pre-run, run b3405d3c.

### Issue 2: dependencies in a nested non-workspace project are not found

**What happens:**
- On ZM-BAD/DAG-chat at 340e0b09, the app is `frontend/`, with its own `package.json` and `package-lock.json`. The root `package.json` has only commitlint and no `workspaces`.
- `uptide fix vitest --target 5.0.5` at the root exits 2 in 44 ms with "vitest is not a dependency of dag-chat".

**Expected:**
- Find manifests that declare the package in nested projects with their own lockfile, as `list` and `check` already do for workspaces.
- Then either run there, or name the directory: "vitest is declared in frontend/package.json; run from frontend/".
- The second option alone would turn this refusal into a run.

**Repro:**

```sh
git clone https://github.com/ZM-BAD/DAG-chat && cd DAG-chat && git checkout 340e0b09
npm ci --ignore-scripts && npm --prefix frontend ci --ignore-scripts
npx -y uptide@0.17.1 fix vitest --target 5.0.5 --yes --json
```

**Source:** UpgradeBench v1 pre-run, run a0296c34.

### Issue 3: the test-edit gate blocks type-only fixture updates and tests that pin a dependency's defaults

**What happens:**
- On brendanlong/lion-reader at 57c03c32, `uptide fix @sentry/nextjs --target 11.6.0` edits both `Sentry.init` calls.
- The agent then tries to add `status` to the `SpanJSON` fixture in `tests/unit/sentry-span-ip.test.ts`, since v11 makes it required.
- The gate rejects the edit 3 times: "test edit rejected: only explained expected-value changes are allowed; never delete, skip or weaken tests".
- The run commits anyway and exits 1. The branch fails `tsc` (TS2741) and CI's Type Check, E2E build and Unit Tests.
- The unit failure is the repository's own test "resolved data-collection posture is conservative without us configuring it". It asserts the SDK's default `dataCollection`, which v11 changed. Uptide flagged that default change itself as a decision.

**Expected:**
- Allow test edits that only add properties a type now requires to a fixture object. They weaken no assertion, and the compiler error proves the need.
- When a test asserts a dependency's own default that the pack documents as changed, report it as a decision for the owner ("this test pins v10's default `dataCollection`; v11 changed it"), not a rejected edit plus a red branch.
- Don't commit a branch that fails the type-check the baseline passed. Or mark it clearly as failing in the PR body and JSON.

**Source:** UpgradeBench v1 pre-run, run 3caac4a1; fork CI on uptide-bench/brendanlong--lion-reader#2.

### Issue 4: verification reports "not verified" when the build fails the same way before and after

**What happens:**
- On sCypher-me/cypher-browser at 9e770c9e, the build script runs PowerShell (`pwsh`) helper scripts and fails on machines without it.
- `uptide fix lucide-react --target 1.57.0` gets type-check, lint and tests green, with `newErrors: 0`.
- But `verification.build` and `verification.baselineBuild` are both `failed` with the same command. `verification.passed` is false, and the run exits 1.

**Expected:**
- Compare the build to the baseline, as tests already are. A build that fails identically before and after, with the same failure, is "build: failing at baseline, not checked" and doesn't fail verification.
- Keep failing verification for a build that passed at baseline and fails after.

**Source:** UpgradeBench v1 pre-run, run 0e732dab.

## Harness notes

- **Check commands** were fixed in `selection.json` before any run. One was a poor choice: CubeCobra's `recommenderService` has no tests, so the test check reads "No tests found" everywhere. It is reported as is.
- **The finder** (`find-candidates.mjs`) was reformatted by biome after the selection commit, with no logic changed.
- **The `run.sh` branch fix** came after the runs and is the reason for the one rerun.
