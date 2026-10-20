import { expect, it } from 'vitest';
import { sdkSpend } from './sdk-agent.js';

type Result = Parameters<typeof sdkSpend>[0];
const usage = (m: Record<string, number>) => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  webSearchRequests: 0,
  costUSD: 0,
  contextWindow: 1_000_000,
  maxOutputTokens: 64_000,
  ...m,
});
const result = (
  modelUsage: Record<string, ReturnType<typeof usage>>,
  total_cost_usd: number,
  hour = 0,
) =>
  ({
    total_cost_usd,
    usage: { cache_creation: { ephemeral_1h_input_tokens: hour, ephemeral_5m_input_tokens: 0 } },
    modelUsage,
  }) as unknown as Result;

it('prices a recorded SDK result per model and token class, as computed by hand', () => {
  // modelUsage and total_cost_usd of the zod 3 -> 4.6.7 run on consetto/calmcp (bdaef39^),
  // 2026-10-20 16:58:27Z-16:59:53Z, Sonnet 5.5 at USD per MTok (pricing.ts):
  //   input            24 x $2.00  =     48.0
  //   cache read  256,402 x $0.10  = 25,640.2
  //   cache write  28,281 x $2.50  = 70,702.5   (5-minute; usage reported no 1-hour writes)
  //   output        6,581 x $10.00 = 65,810.0
  //   total                         162,200.7 / 1e6 = $0.1622007, the SDK's figure exactly.
  const recorded = result(
    {
      'claude-sonnet-5-5': usage({
        inputTokens: 24,
        outputTokens: 6581,
        cacheReadInputTokens: 256_402,
        cacheCreationInputTokens: 28_281,
        costUSD: 0.1622007,
      }),
    },
    0.1622007,
  );
  const spend = sdkSpend(recorded, 'claude-sonnet-5-5');
  expect(spend).toEqual({
    inputTokens: 24,
    outputTokens: 6581,
    costUsd: 0.1622007,
    sdkReportedCostUsd: 0.1622007,
    models: [
      {
        model: 'claude-sonnet-5-5',
        inputTokens: 24,
        outputTokens: 6581,
        cacheReadTokens: 256_402,
        cacheWriteTokens: 28_281,
        cacheWriteHourTokens: 0,
        rates: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, cacheWriteHour: 4 },
        costUsd: 0.1622007,
        sdkReportedCostUsd: 0.1622007,
      },
    ],
  });
  // 1-hour writes reported for the main loop move to the 1-hour rate: 1,000 x ($4 - $2.50).
  const hour = sdkSpend(
    { ...recorded, usage: { cache_creation: { ephemeral_1h_input_tokens: 1000 } } } as never,
    'claude-sonnet-5-5',
  );
  expect(hour.models?.[0]).toMatchObject({ cacheWriteTokens: 27_281, cacheWriteHourTokens: 1000 });
  expect(hour.costUsd).toBe(0.1637007);
});

it('prices an unknown model at the SDK figure, unverified, with no guessed rate', () => {
  const spend = sdkSpend(
    result({ 'claude-future-9': usage({ inputTokens: 1000, costUSD: 0.5 }) }, 0.5),
    'claude-future-9',
  );
  expect(spend.costUsd).toBe(0.5);
  expect(spend.costUnverified).toBe(true);
  expect(spend.models?.[0]).not.toHaveProperty('rates');
  expect(spend.models?.[0]).toMatchObject({ unverified: true, costUsd: 0.5 });
  expect(spend.warnings).toEqual([
    "Cost of claude-future-9: no rate in Uptide's pricing table; using the SDK's $0.5000, unverified.",
  ]);
});

it('warns with both figures when computed and SDK cost differ by more than 5%', () => {
  // 1M output tokens on Sonnet 5.5 at $10/MTok = $10; the SDK says $12.
  const off = sdkSpend(
    result({ 'claude-sonnet-5-5': usage({ outputTokens: 1_000_000, costUSD: 12 }) }, 12),
    'claude-sonnet-5-5',
  );
  expect(off.costUsd).toBe(10);
  expect(off.sdkReportedCostUsd).toBe(12);
  expect(off.warnings).toEqual([
    "Cost check: computed $10.0000 from Uptide's pricing table, the SDK reported $12.0000; --max-cost counts the higher.",
  ]);
  // $10.40 is within 5% of $10: no warning.
  const close = sdkSpend(
    result({ 'claude-sonnet-5-5': usage({ outputTokens: 1_000_000, costUSD: 10.4 }) }, 10.4),
    'claude-sonnet-5-5',
  );
  expect(close.warnings).toBeUndefined();
});

it('falls back to the SDK total, unverified, when it reports no per-model usage', () => {
  const spend = sdkSpend(result({}, 0.02), 'claude-sonnet-5-5');
  expect(spend).toMatchObject({ costUsd: 0.02, sdkReportedCostUsd: 0.02, costUnverified: true });
  expect(spend.warnings?.[0]).toContain('no per-model usage');
});
