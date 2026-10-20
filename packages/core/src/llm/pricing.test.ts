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

it('pins the other providers as they are, so any edit is deliberate', () => {
  expect(PRICES.openai).toMatchInlineSnapshot(`
    {
      "gpt-5-pro": {
        "cached": 15,
        "input": 15,
        "output": 120,
      },
      "gpt-6-astra": {
        "cached": 1,
        "input": 10,
        "long": {
          "cached": 2,
          "input": 20,
          "output": 75,
          "threshold": 272000,
          "write": 25,
        },
        "output": 50,
        "write": 12.5,
      },
      "gpt-6-luna": {
        "cached": 0.01,
        "input": 0.1,
        "long": {
          "cached": 0.02,
          "input": 0.2,
          "output": 0.75,
          "threshold": 272000,
          "write": 0.25,
        },
        "output": 0.5,
        "write": 0.125,
      },
      "gpt-6.1-sol": {
        "cached": 0.1,
        "input": 2,
        "long": {
          "cached": 0.2,
          "input": 4,
          "output": 15,
          "threshold": 272000,
          "write": 5,
        },
        "output": 10,
        "write": 2.5,
      },
    }
  `);
  expect(PRICES.gemini).toMatchInlineSnapshot(`
    {
      "gemini-3.1-pro-preview": {
        "cached": 0.2,
        "input": 2,
        "long": {
          "cached": 0.4,
          "input": 4,
          "output": 18,
          "threshold": 200000,
        },
        "output": 12,
      },
      "gemini-3.7-flash": {
        "after": {
          "cached": 0.15,
          "date": "2027-01-01",
          "input": 1.5,
          "output": 7.5,
        },
        "cached": 0.075,
        "input": 0.75,
        "output": 3.75,
      },
      "gemini-3.8-flash": {
        "after": {
          "cached": 0.15,
          "date": "2027-01-01",
          "input": 1.5,
          "output": 7.5,
        },
        "cached": 0.075,
        "input": 0.75,
        "output": 3.75,
      },
    }
  `);
});
