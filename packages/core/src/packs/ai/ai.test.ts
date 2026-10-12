import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { detectIn } from '../contract.js';
import { runFixtures } from '../tooling/fixtures.js';
import { aiPack } from './index.js';

it('ai: every fixture rewrites and detects exactly its marked sites', () => {
  const result = runFixtures(aiPack, fileURLToPath(new URL('.', import.meta.url)));
  expect(result.cases.length).toBeGreaterThan(0);
  expect(result.unknown).toEqual([]);
  expect(result.rewriteFailures).toEqual([]);
  expect(result.falsePositives).toEqual([]);
  expect(result.falseNegatives).toEqual([]);
});

it('ai: an agent call, matched by its method name alone, is never breaking', () => {
  const text = [
    "import { smoothStream } from 'ai';",
    'await researcher.stream({',
    '  ...(logging && { onStepFinish: log }),',
    '  onFinish: save,',
    '} as Options);',
  ].join('\n');
  const sites = detectIn(aiPack, 'consumer.ts', text);
  expect(sites.map((s) => [s.line, s.rule]).sort()).toEqual([
    [3, 'on-step-end'],
    [4, 'on-end'],
  ]);
  for (const site of sites)
    expect(aiPack.rules.find((rule) => rule.id === site.rule)?.severity).toBe('deprecated');
});
