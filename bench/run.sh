#!/usr/bin/env bash
# One run of one arm on one repository of bench/selection.json (or $BENCH_SELECTION).
#
#   BENCH_OUT=<dir outside this repo> bench/run.sh <claude|uptide|human> <id>
#
# Both arms start from a fresh repository holding the parent commit alone: a depth-1 fetch of
# its sha, no remote, no other branch or tag, so no arm can see the human's upgrade. Installs run
# with lifecycle scripts off. `human` fetches the human's upgrade commit instead: the reference
# every score is measured against. After an arm finishes, the upgrade commit is fetched into
# its repository for score.mjs, still without a remote.
#
# The API keys never come from the calling shell: both are unset first, and the bench key is read
# from the KEY=value file named by $UPTIDE_BENCH_ENV into an unexported variable. Each arm gets it
# only through its own channel (bench/v1/arms.md, phase 2): Uptide in its process environment,
# which its verification filters out of every repository command; Claude Code from apiKeyHelper,
# never in an environment. Every run, the arms and Uptide's own verification run with TZ=UTC.
# The run gets an opaque id; $BENCH_OUT/key.tsv is the only place its arm is written, so
# check.sh, judge.sh and score.mjs never see it.
set -euo pipefail
unset ANTHROPIC_API_KEY OPENAI_API_KEY ANTHROPIC_BASE_URL GEMINI_API_KEY
: "${UPTIDE_BENCH_ENV:?set UPTIDE_BENCH_ENV to the file that sets ANTHROPIC_API_KEY}"
bench_key=$(set -a && . "$UPTIDE_BENCH_ENV" && printf '%s' "${ANTHROPIC_API_KEY:-}")
[ -n "$bench_key" ] || { echo "no ANTHROPIC_API_KEY in $UPTIDE_BENCH_ENV" >&2 && exit 2; }
export TZ=UTC
arm=$1 id=$2
here=$(cd "$(dirname "$0")" && pwd)
out=${BENCH_OUT:?set BENCH_OUT to a directory outside this repository}
sel() { jq -er --arg id "$id" ".repos[] | select(.id == \$id) | $1" "${BENCH_SELECTION:-$here/selection.json}"; }
repo=$(sel .repo) parent=$(sel .parent) upgrade=$(sel .upgrade) pkg=$(sel .package)
from=$(sel .from) to=$(sel .to)
# Uptide's default executor model and effort (packages/core/src/llm/pricing.ts DEFAULT_MODELS,
# capabilities.ts defaultEffort), used by both arms.
# BENCH_MODEL swaps the Claude Code arm's model (bench/v1/arms.md: Opus 5.5); Uptide always
# runs its default.
model=${BENCH_MODEL:-claude-opus-5-5} effort=medium
[ "$arm" = uptide ] && model=claude-sonnet-5-5

run=$(uuidgen | tr '[:upper:]' '[:lower:]' | cut -c1-8)
dir=$out/runs/$run
mkdir -p "$dir"
printf '%s\t%s\t%s\n' "$run" "$id" "$arm" >>"$out/key.tsv"
fetch() { git fetch -q --depth=1 --no-tags "https://github.com/$repo.git" "$1"; }
git init -q -b bench-base "$dir/repo"
cd "$dir/repo"
git config user.name "UpgradeBench" && git config user.email bench@uptide.invalid
if [ "$arm" = human ]; then fetch "$upgrade"; else fetch "$parent"; fi
git reset -q --hard FETCH_HEAD
rm -f .git/FETCH_HEAD
{
  echo "\$ git log --all --oneline | head" && git log --all --oneline | head
  echo "\$ git remote -v" && git remote -v
  echo "\$ date (TZ=$TZ)" && date
} >"$dir/isolation.txt"
export npm_config_ignore_scripts=true YARN_ENABLE_SCRIPTS=0
# A repository that needs Postgres gets a fresh one for this run (bench/services.sh).
. "$here/services.sh" && fresh_postgres "${BENCH_SELECTION:-$here/selection.json}" "$id"
# A developer's checkout is installed; Uptide refuses one that is not. Untimed, both arms.
bash -c "$(sel .checks.install)" >"$dir/setup.log" 2>&1

