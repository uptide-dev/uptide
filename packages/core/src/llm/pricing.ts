import type { Provider, Usage } from './types.js';

export const PRICE_DATE = '2026-10-04';
export const PRICE_SOURCES = {
  anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
  openai: 'https://developers.openai.com/api/docs/pricing',
  gemini: 'https://ai.google.dev/gemini-api/docs/pricing',
} as const;
export interface Price {
  source?: string;
  checkedAt?: string;
  input: number;
  output: number;
  cached: number;
  write?: number;
  writeHour?: number;
  long?: { threshold: number; input: number; output: number; cached: number; write?: number };
  after?: { date: string; input: number; output: number; cached: number };
}
// USD per million tokens, standard text inference. No built-in paid tools or explicit caching.
export const PRICES: Record<Provider, Record<string, Price>> = {
  // Every Anthropic cell checked 2026-10-20 against https://platform.claude.com/docs/en/about-claude/pricing
  // (model table: base input, 5m write, 1h write, cache hits, output). Sonnet/Opus 5.5 cache hits are
  // 0.05x input, Fable 5.1 0.025x, the rest 0.1x. pricing.test.ts pins each cell.
  anthropic: {
    'claude-sonnet-4-6': { input: 3, output: 15, cached: 0.3, write: 3.75, writeHour: 6 },
    'claude-sonnet-5-5': {
      input: 2,
      output: 10,
      cached: 0.1,
      write: 2.5,
      writeHour: 4,
      source: PRICE_SOURCES.anthropic,
      checkedAt: '2026-10-20',
    },
    'claude-opus-5-5': { input: 4, output: 20, cached: 0.2, write: 5, writeHour: 8 },
    'claude-fable-5-1': { input: 10, output: 50, cached: 0.25, write: 12.5, writeHour: 20 },
    'claude-haiku-4-5-20251001': { input: 1, output: 5, cached: 0.1, write: 1.25, writeHour: 2 },
  },
  openai: {
    'gpt-6.1-sol': {
      input: 2,
      output: 10,
      cached: 0.1,
      write: 2.5,
      long: { threshold: 272000, input: 4, output: 15, cached: 0.2, write: 5 },
    },
    'gpt-6-astra': {
      input: 10,
      output: 50,
      cached: 1,
      write: 12.5,
      long: { threshold: 272000, input: 20, output: 75, cached: 2, write: 25 },
    },
    'gpt-6-luna': {
      input: 0.1,
      output: 0.5,
      cached: 0.01,
      write: 0.125,
      long: { threshold: 272000, input: 0.2, output: 0.75, cached: 0.02, write: 0.25 },
    },
    // Legacy high-cost model: https://developers.openai.com/api/docs/models/gpt-5-pro
    'gpt-5-pro': { input: 15, output: 120, cached: 15 },
  },
  gemini: {
    'gemini-3.1-pro-preview': {
      input: 2,
      output: 12,
      cached: 0.2,
      long: { threshold: 200000, input: 4, output: 18, cached: 0.4 },
    },
    'gemini-3.8-flash': {
      input: 0.75,
      output: 3.75,
      cached: 0.075,
      after: { date: '2027-01-01', input: 1.5, output: 7.5, cached: 0.15 },
    },
    'gemini-3.7-flash': {
      input: 0.75,
      output: 3.75,
      cached: 0.075,
      after: { date: '2027-01-01', input: 1.5, output: 7.5, cached: 0.15 },
    },
  },
};
export const DEFAULT_MODELS: Record<Provider, string> = {
  // Storefront comparison: docs/provider-evaluation.md (Sonnet 5.5, medium effort).
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-6.1-sol',
  gemini: 'gemini-3.8-flash',
};
function dated(price: Price, now: string): Price {
  return price.after && now >= price.after.date ? { ...price, ...price.after } : price;
}
export function priceFor(
  provider: Provider,
  model: string,
  tokens = 0,
  now = new Date().toISOString().slice(0, 10),
): Price & { fallback: boolean } {
  const known = Object.hasOwn(PRICES[provider], model) ? PRICES[provider][model] : undefined;
  if (known) {
    const price = dated(known, now);
    return {
      ...price,
      ...(price.long && tokens > price.long.threshold ? price.long : {}),
      fallback: false,
    };
  }
  // Conservative component-wise maxima, including long context and cache writes.
  const rows = Object.values(PRICES[provider]).flatMap((p) => {
    const row = dated(p, now);
    return [row, ...(row.long ? [row.long] : [])];
  });
  const input = Math.max(...rows.map((p) => p.input));
  return {
    input,
    output: Math.max(...rows.map((p) => p.output)),
    cached: input,
    write: Math.max(...rows.map((p) => p.write ?? p.input)),
    writeHour: Math.max(...Object.values(PRICES[provider]).map((p) => p.writeHour ?? p.input)),
    fallback: true,
  };
}
// Integer nanodollars for comparisons: never grant an extra call due to floating-point rounding.
export const nanos = (usd: number) => Math.ceil(usd * 1e9);
export function usageCost(provider: Provider, model: string, u: Usage): number {
  const p = priceFor(provider, model, u.inputTokens + u.cacheWriteTokens + u.cacheWriteHourTokens);
  return (
    Math.ceil(
      ((u.inputTokens - u.cachedInputTokens) * p.input +
        u.cachedInputTokens * p.cached +
        u.cacheWriteTokens * (p.write ?? p.input) +
        u.cacheWriteHourTokens * (p.writeHour ?? p.input) +
        u.outputTokens * p.output) *
        1000,
    ) / 1e9
  );
}
export function reserveCost(
  provider: Provider,
  model: string,
  input: number,
  output: number,
): number {
  const p = priceFor(provider, model, input);
  const inputPrice = Math.max(p.input, p.write ?? 0, p.writeHour ?? 0);
  return Math.ceil((input * inputPrice + output * p.output) * 1000) / 1e9;
}
/** USD per million tokens, by token class, as applied to one model's usage. */
export interface Rates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWriteHour: number;
}
/** One model's tokens by class, the rates applied and what they cost: tokens x rate / 1e6. */
export interface ModelCost {
  model: string;
  /** Uncached input only: cache reads and writes are counted in their own fields. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** 5-minute cache writes. */
  cacheWriteTokens: number;
  /** 1-hour cache writes. */
  cacheWriteHourTokens: number;
  /** Absent when pricing.ts has no row for the model and the SDK's figure stands in. */
  rates?: Rates;
  costUsd: number;
  /** The Agent SDK's own figure for this model, from its built-in price table. */
  sdkReportedCostUsd?: number;
  /** No row in pricing.ts: `costUsd` is the SDK's figure (SDK) or the highest listed rates (patch). */
  unverified?: true;
}
/** What an agent spent; `costUsd` is computed from pricing.ts, never the SDK's figure. */
export interface Spend {
  /** Uncached input only, summed over models (cache reads and writes are in `models`). */
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  /** The Agent SDK's total, kept apart from `costUsd`. */
  sdkReportedCostUsd?: number;
  costUnverified?: true;
  models?: ModelCost[];
  /** Cost accounting warnings for the run's output, never the PR body. */
  warnings?: string[];
}
export function modelCost(
  provider: Provider,
  model: string,
  tokens: Omit<ModelCost, 'model' | 'rates' | 'costUsd' | 'sdkReportedCostUsd' | 'unverified'>,
): ModelCost {
  const p = priceFor(provider, model);
  return {
    model,
    ...tokens,
    rates: {
      input: p.input,
      output: p.output,
      cacheRead: p.cached,
      cacheWrite: p.write ?? p.input,
      cacheWriteHour: p.writeHour ?? p.input,
    },
    costUsd: usageCost(provider, model, {
      inputTokens: tokens.inputTokens + tokens.cacheReadTokens,
      cachedInputTokens: tokens.cacheReadTokens,
      cacheWriteTokens: tokens.cacheWriteTokens,
      cacheWriteHourTokens: tokens.cacheWriteHourTokens,
      outputTokens: tokens.outputTokens,
    }),
    ...(p.fallback ? { unverified: true as const } : {}),
  };
}
const addUsd = (a: number | undefined, b: number | undefined) =>
  a === undefined && b === undefined ? undefined : (nanos(a ?? 0) + nanos(b ?? 0)) / 1e9;
