#!/usr/bin/env bash
# Dry check of the phase-2 key isolation: one probe per arm, launched with run.sh's own key and
# environment lines, in a local repository whose only test prints whether ANTHROPIC_API_KEY and
# OPENAI_API_KEY are set inside the test process (set/unset, never a value) and whether the
# per-run Postgres is reachable from it, and whether a tsx server can start (bind a local port).
# Uptide's probe is a mechanical zod bump (no agent); Claude Code's is a short "run npm test"
# prompt. KEYPROBE_CLAUDE_SANDBOX=false drops Claude Code's sandbox, as the secondary set does.
#
#   UPTIDE_BENCH_ENV=<key file> UPTIDE_BIN=<uptide> CLAUDE_BIN=<claude> bench/keyprobe.sh <out dir>
set -euo pipefail
unset ANTHROPIC_API_KEY OPENAI_API_KEY ANTHROPIC_BASE_URL GEMINI_API_KEY
here=$(cd "$(dirname "$0")" && pwd)
out=${1:?out dir}
bench_key=$(set -a && . "${UPTIDE_BENCH_ENV:?}" && printf '%s' "${ANTHROPIC_API_KEY:-}")
export TZ=UTC npm_config_ignore_scripts=true DISABLE_AUTOUPDATER=1
probe_selection=$out/selection.json
echo '{"repos":[{"id":"probe","postgres":{"image":"pgvector/pgvector:pg16","port":55432,"user":"cl","database":"cl_test"}}]}' >"$probe_selection"
. "$here/services.sh"

make_repo() { # <dir>
  mkdir -p "$1/src" && cd "$1"
  cat >package.json <<'JSON'
{ "name": "keyprobe", "private": true, "type": "module",
  "scripts": { "test": "node probe.test.mjs", "typecheck": "tsc --noEmit" },
  "dependencies": { "zod": "3.25.76" }, "devDependencies": { "typescript": "5.9.3", "tsx": "4.21.0" } }
JSON
  cat >tsconfig.json <<'JSON'
{ "compilerOptions": { "strict": true, "module": "nodenext", "moduleResolution": "nodenext", "noEmit": true }, "include": ["src"] }
JSON
  echo 'import { z } from "zod"; export const name = z.string().min(1);' >src/index.ts
  cat >probe.test.mjs <<'JS'
import { appendFileSync } from 'node:fs';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
const s = (k) => (process.env[k] ? 'set' : 'unset');
const pg = await new Promise((r) => {
  const c = net.connect(Number(process.env.PGPORT || 5432), process.env.PGHOST || '127.0.0.1');
  c.on('connect', () => { c.destroy(); r('reachable'); });
  c.on('error', (e) => r(`unreachable (${e.code})`));
  setTimeout(() => r('timeout'), 3000);
});
let tsx;
try {
  const script = "import('node:http').then((h) => { const srv = h.createServer().listen(0, '127.0.0.1', () => { console.log('listening ' + srv.address().port); process.exit(0); }); })";
  const out = execFileSync('node_modules/.bin/tsx', ['-e', script], { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
  tsx = /listening \d+/.test(out) ? 'started' : 'no output';
} catch (e) {
  tsx = 'failed (' + (String(e.stderr || e.message).split('\n').find((l) => /EPERM|Error/.test(l)) || 'error') + ')';
}
const line = `probe: ANTHROPIC_API_KEY=${s('ANTHROPIC_API_KEY')} OPENAI_API_KEY=${s('OPENAI_API_KEY')} PGHOST=${process.env.PGHOST ?? '-'} postgres=${pg} tsx-server=${tsx}`;
console.log(line);
if (process.env.PROBE_OUT) appendFileSync(process.env.PROBE_OUT, line + '\n');
JS
  npm install --ignore-scripts --package-lock-only >/dev/null 2>&1 && npm ci --ignore-scripts >/dev/null 2>&1
  printf 'node_modules\n.probe-out\n' >.gitignore
  git init -q -b main && git add -A && git -c user.name=probe -c user.email=probe@invalid commit -qm probe
}

echo "outer shell before the probe: ANTHROPIC_API_KEY and OPENAI_API_KEY were unset at the top of this script"

# Uptide: the key only in uptide's own process environment, as run.sh passes it.
make_repo "$out/uptide" && fresh_postgres "$probe_selection" probe
PROBE_OUT=$out/uptide-probe.txt ANTHROPIC_API_KEY=$bench_key UPTIDE_CACHE_DIR=$out/uptide-cache \
  UPTIDE_MODEL=claude-sonnet-5-5 "${UPTIDE_BIN:?}" fix zod --target 4.6.7 --yes --json --max-cost 1 \
  >"$out/uptide.json" 2>"$out/uptide.log" || echo "uptide exit $?"
echo "--- Uptide arm, inside the repository's test process (Uptide's baseline and after verification):"
cat "$out/uptide-probe.txt" 2>/dev/null || echo "(no probe line written)"

# Claude Code: the key from apiKeyHelper, never in an environment, as run.sh passes it.
make_repo "$out/claude" && fresh_postgres "$probe_selection" probe
jq --arg helper "$here/claude-key.sh" --arg envfile "$UPTIDE_BENCH_ENV" --argjson sandboxed "${KEYPROBE_CLAUDE_SANDBOX:-true}" \
  '.apiKeyHelper = $helper | if $sandboxed then .sandbox.filesystem.denyRead = [$envfile] else del(.sandbox) end' \
  "$here/claude-sandbox.json" >"$out/claude-settings.json"
echo "Claude Code settings: sandbox $(jq 'has("sandbox")' "$out/claude-settings.json"), apiKeyHelper $(jq -r '.apiKeyHelper' "$out/claude-settings.json")"
PROBE_OUT=$out/claude/.probe-out "${CLAUDE_BIN:?}" -p --bare --add-dir "$PWD" --model claude-opus-5-5 --effort low \
  --settings "$out/claude-settings.json" --permission-mode acceptEdits --permission-prompts none \
  --no-session-persistence --output-format json --max-budget-usd 1 \
  "Run npm test in this repository once and reply with its output line exactly. Change no file." \
  >"$out/claude.json" 2>"$out/claude.log" || echo "claude exit $?"
echo "--- Claude Code arm, inside the repository's test process (run by Claude Code's Bash tool):"
cat "$out/claude/.probe-out" 2>/dev/null || echo "(no probe line written)"
echo "--- costs: uptide $(jq -r '.llm.costUsd // 0' "$out/uptide.json" 2>/dev/null), claude $(jq -r '.total_cost_usd // "?"' "$out/claude.json" 2>/dev/null)"
docker rm -f ub-bench-pg >/dev/null 2>&1 || :
