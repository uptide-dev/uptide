import { beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from './cli.js';
import { fakeEngine, memoryIo, pnpmGitRepo } from './test-utils.js';

// The SDK as the first fix finds it: cached, or fetched after `confirm` says yes.
const sdk = vi.hoisted(() => ({ cached: false, fails: '', installs: 0, asked: [] as string[] }));
vi.mock('@uptide/core', async (original) => {
  const core = await original<typeof import('@uptide/core')>();
  return {
    ...core,
    sdkUnavailable: async (
      log?: (text: string) => void,
      confirm?: (dir: string) => Promise<boolean>,
    ) => {
      if (sdk.cached) return undefined;
      if (confirm && !(await confirm('/cache/agent-sdk/0.3.296'))) return core.SDK_DECLINED;
      log?.(
        'Agent SDK 0.3.296 is not installed: installing it once into /cache/agent-sdk/0.3.296 … ',
      );
      if (sdk.fails) return sdk.fails;
      sdk.installs++;
      log?.('300 MB, reused by later runs\n');
      return undefined;
    },
  };
});

beforeEach(() => Object.assign(sdk, { cached: false, fails: '', installs: 0, asked: [] }));

// The public CLI: no UPTIDE_INTERNAL.
const KEY = { ANTHROPIC_API_KEY: 'k', UPTIDE_INTERNAL: undefined };
const QUESTION =
  'uptide fix needs the Claude Agent SDK (about 300 MB, downloaded once to /cache/agent-sdk/0.3.296). Download now? [Y/n] ';
const terminal = (answer: string | undefined) => ({
  inTty: true,
  errTty: true,
  ask: async (question: string) => {
    sdk.asked.push(question);
    return answer;
  },
});

describe('fix runs only with the Agent SDK', () => {
  it.each(['', 'y', 'Yes'])('asks once on a terminal; %j downloads it and runs', async (answer) => {
    const engine = fakeEngine();
    const io = memoryIo({ cwd: pnpmGitRepo(), env: KEY, ...terminal(answer) });
    await run(['fix', 'zod'], io, engine);
    expect(sdk.asked).toEqual([QUESTION]);
    expect(sdk.installs).toBe(1);
    expect(engine.calls).toHaveLength(1);
    expect(io.stderr()).toContain('executor sdk');
  });

  it.each(['n', 'no', undefined])(
    'answer %j: exit 2 before any clone, with the reason and the way out',
    async (answer) => {
      const engine = fakeEngine();
      const io = memoryIo({ cwd: pnpmGitRepo(), env: KEY, ...terminal(answer) });
      expect(await run(['fix', 'zod', '--json'], io, engine)).toBe(2);
      expect(engine.calls).toHaveLength(0);
      expect(sdk.installs).toBe(0);
      const message =
        'uptide fix runs only with the Claude Agent SDK and cannot start: the download was declined. To fix it, run again and answer Y, or pass --yes';
      expect(io.stderr()).toContain(message);
      expect(JSON.parse(io.stdout())).toEqual({ error: { code: 'SDK_UNAVAILABLE', message } });
    },
  );

  it.each([
    { name: 'without a terminal', flags: [], tty: {} },
    { name: 'with --yes', flags: ['--yes'], tty: terminal('n') },
  ])('$name: downloads without asking and says so in one line', async ({ flags, tty }) => {
    const engine = fakeEngine();
    const io = memoryIo({ cwd: pnpmGitRepo(), env: KEY, ...tty });
    await run(['fix', 'zod', ...flags], io, engine);
    expect(sdk.asked).toEqual([]);
    expect(sdk.installs).toBe(1);
    expect(io.stderr()).toContain(
      'Agent SDK 0.3.296 is not installed: installing it once into /cache/agent-sdk/0.3.296 … 300 MB, reused by later runs\n',
    );
    expect(engine.calls).toHaveLength(1);
  });

  it('already cached: never asks, never downloads', async () => {
    sdk.cached = true;
    const engine = fakeEngine();
    const io = memoryIo({ cwd: pnpmGitRepo(), env: KEY, ...terminal('n') });
    await run(['fix', 'zod'], io, engine);
    expect(sdk.asked).toEqual([]);
    expect(io.stderr()).not.toContain('installing it once');
    expect(engine.calls).toHaveLength(1);
  });

  it('a failed fetch stops with exit 2: no clone, no patch executor', async () => {
    sdk.fails =
      'installing @anthropic-ai/claude-agent-sdk@0.3.296 into /cache/agent-sdk/0.3.296 failed (npm error code ENOTFOUND)';
    const engine = fakeEngine();
    const io = memoryIo({ cwd: pnpmGitRepo(), env: KEY });
    expect(await run(['fix', 'zod', '--json'], io, engine)).toBe(2);
    expect(engine.calls).toHaveLength(0);
    const { error } = JSON.parse(io.stdout());
    expect(error.code).toBe('SDK_UNAVAILABLE');
    expect(error.message).toBe(
      `uptide fix runs only with the Claude Agent SDK and cannot start: ${sdk.fails}. To fix it, let Uptide reach the npm registry once to install it into its cache (npm's proxy and registry settings apply), or install @anthropic-ai/claude-agent-sdk@0.3.296 next to Uptide`,
    );
    expect(io.stderr()).not.toContain('patch');
  });

  it.each([
    { env: { UPTIDE_INTERNAL: undefined }, why: 'ANTHROPIC_API_KEY is not set' },
    {
      env: { OPENAI_API_KEY: 'k', UPTIDE_INTERNAL: undefined },
      why: 'the LLM provider is openai, and the SDK runs on Anthropic models only',
    },
    {
      env: KEY,
      files: { 'uptide.yml': 'version: 1\nllm:\n  enabled: false\n' },
      why: 'uptide.yml sets llm.enabled: false',
    },
    {
      env: KEY,
      files: { 'uptide.yml': 'version: 1\nexecutor: patch\n' },
      why: 'uptide.yml sets executor: patch',
    },
  ])('stops with exit 2 before the SDK or a clone: $why', async ({ env, files, why }) => {
    const engine = fakeEngine();
    const io = memoryIo({ cwd: pnpmGitRepo(files), env, ...terminal('') });
    expect(await run(['fix', 'zod'], io, engine)).toBe(2);
    expect(io.stderr()).toContain(
      `uptide fix runs only with the Claude Agent SDK and cannot start: ${why}.`,
    );
    expect(sdk.asked).toEqual([]);
    expect(engine.calls).toHaveLength(0);
  });

  it.each([['--no-llm'], ['--agent', 'patch']])(
    '%s is rejected without UPTIDE_INTERNAL=1, accepted with it',
    async (...flags) => {
      const engine = fakeEngine();
      const io = memoryIo({ cwd: pnpmGitRepo(), env: KEY });
      expect(await run(['fix', 'zod', ...flags], io, engine)).toBe(2);
      expect(io.stderr()).toContain(
        `${flags.join(' ')} is not available: uptide fix runs only with the Claude Agent SDK`,
      );
      expect(engine.calls).toHaveLength(0);

      const internal = memoryIo({ cwd: pnpmGitRepo(), env: { ...KEY, UPTIDE_INTERNAL: '1' } });
      await run(['fix', 'zod', ...flags], internal, engine);
      expect(engine.calls).toHaveLength(1);
    },
  );
});
