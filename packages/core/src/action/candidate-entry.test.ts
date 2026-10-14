import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it.each([
  { args: ['--allow-candidate'], env: {} },
  { args: ['--allow-candidate=true'], env: {} },
  { args: [], env: { UPTIDE_ALLOW_CANDIDATE: 'true' } },
  { args: [], env: { 'INPUT_ALLOW-CANDIDATE': 'true' } },
])('the Action entry refuses candidate opt-in before secrets or IO: %j', ({ args, env }) => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/action.ts', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...env },
    timeout: 10000,
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr + result.stdout).toContain(
    '--allow-candidate is not available in the Uptide Action',
  );
});

it.each(['--allow-candidate', '--allow-candidate=true'])(
  'the Action engine refuses to forward %s',
  async (flag) => {
    const { engineFromBuild } = await import('./engine.js');
    await expect(engineFromBuild('/does-not-exist')(['check', 'zod', flag], {})).rejects.toThrow(
      '--allow-candidate is not available in the Uptide Action',
    );
  },
);
