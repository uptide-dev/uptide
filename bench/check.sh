#!/usr/bin/env bash
# The final type-check, lint and tests of one run, from a clean worktree of its head: a fresh
# install with lifecycle scripts off, then the repository's own commands from selection.json.
#
#   BENCH_OUT=<dir> bench/check.sh <run>
set -euo pipefail
run=$1
here=$(cd "$(dirname "$0")" && pwd)
dir=${BENCH_OUT:?}/runs/$run
id=$(jq -r .id "$dir/meta.json") head=$(jq -r .head "$dir/meta.json")
export npm_config_ignore_scripts=true YARN_ENABLE_SCRIPTS=0 CI=1
rm -rf "$dir/check"
git -C "$dir/repo" worktree prune
git -C "$dir/repo" worktree add -q --detach "$dir/check" "$head"
cd "$dir/check"
result='{}'
for step in install typecheck lint test; do
  cmd=$(jq -r --arg id "$id" --arg s "$step" '.repos[] | select(.id == $id) | .checks[$s] // ""' "$here/selection.json")
  [ -z "$cmd" ] && continue
  code=0
  bash -c "$cmd" >"$dir/check-$step.log" 2>&1 || code=$?
  result=$(jq --arg s "$step" --argjson c "$code" '.[$s] = $c' <<<"$result")
  # Nothing else means anything without dependencies.
  [ "$step" = install ] && [ "$code" != 0 ] && break
done
echo "$result" >"$dir/checks.json"
echo "$run $result"
