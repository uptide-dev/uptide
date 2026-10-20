# UpgradeBench v1 arms

Fixed before any run. Both arms run once per repository in bench/v1/repos.md (`bench/v1/pre5/selection.json`).

## Uptide

```sh
UPTIDE_CACHE_DIR=<empty dir> UPTIDE_MODEL=claude-sonnet-5-5 \
  npx -y uptide@0.17.1 fix <pkg> --target <to> --yes --json --max-cost 1
```

- **Version:** the published CLI `uptide@0.17.1`, as a user runs it, not a checkout's build.
- **Model:** `claude-sonnet-5-5`, Uptide's default, at its default effort.
- **Spend cap:** $1 (`--max-cost 1`, also the default). An estimate above it stops the run before the agent starts.
- **Cache:** empty per run, so the first fix downloads the Agent SDK as a new user's would. `--yes` approves that download.
- **Result:** Uptide's `uptide/<pkg>-*` branch, if it made one. Otherwise the parent.

## Claude Code

```sh
claude -p --bare --add-dir <repo> --model claude-fable-5-1 --effort medium \
  --settings bench/claude-sandbox.json --permission-mode acceptEdits --permission-prompts none \
  --no-session-persistence --output-format json --max-budget-usd 5 "<prompt>"
```

- **Model:** `claude-fable-5-1` at medium effort.
- **Spend cap:** $5 (`--max-budget-usd 5`).
- **Prompt:** round 4's task text plus one sentence:

  > Upgrade `<pkg>` from `<from>` to `<to>`. Make the code compile and work with the new version, keep behavior correct, and make sure type-check, lint and tests pass. Commit and summarize what to review. When done, commit all your changes on the current branch. Do not ask for review.

- **Sandbox:** Bash runs only inside Claude Code's sandbox (`bench/claude-sandbox.json`). Network is limited to the package registries and GitHub, and anything that would prompt is denied. `--bare` keeps out this machine's hooks, plugins, memory and CLAUDE.md, and the repository's own CLAUDE.md loads through `--add-dir`.
- **Result:** the branch head after the session. Uncommitted files don't count.

## Both

- **Clone:** a fresh clone at the parent commit for each arm, with pushes to the original repository disabled and installs run with lifecycle scripts off.
- **Install:** the parent is installed with the repository's own frozen install before the clock starts, untimed for both arms.
- **Checks:** `bench/check.sh` runs on each result from a clean worktree. It does a frozen install, then the repository's own type-check, lint, tests and build, as recorded in `selection.json`.
- **Fork CI:** each repository is forked into the `uptide-bench` organization, with its default branch reset to the parent. Each arm's head is pushed as `bench/<run>` and opened as a pull request inside the fork (`bench/judge.sh`). CI is read with round 4's wait: until the PR has check runs, none is pending, and the count has held for a minute.
- **Cost:** priced with Uptide's table (`packages/core/src/llm/pricing.ts`). The Claude Code arm also records Claude Code's own price.
- **Reruns:** only for infrastructure failures, and every rerun is reported.
- **Scope:** forks only in `uptide-bench`. Nothing is pushed to, commented on or opened against the original repositories.

## Full bench, phase 1 (2026-10-19)

Fixed before any phase-1 run. Everything above holds except these:

- **Uptide:** `uptide@0.18.1` from npm, installed pinned (`npm install --ignore-scripts --save-exact uptide@0.18.1`, integrity `sha512-AQLSmEab…a0Dg==`) and run through `UPTIDE_BIN`. Still `claude-sonnet-5-5`, $1 cap.
- **Claude Code:** 2.1.283 on `claude-opus-5-5` at medium effort, $5 cap (`--max-budget-usd 5`). The cap is Claude Code's own check between turns, so a run can end above it: `meta.json` records `capUsd` and `overCapUsd`, and an overrun is reported, not hidden. Same prompt, word for word.
- **Auth:** both arms use `ANTHROPIC_API_KEY`, never a logged-in Claude Code session. `--bare` keeps Claude Code on the key.
- **Clone:** each arm's repository is `git init` plus a depth-1 fetch of the parent sha, then `reset --hard`: one commit, no remote, no other branch or tag. `isolation.txt` in each run holds `git log --all --oneline | head` and `git remote -v` from before the arm starts. The human's commit is fetched in only after the arm ends, for scoring.
- **TZ:** `run.sh` exports `TZ=UTC`, so both arms, their commands and Uptide's own baseline and after verification inherit it. `meta.json` records `tz`.
- **Pricing:** Opus 5.5 at $4 / $20 / $0.20 / $5 per million tokens (input, output, cache read, 5m write).

## Full bench, phase 2 (2026-10-20)

Fixed before any phase-2 run. Everything in phase 1 holds except these:

