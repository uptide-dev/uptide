import { describe, expect, it, vi } from 'vitest';
import { run } from './cli.js';
import { fakeEngine, memoryIo, pnpmGitRepo } from './test-utils.js';

// A verified pack whose lead (`router`) a repository may declare only through `router-dom`.
vi.mock('@uptide/core', async (original) => {
  const core = await original<typeof import('@uptide/core')>();
  const source = 'https://example.com/router-dom/changelog';
  const router = core.definePack({
    meta: { package: 'router', from: '^1', to: '^2', sources: [], maintainer: 'test' },
    rules: [],
    instructions: '',
    releaseGroup: [{ name: 'router-dom', source }],
    alternateLeads: [{ name: 'router-dom', source }],
  });
  return { ...core, activePacks: () => [...core.activePacks(), router] };
});

/** Declares `router-dom` only, as most React Router 6 applications declare `react-router-dom`. */
const engine = () =>
  fakeEngine({
    installed: async () => new Map([['router-dom', '1.0.0']]),
    declared: async () => new Map([['router-dom', '^1.0.0']]),
  });
const repo = () =>
  pnpmGitRepo({
    'package.json': JSON.stringify({
      name: 'shop',
      packageManager: 'pnpm@10.17.1',
      dependencies: { 'router-dom': '^1.0.0' },
    }),
    'node_modules/router-dom/package.json': '{"name":"router-dom","version":"1.0.0"}',
  });

describe('a pack lead asked for, or declared, through its alternate lead', () => {
  it.each(['router', 'router-dom'])('check %s checks the lead', async (asked) => {
    const e = engine();
    const io = memoryIo({ cwd: repo() });
    expect(await run(['check', asked, '--target', `${asked}@2.0.0`], io, e)).toBe(0);
    expect(io.stderr()).not.toContain('not a dependency');
    expect(e.calls[0]).toMatchObject({ only: ['router'] });
  });

  it('fix router-dom fixes the lead, with a target named after the alternate', async () => {
    const e = engine();
    const io = memoryIo({ cwd: repo() });
    expect(
      await run(['fix', 'router-dom', '--target', 'router-dom@2.0.0', '--no-llm'], io, e),
    ).toBe(0);
    expect(e.calls[0]).toMatchObject({ only: 'router', target: 'router@2.0.0' });
  });

  it('still says what is missing when neither is declared', async () => {
    const e = fakeEngine();
    const io = memoryIo({ cwd: repo() });
    expect(await run(['check', 'router-dom'], io, e)).toBe(2);
    expect(io.stderr()).toContain('router is not a dependency');
  });
});