uptide=${UPTIDE_VERSION:-0.18.2}
# UPTIDE_BIN: a pinned install of uptide@$uptide from npm; else npx fetches that version.
uptide_cli() { if [ -n "${UPTIDE_BIN:-}" ]; then "$UPTIDE_BIN" "$@"; else npx -y "uptide@$uptide" "$@"; fi; }
# CLAUDE_BIN: a pinned install of Claude Code; the auto-updater stays off so it can't move mid-bench.
export DISABLE_AUTOUPDATER=1
claude() { "${CLAUDE_BIN:-claude}" "$@"; }
case $arm in
claude)
  version=$(claude --version | cut -d' ' -f1)
  [ -z "${CLAUDE_VERSION:-}" ] || [ "$version" = "$CLAUDE_VERSION" ] ||
    { echo "claude is $version, not $CLAUDE_VERSION" >&2 && exit 2; }
  ;;
uptide)
  version=$(uptide_cli --version)
  [ "$version" = "$uptide" ] || { echo "uptide is $version, not $uptide" >&2 && exit 2; }
  ;;
*) version= ;;
esac

start=$(date +%s) status=0 cost=0
case $arm in
claude)
  # The prompt in bench/v1/arms.md, word for word.
  prompt="Upgrade $pkg from $from to $to. Make the code compile and work with the new version, keep behavior correct, and make sure type-check, lint and tests pass. Commit and summarize what to review. When done, commit all your changes on the current branch. Do not ask for review."
  # --bare: none of this machine's hooks, plugins, memory or CLAUDE.md; --add-dir loads the
  # repository's own CLAUDE.md as a plain `claude -p` in it would. Bash runs only inside
  # Claude Code's sandbox (claude-sandbox.json); anything that would prompt is denied.
  # claude-sandbox.json plus the key helper. A selection with "claudeSandbox": false (the v1
  # secondary set) drops the sandbox: it blocked local servers (listen EPERM) and the system
  # certificate store, which Uptide's verification is not limited by. Otherwise the sandbox also
  # denies reading the key file.
  sandboxed=$(jq -r '.claudeSandbox // true' "${BENCH_SELECTION:-$here/selection.json}")
  jq --arg helper "$here/claude-key.sh" --arg envfile "$UPTIDE_BENCH_ENV" --argjson sandboxed "$sandboxed" \
    '.apiKeyHelper = $helper | if $sandboxed then .sandbox.filesystem.denyRead = [$envfile] else del(.sandbox) end' \
    "$here/claude-sandbox.json" >"$dir/claude-settings.json"
  UPTIDE_BENCH_ENV=$UPTIDE_BENCH_ENV claude -p --bare --add-dir "$PWD" --model "$model" --effort "$effort" \
    --settings "$dir/claude-settings.json" --permission-mode acceptEdits --permission-prompts none \
    --no-session-persistence --output-format json --max-budget-usd "${CLAUDE_CAP_USD:-5}" \
    "$prompt" >"$dir/agent.json" 2>"$dir/agent.log" || status=$?
  # Claude Code does not know this model's price and reports it at an older Sonnet's; price its
  # tokens with Uptide's table (pricing.ts, per million: input, output, cache read, 5m write),
  # the one Uptide's own cost uses. Opus 5.5 is $4 / $20 / $0.20 / $5, as pricing.ts and
  # https://platform.claude.com/docs/en/about-claude/pricing (read 2026-10-19) both give it.
  cost=$(jq '[.modelUsage // {} | to_entries[]
    | (if (.key | test("haiku")) then [1, 5, 0.1, 1.25]
      elif (.key | test("fable")) then [10, 50, 0.25, 12.5]
      elif (.key | test("opus-5-5")) then [4, 20, 0.2, 5] else [2, 10, 0.2, 2.5] end) as $p
    | (.value.inputTokens * $p[0] + .value.outputTokens * $p[1]
      + .value.cacheReadInputTokens * $p[2] + .value.cacheCreationInputTokens * $p[3]) / 1e6]
    | add // 0' "$dir/agent.json" 2>/dev/null || echo 0)
  jq -r '.result // ""' "$dir/agent.json" >"$dir/summary.md" 2>/dev/null || : >"$dir/summary.md"
  ;;
