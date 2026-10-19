import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { run } from './cli.js';
import { fakeEngine, memoryIo, pnpmGitRepo } from './test-utils.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('fix selects the nested project before dependency, manager and config preflight (UPT-120)', async () => {
  const root = pnpmGitRepo({
    'package.json': '{"name":"repo-tools","devDependencies":{"commitlint":"1.0.0"}}',
    'frontend/package.json':
      '{"name":"frontend","packageManager":"npm@10.0.0","devDependencies":{"zod":"3.23.8"}}',
    'frontend/package-lock.json': '{"lockfileVersion":3}',
    'frontend/node_modules/zod/package.json': '{"name":"zod","version":"3.23.8"}',
    'frontend/uptide.yml': 'version: 1\nmaxCost: 2\n',
  });
  roots.push(root);
  const engine = fakeEngine();
  const io = memoryIo({ cwd: root });
  expect(await run(['fix', 'zod', '--no-llm'], io, engine), io.stderr()).toBe(0);
  expect(engine.calls[0]).toMatchObject({
    cwd: join(root, 'frontend'),
    only: 'zod',
    maxCostUsd: 2,
  });
  expect(io.stderr()).toContain('frontend');
});
