#!/usr/bin/env bash
# Prepares the Uptide Action's engine (action.yml): the CLI of this very commit, installed
# from its own frozen lockfile with install scripts off. Runs in the Action's directory.
set -euo pipefail

major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$major" -lt 20 ]; then
  echo "::error title=Uptide::Uptide needs Node 20 or newer; this job runs Node $(node --version). Set Node 20 or newer in the workflow (or in .nvmrc)."
  exit 1
fi

# The pnpm this repository pins (packageManager), into a private directory: not on PATH.
pnpm_version=$(node -p 'require("./package.json").packageManager.split("@")[1].split("+")[0]')
tools="${UPTIDE_TOOLS:?}"
npm install --prefix "$tools" --no-save --no-audit --no-fund --ignore-scripts --loglevel=error \
  "pnpm@${pnpm_version}"
"$tools/node_modules/.bin/pnpm" install --frozen-lockfile --ignore-scripts --reporter=append-only

# The engine, built from this commit's source (run from source, its worker threads could not
# load TypeScript). No declarations: nothing here imports types.
export UPTIDE_BUILD_NO_DTS=1
"$tools/node_modules/.bin/pnpm" --filter @uptide/core exec tsup >/dev/null
"$tools/node_modules/.bin/pnpm" --filter uptide exec tsup >/dev/null
node packages/cli/dist/index.js --version
# The default executor, `--agent sdk`, needs the Agent SDK and its binary for this runner.
node scripts/action-sdk.mjs
