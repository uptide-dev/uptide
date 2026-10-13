import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** How one CLI invocation ended: its exit code and what it printed on stdout (`--json`). */
export interface EngineRun {
  code: number;
  stdout: string;
}
export type RunEngine = (args: string[], env: NodeJS.ProcessEnv) => Promise<EngineRun>;

/** Variables no engine process inherits: credentials, and the runner's own token endpoints. */
const SECRET = /(?:TOKEN|SECRET|API_KEY|PASSWORD|CREDENTIAL)|^ACTIONS_(?:ID_TOKEN|RUNTIME|CACHE)_/i;

/** Who commits: the name and email git records as author and committer. */
export interface GitAuthor {
  name: string;
  email: string;
}

/** Until the App's bot account is known: the commits are Uptide's, linked to no account. */
export const FALLBACK_AUTHOR: GitAuthor = {
  name: 'uptide[bot]',
  email: 'uptide@users.noreply.github.com',
};

/**
 * The environment the engine runs with: the job's, minus every credential, plus what the
 * caller passes on purpose (`ANTHROPIC_API_KEY` for assisted fixes, nothing else). Commits
 * Uptide makes are authored by `author`: the App's bot account when it is known
 * (`github.ts`, `botAuthor`). The engine's own installs and tests drop credentials again
 * (`fix/process.ts`), so the key reaches the LLM client only.
 */
export function engineEnv(
  env: NodeJS.ProcessEnv,
  extra: Record<string, string> = {},
  author: GitAuthor = FALLBACK_AUTHOR,
): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(Object.entries(env).filter(([key]) => !SECRET.test(key))),
    CI: 'true',
    GIT_AUTHOR_NAME: author.name,
    GIT_COMMITTER_NAME: author.name,
    GIT_AUTHOR_EMAIL: author.email,
    GIT_COMMITTER_EMAIL: author.email,
    // Telemetry is opt-in and off in CI; the Action's own report is what leaves.
    UPTIDE_TELEMETRY: '0',
    ...extra,
  };
}

/**
 * The CLI of the Action's own commit, built in place by `scripts/action-setup.sh`: the code the
 * pinned tag names, never a version fetched from npm. stdout is captured (the `--json`
 * answer); stderr, the progress lines, goes to the job log as it comes.
 */
export function engineFromBuild(actionPath: string): RunEngine {
  return (args, env) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [join(actionPath, 'packages/cli/dist/index.js'), ...args],
        { cwd: actionPath, env, stdio: ['ignore', 'pipe', 'inherit'] },
      );
      const chunks: Buffer[] = [];
      child.stdout.on('data', (c: Buffer) => chunks.push(c));
      child.on('error', reject);
      child.on('close', (code) =>
        resolve({ code: code ?? 2, stdout: Buffer.concat(chunks).toString('utf8') }),
      );
    });
}

/** The JSON the CLI printed, or undefined when it printed none (it failed before answering). */
export function parseJson<T>(run: EngineRun): T | undefined {
  try {
    return JSON.parse(run.stdout) as T;
  } catch {
    return undefined;
  }
}

/**
 * Credentials for one `uptide pr` process, and nothing else: `gh` reads the installation
 * token from a private config directory (0600, removed after), and `git push` gets it as an
 * HTTP header through `GIT_CONFIG_*`, never in argv, a URL or `.git/config`. `uptide pr`
 * runs only git and gh: no install, build or test of the repository.
 */
export function publishEnv(
  env: NodeJS.ProcessEnv,
  token: string,
  serverUrl = env.GITHUB_SERVER_URL ?? 'https://github.com',
  author: GitAuthor = FALLBACK_AUTHOR,
): { env: NodeJS.ProcessEnv; cleanup: () => void } {
  const host = new URL(serverUrl).host;
  const dir = mkdtempSync(join(env.RUNNER_TEMP ?? tmpdir(), 'uptide-gh-'));
  writeFileSync(
    join(dir, 'hosts.yml'),
    `${host}:\n    oauth_token: ${token}\n    user: x-access-token\n    git_protocol: https\n`,
    { mode: 0o600 },
  );
  const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
  return {
    env: engineEnv(
      env,
      {
        GH_CONFIG_DIR: dir,
        GH_PROMPT_DISABLED: '1',
        GH_NO_UPDATE_NOTIFIER: '1',
        ...(host === 'github.com' ? {} : { GH_HOST: host }),
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: `http.${new URL(serverUrl).origin}/.extraheader`,
        GIT_CONFIG_VALUE_0: header,
        GIT_TERMINAL_PROMPT: '0',
      },
      author,
    ),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
