#!/usr/bin/env node
// Runs `uptide check` and `uptide fix --no-llm` on every repository in sample.json and classifies
// each step (classify.mjs). Nothing here talks to an LLM, pushes, or comments anywhere:
//   - provider keys and GitHub tokens are removed from the environment of every child;
//   - dependency installs and the CLI run with lifecycle scripts off;
//   - `fix` is never given --pr, --llm or --with-services.
//
//   node bench/oss-sample/run.mjs [--out DIR] [--only ID[,ID]] [--concurrency 2] [--force] [--keep]
//
// Output (default bench/oss-sample/out/, gitignored): runs/<id>/{result.json,<step>.out,<step>.err}
// and results.json. Summarize with: node bench/oss-sample/summarize.mjs <out>
import { spawn } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify } from './classify.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};

const out = resolve(opt('out', join(here, 'out')));
const only = opt('only', '')?.split(',').filter(Boolean);
const concurrency = Number(opt('concurrency', '2'));
const fixExtra = opt('fix-extra', '').split(' ').filter(Boolean); // e.g. --update-pins
const cli = resolve(opt('cli', join(here, '../../packages/cli/dist/index.js')));
const TIMEOUT = {
  clone: 300,
  install: 900,
  list: 300,
  check: Number(opt('check-timeout', '900')),
  fix: Number(opt('fix-timeout', '1800')),
};

const sample = JSON.parse(readFileSync(join(here, 'sample.json'), 'utf8'));
const repos = sample.repos.filter((r) => !only?.length || only.includes(r.id));

const LLM_OR_PUSH_ENV =
  /^(ANTHROPIC|OPENAI|GEMINI|GOOGLE_GENERATIVE_AI|GOOGLE_API|MISTRAL|OPENROUTER|AZURE_OPENAI|GH_TOKEN|GITHUB_TOKEN|NPM_TOKEN|NODE_AUTH_TOKEN)/;
function cleanEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!LLM_OR_PUSH_ENV.test(k)) env[k] = v;
  return {
    ...env,
    UPTIDE_TELEMETRY: '0',
    CI: '1',
    GIT_TERMINAL_PROMPT: '0',
    npm_config_ignore_scripts: 'true',
    npm_config_engine_strict: 'false',
    YARN_ENABLE_SCRIPTS: '0',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    ...extra,
  };
}

/** Runs a command to completion or to its timeout; output goes to files, a bounded copy to memory. */
function run(cmd, argv, { cwd, env, seconds, log }) {
  return new Promise((done) => {
    const started = Date.now();
    const o = log ? createWriteStream(`${log}.out`) : null;
    const e = log ? createWriteStream(`${log}.err`) : null;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(cmd, argv, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const kill = (sig) => {
      try {
        process.kill(-child.pid, sig);
      } catch {}
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill('SIGTERM');
      setTimeout(() => kill('SIGKILL'), 10_000).unref();
    }, seconds * 1000);
    child.stdout.on('data', (d) => {
      o?.write(d);
      if (stdout.length < 64 * 1024 * 1024) stdout += d;
    });
    child.stderr.on('data', (d) => {
      e?.write(d);
      stderr = (stderr + d).slice(-256 * 1024);
    });
    child.on('error', (err) => {
      stderr += `spawn error: ${err.message}\n`;
    });
    child.on('close', (exit, signal) => {
      clearTimeout(timer);
      o?.end();
      e?.end();
      done({
        exit,
        signal: timedOut ? null : signal,
        timedOut,
        ms: Date.now() - started,
        stdout,
        stderr,
      });
    });
  });
}

const git = (cwd, ...a) => run('git', a, { cwd, env: cleanEnv(), seconds: 120 });

const INSTALL = {
  npm: ['npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']],
  pnpm: ['pnpm', ['install', '--frozen-lockfile', '--ignore-scripts']],
  yarn: ['corepack', ['yarn@1.22.22', 'install', '--frozen-lockfile', '--ignore-scripts']],
  'yarn-berry': ['corepack', ['yarn', 'install', '--immutable', '--mode=skip-build']],
};

