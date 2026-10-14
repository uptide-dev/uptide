import { type PackTestReport, registeredPacks, unfinishedPack } from '@uptide/core';
import { expect, it } from 'vitest';
import { formatPackTest } from './pack.js';

it('prints behavior notes on their own row, n/a where nothing was predicted, and each miss with its severity', () => {
  const entry = registeredPacks()[0];
  if (!entry) throw new Error('no registered pack');
  const tally = (tp: number, fp: number, fn: number) => ({
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    precision: tp + fp ? tp / (tp + fp) : 1,
    recall: tp + fn ? tp / (tp + fn) : 1,
  });
  const site = (line: number, rule: string, severity: 'breaking' | 'deprecated') => ({
    file: 'src/client.ts',
    line,
    rule,
    severity,
  });
  const report: PackTestReport = {
    ...unfinishedPack(entry, ''),
    problems: [],
    repos: [
      {
        label: 'owner/name',
        from: '5.0.0',
        to: '6.0.0',
        predicted: [site(13, 'client-defaults', 'deprecated')],
        expected: [
          site(9, 'client-defaults', 'deprecated'),
          site(20, 'handshake-auth', 'breaking'),
        ],
        falsePositives: [site(13, 'client-defaults', 'deprecated')],
        falseNegatives: [
          site(9, 'client-defaults', 'deprecated'),
          site(20, 'handshake-auth', 'breaking'),
        ],
        wrongRule: [],
      },
    ],
    overall: tally(0, 1, 2),
    breaking: tally(0, 0, 1),
    behavior: tally(0, 1, 2),
  };
  const out = formatPackTest(report);
  expect(out).toMatch(/behavior notes \(sites\)\s+0%\s+0%\s+0\s+1\s+2/);
  expect(out).toMatch(/breaking \(sites\)\s+n\/a\s+0%\s+0\s+0\s+1/);
  expect(out).toContain('src/client.ts:9  client-defaults (deprecated)');
  expect(out).toContain('src/client.ts:20  handshake-auth (breaking)');
});