- **Uptide:** `uptide@0.18.2` from npm, installed pinned (`npm install --ignore-scripts --save-exact uptide@0.18.2`, integrity `sha512-GJ6HjUzB…cc5Pg==`) and run through `UPTIDE_BIN`. Still `claude-sonnet-5-5`, $1 cap.
- **Uptide's cost:** `meta.json` `costUsd` is 0.18.2's computed `llm.costUsd`: pricing.ts rates per model and token class (UPT-127). `sdkReportedCostUsd` is the Agent SDK's own total, recorded apart. `cost.json` keeps `llm.models`, each model's uncached input, cache read, 5m and 1h write and output tokens with the rates applied, so any run can be redone by hand.
- **Claude Code:** 2.1.283, the same as phase 1, installed pinned (`npm install --ignore-scripts --save-exact @anthropic-ai/claude-code@2.1.283`, integrity `sha512-/8Y1pe7M…si7TwA==`, then its own `install.cjs`), and run through `CLAUDE_BIN` with `CLAUDE_VERSION=2.1.283` checked per run and `DISABLE_AUTOUPDATER=1`. Still `claude-opus-5-5` at medium effort, $5 cap, with the same prompt, word for word.
- **Budget:** $40 for all of phase 2, both arms.

### Phase 2 amendment: API keys and services (2026-10-20, before any secondary run)

- **No key from the shell.** `run.sh`, `check.sh`, `judge.sh` and `keyprobe.sh` start by unsetting `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_BASE_URL` and `GEMINI_API_KEY`. `run.sh` reads the bench key from `$UPTIDE_BENCH_ENV` (`~/.config/uptide-bench/env`) into an unexported variable.
- **Uptide:** the key is set only in the `uptide fix` process's own environment. Uptide 0.18.2 drops every variable matching `TOKEN|SECRET|API_KEY|PASSWORD` from the commands its verification runs: installs, tests, lint, build (`packages/core/src/fix/process.ts:73-84`, `command()`). Its Agent SDK session gets the key explicitly (`sdk-agent.ts:1091`), and has no shell tool.
- **Known gap:** Uptide's parent type-check fallback (`adapters/typescript/parent-typecheck.ts:43`) runs the repository's own `typescript` compiler with Uptide's full environment, key included. It runs the compiler only, no package script and no repository code. Claude Code's arm has no such process.
- **Claude Code:** the key comes from `apiKeyHelper` (`bench/claude-key.sh`), which Claude Code itself calls, so it is never in an environment its tools inherit. The per-run settings are `claude-sandbox.json` plus `apiKeyHelper`, and `sandbox.filesystem.denyRead` on the key file. `--bare` honors `apiKeyHelper` from `--settings`.
- **Postgres** (context-library): `bench/services.sh` recreates one container, `pgvector/pgvector:pg16` (CI's image), with `POSTGRES_DB=cl_test` and `POSTGRES_USER=cl`. It uses trust auth on `127.0.0.1:55432`, fresh before every run and every final check. `PGHOST`, `PGPORT`, `PGUSER` and `PGDATABASE` are exported to both arms. Trust auth is needed because Uptide drops `PGPASSWORD` from its commands; the tests fall back to `test`, which trust ignores. Claude Code's sandbox reaches it with `allowLocalBinding`.
- **Proof:** `bench/keyprobe.sh`, run 2026-10-20, with both keys set in the calling shell (results.md, "Key isolation proof").

### Phase 2 amendment 2: no Claude Code sandbox in the secondary set (2026-10-20, the user's decision)

- **Phase 1 and the dev set ran Arm B sandboxed.** That has been true since the pilot: `bench/claude-sandbox.json`, introduced in `920512f` (2026-10-15).
- **The secondary set's Arm B runs without it.** `secondary/selection.json` has `"claudeSandbox": false`, and `run.sh` drops the `sandbox` block from the per-run settings, `denyRead` included.
- **Kept:** `apiKeyHelper`, so the key still never enters an environment Claude Code's tools inherit, and the `permissions` block (WebFetch/WebSearch denied).
- **Why:** the sandbox blocked local servers (`listen EPERM` on tsx's IPC pipe and on test servers) and the system certificate store. Uptide's verification is not limited by either, so the sandbox biased the comparison against Arm B.
  - Example: on context-library, Claude Code could not run 353 server-backed tests that Uptide's verification ran.
- **The dev set keeps its sandboxed Arm B numbers.** They are not rerun.
- **The 9 Arm B secondary runs made sandboxed are superseded, not incomplete.** Their records are kept (`results.md`, "Superseded sandboxed Arm B runs"), they're out of every table, and Arm B is run 3 times per repository fresh under the new configuration. These reruns don't use the infrastructure-rerun allowance.
- **Arm A is unchanged**, and its runs stand.