/** Adds `b` into `a`, model by model, in nanodollars so repeated adds do not drift. */
export function addSpend(a: Spend, b: Spend): void {
  a.inputTokens += b.inputTokens;
  a.outputTokens += b.outputTokens;
  a.costUsd = addUsd(a.costUsd, b.costUsd) ?? 0;
  const sdk = addUsd(a.sdkReportedCostUsd, b.sdkReportedCostUsd);
  if (sdk !== undefined) a.sdkReportedCostUsd = sdk;
  if (b.costUnverified) a.costUnverified = true;
  if (b.warnings?.length) a.warnings = [...(a.warnings ?? []), ...b.warnings];
  for (const row of b.models ?? []) {
    a.models ??= [];
    const same = a.models.find((m) => m.model === row.model);
    if (!same) {
      a.models.push({ ...row, ...(row.rates ? { rates: { ...row.rates } } : {}) });
      continue;
    }
    same.inputTokens += row.inputTokens;
    same.outputTokens += row.outputTokens;
    same.cacheReadTokens += row.cacheReadTokens;
    same.cacheWriteTokens += row.cacheWriteTokens;
    same.cacheWriteHourTokens += row.cacheWriteHourTokens;
    same.costUsd = addUsd(same.costUsd, row.costUsd) ?? 0;
    const sdkRow = addUsd(same.sdkReportedCostUsd, row.sdkReportedCostUsd);
    if (sdkRow !== undefined) same.sdkReportedCostUsd = sdkRow;
    if (row.unverified) same.unverified = true;
  }
}
/** What counts against --max-cost: the higher of the computed and the SDK-reported cost. */
export const chargedUsd = (s: Pick<Spend, 'costUsd' | 'sdkReportedCostUsd'>): number =>
  Math.max(s.costUsd ?? 0, s.sdkReportedCostUsd ?? 0);
