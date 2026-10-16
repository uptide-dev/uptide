#!/usr/bin/env bash
# Let the repository's own CI judge one run: a fork in the uptide-bench organization whose
# default branch is reset to the parent commit (so `pull_request` branch filters match), the
# run's head pushed as bench/<run>, and a pull request between the two, on the fork only.
# Pushes go to the fork's explicit URL; the original repository is never written to.
#
#   BENCH_OUT=<dir> bench/judge.sh <run>            fork, push, open the pull request
#   BENCH_OUT=<dir> bench/judge.sh <run> --collect  wait for its checks once, store them
set -euo pipefail
run=$1
here=$(cd "$(dirname "$0")" && pwd)
dir=${BENCH_OUT:?}/runs/$run
org=uptide-bench
id=$(jq -r .id "$dir/meta.json") head=$(jq -r .head "$dir/meta.json")
sel() { jq -er --arg id "$id" ".repos[] | select(.id == \$id) | $1" "$here/selection.json"; }
repo=$(sel .repo) parent=$(sel .parent)
fork=$org/${repo%%/*}--${repo##*/}

if [ "${2:-}" = --collect ]; then
  pr=$(jq -r .number "$dir/pr.json")
  [ "$pr" = null ] && exit 0
  gh pr checks "$pr" --repo "$fork" --watch --interval 60 >/dev/null 2>&1 || :
  gh pr checks "$pr" --repo "$fork" --json name,workflow,state,bucket >"$dir/ci.json" || :
  echo "$run $(jq -c 'group_by(.bucket) | map({(.[0].bucket): length}) | add' "$dir/ci.json")"
  exit 0
fi

if [ "$head" = "$parent" ]; then
  echo '{"number": null, "skipped": "no commits"}' >"$dir/pr.json"
  echo "$run no commits, no pull request"
  exit 0
fi
if ! gh repo view "$fork" >/dev/null 2>&1; then
  gh repo fork "$repo" --org "$org" --fork-name "${fork#*/}" --clone=false --default-branch-only
  sleep 5
fi
# Forks start with Actions off.
gh api -X PUT "repos/$fork/actions/permissions" -F enabled=true -f allowed_actions=all >/dev/null
base=$(gh api "repos/$fork" --jq .default_branch)
url=https://github.com/$fork.git
git -C "$dir/repo" push -q --force "$url" "$parent:refs/heads/$base"
git -C "$dir/repo" push -q --force "$url" "$head:refs/heads/bench/$run"
head -c 60000 "$dir/summary.md" >"$dir/pr-body.md"
[ -s "$dir/pr-body.md" ] || echo "(no summary)" >"$dir/pr-body.md"
gh api "repos/$fork/pulls" -f title="bench $run" -f head="bench/$run" -f base="$base" \
  -F body=@"$dir/pr-body.md" --jq '{number, url: .html_url}' >"$dir/pr.json"
echo "$run $(cat "$dir/pr.json")"
