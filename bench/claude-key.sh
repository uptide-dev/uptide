#!/usr/bin/env bash
# Claude Code's apiKeyHelper: prints the bench key from the file named by $UPTIDE_BENCH_ENV.
# Claude Code calls it itself, so the key never enters an environment its tools inherit.
set -euo pipefail
( set -a && . "${UPTIDE_BENCH_ENV:?}" && printf '%s' "${ANTHROPIC_API_KEY:?}" )