uptide)
  # The published CLI as a user runs it, not this checkout's build, with an empty cache so
  # the first fix downloads the Agent SDK as a new user's does (--yes approves it).
  mkdir -p "$dir/uptide-cache"
  ANTHROPIC_API_KEY=$bench_key UPTIDE_CACHE_DIR=$dir/uptide-cache UPTIDE_MODEL=$model uptide_cli fix "$pkg" \
    --target "$to" --yes --json --max-cost "${UPTIDE_CAP_USD:-1}" >"$dir/agent.json" 2>"$dir/agent.log" || status=$?
  # Uptide names the branch after the pack's lead package (react-router for react-router-dom).
  branch=$(jq -r '.branch // empty' "$dir/agent.json" 2>/dev/null)
  [ -n "$branch" ] || branch=$(git for-each-ref --format='%(refname:short)' "refs/heads/uptide/*" | head -1)
  [ -n "$branch" ] && git checkout -q "$branch"
  # 0.18.2 (UPT-127): costUsd is computed from pricing.ts per model and token class
  # (.llm.models); the Agent SDK's own total is .llm.sdkReportedCostUsd, kept apart.
  cost=$(jq '.llm.costUsd // 0' "$dir/agent.json" 2>/dev/null || echo 0)
  jq '.llm | {costUsd, sdkReportedCostUsd, costUnverified, inputTokens, outputTokens, models, warnings}' \
    "$dir/agent.json" >"$dir/cost.json" 2>/dev/null || rm -f "$dir/cost.json"
  cp "$(jq -r '.prBody // empty' "$dir/agent.json" 2>/dev/null)" "$dir/summary.md" 2>/dev/null ||
    tail -5 "$dir/agent.log" >"$dir/summary.md"
  ;;
human)
  git checkout -q "$upgrade"
  git log -1 --format=%B >"$dir/summary.md"
  ;;
*) echo "unknown arm $arm" >&2 && exit 2 ;;
esac
wall=$(($(date +%s) - start)) cost=${cost:-0}
dirty=$(git status --porcelain --untracked-files=no -- . ':!.uptide' | wc -l | tr -d ' ')
# For score.mjs only, after the arm is done: the human's commit and its parent, no remote.
[ "$arm" = human ] || git fetch -q --depth=2 --no-tags "https://github.com/$repo.git" "$upgrade"
[ "$arm" = human ] && git fetch -q --depth=1 --no-tags "https://github.com/$repo.git" "$parent"
rm -f .git/FETCH_HEAD
jq -n --arg id "$id" --arg head "$(git rev-parse HEAD)" --argjson status "$status" \
  --argjson cost "$cost" --argjson wall "$wall" --argjson dirty "$dirty" --arg tz "$TZ" \
  --arg cap "$([ "$arm" = claude ] && echo "${CLAUDE_CAP_USD:-5}"; [ "$arm" = uptide ] && echo "${UPTIDE_CAP_USD:-1}")" \
  --arg arm "$arm" --arg version "$version" --arg model "$([ "$arm" = human ] || echo "$model")" \
  --arg executor "$([ "$arm" = uptide ] && jq -r '.llm.executor // .llm.agent // "none"' "$dir/agent.json" 2>/dev/null)" \
  --arg own "$([ "$arm" = claude ] && jq -r '.total_cost_usd // empty' "$dir/agent.json" 2>/dev/null)" \
  --arg claudesandbox "${sandboxed:-}" \
  --arg sdkcost "$([ "$arm" = uptide ] && jq -r '.llm.sdkReportedCostUsd // empty' "$dir/agent.json" 2>/dev/null)" \
  --arg sdk "$([ "$arm" = uptide ] && grep -m1 'Agent SDK' "$dir/agent.log" 2>/dev/null)" \
  '{id: $id, head: $head, exit: $status, costUsd: $cost, wallSeconds: $wall, uncommittedFiles: $dirty, tz: $tz}
    + if $cap == "" then {} else {capUsd: ($cap | tonumber), overCapUsd: ([$cost - ($cap | tonumber), 0] | max)} end
    + if $version == "" then {} else {version: {($arm): $version}} end
    + if $model == "" then {} else {model: $model} end
    + if $own == "" then {} else {claudeCodeCostUsd: ($own | tonumber)} end
    + if $sdkcost == "" then {} else {sdkReportedCostUsd: ($sdkcost | tonumber)} end
    + if $arm == "claude" then {claudeSandbox: ($claudesandbox == "true")} else {} end
    + if $executor == "" then {} else {executor: $executor} end
    + if $sdk == "" then {} else {sdkDownload: $sdk} end' \
  >"$dir/meta.json"
echo "$run $(cat "$dir/meta.json")"
