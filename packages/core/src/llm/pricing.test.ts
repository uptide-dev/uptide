import { expect, it } from 'vitest';
import { PRICES } from './pricing.js';

// One row per model, USD per million tokens: [input, output, cache read, 5m write, 1h write].
// Anthropic rows: https://platform.claude.com/docs/en/about-claude/pricing, read 2026-10-20.
const ANTHROPIC: Record<string, [number, number, number, number, number]> = {
  'claude-sonnet-4-6': [3, 15, 0.3, 3.75, 6],
  'claude-sonnet-5-5': [2, 10, 0.1, 2.5, 4],
  'claude-opus-5-5': [4, 20, 0.2, 5, 8],
  'claude-fable-5-1': [10, 50, 0.25, 12.5, 20],
  'claude-haiku-4-5-20251001': [1, 5, 0.1, 1.25, 2],
};

it('pins every Anthropic rate to the published table', () => {
  const actual = Object.fromEntries(
    Object.entries(PRICES.anthropic).map(([model, p]) => [
      model,
      [p.input, p.output, p.cached, p.write, p.writeHour],
    ]),
  );
  expect(actual).toEqual(ANTHROPIC);
});
