/**
 * The Uptide Action (action.yml): one run of list, check or fix in the customer's own job,
 * with the CLI of this commit. Inputs arrive as UPTIDE_* variables from action.yml.
 *
 * Secrets: the Anthropic key is required; without it the run stops before doing anything
 * (`LLM_KEY_MISSING`). It is read once and removed from this process's environment, and
 * passed to `uptide fix` alone. The installation token is masked
 * on arrival and reaches only the `uptide pr` process. Nothing here prints either.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { engineEnv, engineFromBuild, publishEnv } from '../packages/core/src/action/engine.ts';
import { appBotIdentity, openUptideBranches } from '../packages/core/src/action/github.ts';
import { installationTokens, maskWithRunner } from '../packages/core/src/action/oidc.ts';
import { postResults } from '../packages/core/src/action/results.ts';
import { PublishFailure, runAction } from '../packages/core/src/action/run.ts';
import { assertSafeReport } from '../packages/core/src/run-report/safe.ts';
import { renderSummary } from '../packages/core/src/run-report/summary.ts';

// No opt-in channel in the Action, even if an input or invocation is added later.
if (
  process.argv
    .slice(2)
    .some((arg) => arg === '--allow-candidate' || arg.startsWith('--allow-candidate=')) ||
  ['UPTIDE_ALLOW_CANDIDATE', 'INPUT_ALLOW-CANDIDATE', 'INPUT_ALLOW_CANDIDATE'].some(
    (key) => process.env[key] !== undefined,
  )
)
  throw new Error('--allow-candidate is not available in the Uptide Action');

const env = { ...process.env };
const apiKey = env.UPTIDE_ANTHROPIC_API_KEY?.trim() || undefined;
// Read once; from here on no environment, ours or a child's, carries it.
delete env.UPTIDE_ANTHROPIC_API_KEY;
Reflect.deleteProperty(process.env, 'UPTIDE_ANTHROPIC_API_KEY');
const actionPath = env.GITHUB_ACTION_PATH ?? join(import.meta.dirname, '..');
const write = (text: string) => process.stdout.write(text);
const mask = maskWithRunner(write);
const appUrl = env.UPTIDE_APP_URL || 'https://uptide-app.vercel.app';
const workspace = env.GITHUB_WORKSPACE ?? process.cwd();
const engine = engineFromBuild(actionPath);
const tokens = installationTokens({ appUrl, env, fetch, mask });
const engineVersion = JSON.parse(
  readFileSync(join(actionPath, 'packages/cli/package.json'), 'utf8'),
).version as string;

const report = await runAction(
  {
    workspace,
    config: env.UPTIDE_CONFIG ?? 'uptide.yml',
    mode: env.UPTIDE_MODE ?? 'check',
    package: env.UPTIDE_PACKAGE,
    apiKey,
    engineVersion,
    github: {
      repository: env.GITHUB_REPOSITORY ?? '',
      repositoryId: env.GITHUB_REPOSITORY_ID ?? '',
      sha: env.GITHUB_SHA ?? '',
      runId: env.GITHUB_RUN_ID ?? '',
      runAttempt: env.GITHUB_RUN_ATTEMPT ?? '1',
    },
  },
  {
    engine: (args, key, identity) =>
      engine(args, engineEnv(env, key ? { ANTHROPIC_API_KEY: key } : {}, identity)),
    token: () => tokens.get(),
    commitIdentity: (token) =>
      appBotIdentity({
        token,
        fetch,
        ...(tokens.appSlug() ? { appSlug: tokens.appSlug() } : {}),
        ...(env.GITHUB_API_URL ? { apiUrl: env.GITHUB_API_URL } : {}),
      }),
    openUptideBranches: (token) =>
      openUptideBranches({
        repository: env.GITHUB_REPOSITORY ?? '',
        token,
        fetch,
        ...(env.GITHUB_API_URL ? { apiUrl: env.GITHUB_API_URL } : {}),
      }),
    async publish(branch, token, identity) {
      const { env: withToken, cleanup } = publishEnv(env, token, undefined, identity);
      try {
        const run = await engine(
          ['pr', '--branch', branch, '--yes', '--json', '--ci', '--cwd', workspace],
          withToken,
        );
        let answer: { url?: unknown; error?: { reason?: unknown } } = {};
        try {
          answer = JSON.parse(run.stdout);
        } catch {}
        const reason = answer.error?.reason;
        if (typeof reason === 'string') throw new PublishFailure(reason);
        if (run.code !== 0 || typeof answer.url !== 'string')
          throw new Error(`uptide pr exited ${run.code}`);
        return answer.url;
      } finally {
        cleanup();
      }
    },
    now: Date.now,
    log: (line) => write(`${line}\n`),
  },
);

assertSafeReport(report);
const file = join(env.RUNNER_TEMP ?? actionPath, 'uptide-report.json');
writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, renderSummary(report));
if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `report=${file}\n`);

const sent = await postResults(report, { appUrl, env, fetch, mask });
if (!sent.ok) write(`::warning title=Uptide dashboard::${sent.warning}\n`);
if (report.error) {
  write(`::error title=Uptide::${report.error}\n`);
  process.exitCode = 1;
}
