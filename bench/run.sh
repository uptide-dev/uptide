#!/usr/bin/env bash
# One run of one arm on one repository of bench/selection.json (or $BENCH_SELECTION).
#
#   BENCH_OUT=<dir outside this repo> bench/run.sh <claude|uptide|human> <id>
#
# Both arms start from the same fresh clone of the parent commit, with installs' lifecycle
# scripts off and pushes to the original repository disabled. `human` checks out the human's
# upgrade commit instead: the reference every score is measured against.
# The run gets an opaque id; $BENCH_OUT/key.tsv is the only place its arm is written, so
# check.sh, judge.sh and score.mjs never see it.
set -euo pipefail
arm=$1 id=$2
here=$(cd "$(dirname "$0")" && pwd)
out=${BENCH_OUT:?set BENCH_OUT to a directory outside this repository}
sel() { jq -er --arg id "$id" ".repos[] | select(.id == \$id) | $1" "${BENCH_SELECTION:-$here/selection.json}"; }
repo=$(sel .repo) parent=$(sel .parent) upgrade=$(sel .upgrade) pkg=$(sel .package)
from=$(sel .from) to=$(sel .to)
# Uptide's default executor model and effort (packages/core/src/llm/pricing.ts DEFAULT_MODELS,
# capabilities.ts defaultEffort), used by both arms.
# BENCH_MODEL swaps the Claude Code arm's model; Uptide always runs its default.
model=${BENCH_MODEL:-claude-sonnet-5-5} effort=medium
[ "$arm" = uptide ] && model=claude-sonnet-5-5

run=$(uuidgen | tr '[:upper:]' '[:lower:]' | cut -c1-8)
dir=$out/runs/$run
mkdir -p "$dir"
printf '%s\t%s\t%s\n' "$run" "$id" "$arm" >>"$out/key.tsv"
git clone -q "https://github.com/$repo.git" "$dir/repo"
cd "$dir/repo"
git checkout -q -b bench-base "$parent"
git remote set-url --push origin no-push
git config user.name "UpgradeBench" && git config user.email bench@uptide.invalid
export npm_config_ignore_scripts=true YARN_ENABLE_SCRIPTS=0
# A developer's checkout is installed; Uptide refuses one that is not. Untimed, both arms.
bash -c "$(sel .checks.install)" >"$dir/setup.log" 2>&1

uptide=${UPTIDE_VERSION:-0.17.1}
case $arm in
claude) version=$(claude --version | cut -d' ' -f1) ;;
uptide) version=$(npx -y "uptide@$uptide" --version) ;;
*) version= ;;
esac

start=$(date +%s) status=0 cost=0
case $arm in
claude)
  prompt="Upgrade $pkg from $from to $to. Make the code compile and work with the new version, keep behavior correct, and make sure type-check, lint and tests pass. Commit and summarize what to review.${CLAUDE_PROMPT_EXTRA:+ $CLAUDE_PROMPT_EXTRA}"
  # --bare: none of this machine's hooks, plugins, memory or CLAUDE.md; --add-dir loads the
  # repository's own CLAUDE.md as a plain `claude -p` in it would. Bash runs only inside
  # Claude Code's sandbox (claude-sandbox.json); anything that would prompt is denied.
  claude -p --bare --add-dir "$PWD" --model "$model" --effort "$effort" \
    --settings "$here/claude-sandbox.json" --permission-mode acceptEdits --permission-prompts none \
    --no-session-persistence --output-format json --max-budget-usd "${CLAUDE_CAP_USD:-6}" \
    "$prompt" >"$dir/agent.json" 2>"$dir/agent.log" || status=$?
  # Claude Code does not know this model's price and reports it at an older Sonnet's; price its
  # tokens with Uptide's table (pricing.ts, per million: input, output, cache read, 5m write),
  # the one Uptide's own cost uses.
  cost=$(jq '[.modelUsage // {} | to_entries[]
    | (if (.key | test("haiku")) then [1, 5, 0.1, 1.25]
      elif (.key | test("fable")) then [10, 50, 0.25, 12.5] else [2, 10, 0.2, 2.5] end) as $p
    | (.value.inputTokens * $p[0] + .value.outputTokens * $p[1]
      + .value.cacheReadInputTokens * $p[2] + .value.cacheCreationInputTokens * $p[3]) / 1e6]
    | add // 0' "$dir/agent.json" 2>/dev/null || echo 0)
  jq -r '.result // ""' "$dir/agent.json" >"$dir/summary.md" 2>/dev/null || : >"$dir/summary.md"
  ;;
uptide)
  # The published CLI as a user runs it, not this checkout's build, with an empty cache so
  # the first fix downloads the Agent SDK as a new user's does (--yes approves it).
  mkdir -p "$dir/uptide-cache"
  UPTIDE_CACHE_DIR=$dir/uptide-cache UPTIDE_MODEL=$model npx -y "uptide@$uptide" fix "$pkg" \
    --target "$to" --yes --json --max-cost "${UPTIDE_CAP_USD:-1}" >"$dir/agent.json" 2>"$dir/agent.log" || status=$?
  branch=$(git for-each-ref --format='%(refname:short)' "refs/heads/uptide/$pkg-*" | head -1)
  [ -n "$branch" ] && git checkout -q "$branch"
  cost=$(jq '.llm.costUsd // 0' "$dir/agent.json" 2>/dev/null || echo 0)
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
jq -n --arg id "$id" --arg head "$(git rev-parse HEAD)" --argjson status "$status" \
  --argjson cost "$cost" --argjson wall "$wall" --argjson dirty "$dirty" \
  --arg arm "$arm" --arg version "$version" --arg model "$([ "$arm" = human ] || echo "$model")" \
  --arg executor "$([ "$arm" = uptide ] && jq -r '.llm.executor // .llm.agent // "none"' "$dir/agent.json" 2>/dev/null)" \
  --arg own "$([ "$arm" = claude ] && jq -r '.total_cost_usd // empty' "$dir/agent.json" 2>/dev/null)" \
  --arg sdk "$([ "$arm" = uptide ] && grep -m1 'Agent SDK' "$dir/agent.log" 2>/dev/null)" \
  '{id: $id, head: $head, exit: $status, costUsd: $cost, wallSeconds: $wall, uncommittedFiles: $dirty}
    + if $version == "" then {} else {version: {($arm): $version}} end
    + if $model == "" then {} else {model: $model} end
    + if $own == "" then {} else {claudeCodeCostUsd: ($own | tonumber)} end
    + if $executor == "" then {} else {executor: $executor} end
    + if $sdk == "" then {} else {sdkDownload: $sdk} end' \
  >"$dir/meta.json"
echo "$run $(cat "$dir/meta.json")"
