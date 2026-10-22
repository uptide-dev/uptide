import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { MigrationPack } from '../packs/types.js';
import { assistWithSdk } from './sdk-agent.js';
import type { FixSite } from './types.js';

// What SDK 0.3.296 does for an invalid key (measured 2026-10-22): one `success` result with
// `is_error` and the API's message, nothing spent, then the iterator throws (UPT-134).
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: () => ({}),
  tool: () => ({}),
  query: async function* () {
    yield {
      type: 'result',
      subtype: 'success',
      is_error: true,
      num_turns: 1,
      result: 'Invalid API key · Fix external API key',
      stop_reason: 'stop_sequence',
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
      modelUsage: {},
    };
    throw new Error('Claude Code returned an error result: Invalid API key · Fix external API key');
  },
}));

it('keeps the API error an SDK session ends with, and the site says so', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'uptide-sdk-runner-')));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
  git('init', '-q');
  writeFileSync(join(root, 'a.ts'), 'old()\n');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'base');
  const site = {
    finding: {
      change: { package: 'x', from: '1.0.0', to: '2.0.0', path: 'old', kind: 'removed' },
      usage: { file: 'a.ts', line: 1, column: 1, snippet: 'old()' },
      reason: 'removed',
    },
    outcome: 'manual',
    reason: 'assisted review required',
    rule: 'old-removed',
  } as unknown as FixSite;
  const llm = await assistWithSdk({
    root,
    workspaces: ['.'],
    sites: [site],
    pack: { name: 'x', rules: [] } as unknown as MigrationPack,
    context: { from: '1.0.0', to: '2.0.0', includeDeprecated: false },
    model: 'claude-sonnet-5-5',
    maxCostUsd: 0.25,
    diagnostics: () => [],
    tests: async () => [],
    lint: async () => [],
    format: async () => [],
    baselineTests: [],
    baselineLint: [],
    affected: ['a.ts'],
  });
  expect(llm.tasks?.[0]).toMatchObject({
    gate: 'error',
    turns: 1,
    costUsd: 0,
    error: 'Invalid API key · Fix external API key',
    noChange: 'the session failed: Invalid API key · Fix external API key',
  });
  expect(llm.unreportedCostUsd).toBe(0);
  expect(site.reason).toBe('SDK agent failed: Invalid API key · Fix external API key');
});