// Dependencies with a verified pack (docs/packs.md). A target is `pack` when it is one of these and
// the repo uses it (imports it, or has it as tooling like typescript). Those whose available upgrade
// is inside the pack's range (`tier` verified) rank first, so `fix --no-llm` has rules to run. Anything
// else is a `fallback`: a plain outdated dependency the code imports.
export const PACKS = new Set([
  'ai',
  'lucide-react',
  'next',
  'react',
  'react-router',
  'stripe',
  'vitest',
  'zod',
  '@sentry/nextjs',
  'typescript',
  'express',
  'redis',
]);

export function pickTarget(list) {
  const rows = (list.packages ?? []).filter(
    (p) =>
      (p.classification === 'used' || (PACKS.has(p.name) && p.classification === 'tooling')) &&
      p.change &&
      p.change !== 'none' &&
      p.latest,
  );
  const isPack = (p) => PACKS.has(p.name);
  const rank = (p) => [
    isPack(p) ? (p.tier === 'verified' ? 0 : 1) : 2,
    -(p.majorGap ?? 0),
    -(p.usage?.callSites ?? 0),
    p.name,
  ];
  rows.sort((a, b) => {
    const x = rank(a);
    const y = rank(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
  });
  const p = rows[0];
  return p
    ? {
        name: p.name,
        kind: isPack(p) ? 'pack' : 'fallback',
        tier: p.tier,
        current: p.current,
        latest: p.latest,
        change: p.change,
      }
    : null;
}

const parse = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

async function snapshot(repoDir) {
  const head = (await git(repoDir, 'rev-parse', 'HEAD')).stdout.trim();
  const status = (await git(repoDir, 'status', '--porcelain', '--untracked-files=no')).stdout;
  const branches = (await git(repoDir, 'branch', '--list')).stdout;
  const config = (await git(repoDir, 'config', '--local', '-l')).stdout;
  return { head, status, branches, config };
}

async function runRepo(r) {
  const dir = join(out, 'runs', r.id);
  const resultFile = join(dir, 'result.json');
  if (!flag('force') && existsSync(resultFile)) return JSON.parse(readFileSync(resultFile, 'utf8'));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const repoDir = join(dir, 'repo');
  const tmp = join(dir, 'tmp');
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(tmp, { recursive: true });
  const result = {
    id: r.id,
    repo: r.repo,
    commit: r.commit,
    manager: r.manager,
    monorepo: r.monorepo,
  };
  const finish = (extra) => {
    Object.assign(result, extra);
    writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`);
    if (!flag('keep')) rmSync(repoDir, { recursive: true, force: true });
    rmSync(tmp, { recursive: true, force: true });
    return result;
  };

  // Setup problems belong to the harness or the repository, not to Uptide: reported, not classified.
  const sh = (label, cmd, argv, seconds) =>
    run(cmd, argv, { cwd: repoDir, env: cleanEnv(), seconds, log: join(dir, label) });
  let res = await sh(
    'clone',
    'sh',
    [
      '-c',
      `git init -q && git remote add origin https://github.com/${r.repo}.git && git fetch -q --depth 1 origin ${r.commit} && git checkout -q -b bench-base FETCH_HEAD`,
    ],
    TIMEOUT.clone,
  );
  if (res.exit !== 0) return finish({ setup: { failed: 'clone', detail: res.stderr.slice(-300) } });
  const [icmd, iargs] = INSTALL[r.manager];
  res = await sh('install', icmd, iargs, TIMEOUT.install);
  if (res.exit !== 0) {
    const detail = res.stderr.trim().split('\n').slice(-3).join(' | ').slice(0, 300);
    return finish({ setup: { failed: 'install', detail, ms: res.ms } });
  }
  const installMs = res.ms;

  const runsDir = join(tmp, 'runs');
  mkdirSync(runsDir, { recursive: true });
  const env = cleanEnv({ TMPDIR: tmp, UPTIDE_RUNS_DIR: runsDir });
  const uptide = (argv, seconds, log) =>
    run(process.execPath, [cli, ...argv, '--cwd', repoDir], {
      cwd: repoDir,
      env,
      seconds,
      log: join(dir, log),
    });

  const lres = await uptide(['list', '--json', '--ci', '--no-color'], TIMEOUT.list, 'list');
  const list = parse(lres.stdout);
  if (!list) {
    // `list` is outside this task's two commands, but a repository it cannot read cannot be checked.
    return finish({
      setup: { installMs },
      list: { exit: lres.exit, ms: lres.ms, failed: true },
      check: {
        ...classify({ step: 'check', ...lres }),
        exit: lres.exit,
        note: 'list produced no JSON; check not run',
        stderrTail: lres.stderr.trim().split('\n').slice(-6).join('\n').slice(0, 900),
      },
    });
  }
  const target = pickTarget(list);
  result.list = { exit: lres.exit, ms: lres.ms, packages: list.packages?.length ?? 0 };
  if (!target) return finish({ setup: { installMs }, target: null });

  const before = await snapshot(repoDir);
  const step = async (name, argv, seconds) => {
    const s = await uptide(argv, seconds, name);
    const c = classify({ step: name, ...s, json: parse(s.stdout) });
    const stderrTail = s.stderr.trim().split('\n').slice(-6).join('\n').slice(0, 900);
    return { exit: s.exit, signal: s.signal, timedOut: s.timedOut, ms: s.ms, ...c, stderrTail };
  };
  const check = await step(
    'check',
    ['check', target.name, '--json', '--ci', '--no-color'],
    TIMEOUT.check,
  );
  const fix = await step(
    'fix',
    ['fix', '--only', target.name, '--no-llm', '--json', '--ci', '--no-color', ...fixExtra],
    TIMEOUT.fix,
  );
  const after = await snapshot(repoDir);
  // Uptide's own runs directory (UPTIDE_RUNS_DIR) must be empty once `fix` has exited. Other TMPDIR
  // entries (Node and Jest caches, uptide-no-hooks) are recorded but are not clones.
  const tempEntries = existsSync(runsDir)
    ? readdirSync(runsDir).map((n) => n.replace(/-[\w]{6,}$/, '-*'))
    : [];
  const tempEntriesLeft = tempEntries.length;
  const otherTmp = existsSync(tmp) ? readdirSync(tmp).filter((n) => n !== 'runs') : [];
  return finish({
    setup: { installMs },
    target,
    check,
    fix,
    integrity: {
      checkoutUntouched: JSON.stringify(before) === JSON.stringify(after),
      changed: Object.keys(before)
        .filter((k) => before[k] !== after[k])
        .map(
          (k) => `${k}: ${String(before[k]).slice(0, 200)} -> ${String(after[k]).slice(0, 200)}`,
        ),
      tempEntriesLeft,
      tempEntries,
      otherTmp,
    },
  });
}

mkdirSync(out, { recursive: true });
const queue = [...repos];
const results = [];
await Promise.all(
  Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length) {
      const r = queue.shift();
      process.stderr.write(`[${new Date().toISOString()}] start ${r.id} (${r.manager})\n`);
      const res = await runRepo(r);
      results.push(res);
      const tag = res.setup?.failed
        ? `setup-failed:${res.setup.failed}`
        : res.target === null
          ? 'no-target'
          : `check=${res.check?.kind} fix=${res.fix?.kind}`;
      process.stderr.write(`[${new Date().toISOString()}] done  ${r.id}: ${tag}\n`);
    }
  }),
);
results.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(join(out, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
process.stderr.write(`wrote ${join(out, 'results.json')}\n`);
