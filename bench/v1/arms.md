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
