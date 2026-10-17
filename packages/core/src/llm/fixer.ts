import type { Fixer, FixRequest, FixResponse } from '../fix/types.js';
import { adapters } from './adapters.js';
import { KEY_ENV, type Selection } from './config.js';
import { nanos, reserveCost, usageCost } from './pricing.js';
import { messages } from './prompt.js';
import type { Call, Provider } from './types.js';

export const MAX_OUTPUT_TOKENS = 8192;
export const DEFAULT_MAX_COST_USD = 1;
// What one agent site is assumed to cost, SDK turns and the gate's retries included, uncached.
// ponytail: assumed, not calibrated against stored runs; tune from report.json `llm.estimate`
// against `llm.costUsd` once runs with many agent sites exist.
export const SITE_INPUT_TOKENS = 20_000;
export const SITE_OUTPUT_TOKENS = 2_000;
/** Where the run's limit is set, so every message names what to change. */
export type CostSetting = '--max-cost' | 'maxCost';
export interface CostEstimate {
  sites: number;
  usd: number;
  limitUsd: number;
  /** `maxCost`: the limit comes from uptide.yml (Action and App runs, or a local file). */
  setting: CostSetting;
}
// Up to the next cent, without float noise turning $0.18 into $0.19.
const cents = (usd: number) => Math.ceil(Number((usd * 100).toFixed(6))) / 100;
/** The preflight estimate for the sites the agent will handle, at the model's listed rates. */
export function costEstimate(
  provider: Provider,
  model: string,
  sites: number,
  limitUsd: number,
  setting: CostSetting = '--max-cost',
): CostEstimate {
  const site = usageCost(provider, model, {
    inputTokens: SITE_INPUT_TOKENS,
    outputTokens: SITE_OUTPUT_TOKENS,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    cacheWriteHourTokens: 0,
  });
  return { sites, usd: cents(sites * site), limitUsd, setting };
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const usd = (n: number) => `$${n.toFixed(2)}`;
/** `Run again with --max-cost 3.00`, or the uptide.yml setting when the limit comes from there. */
export function raiseLimit(setting: CostSetting, to: number): string {
  return setting === 'maxCost'
    ? `Raise maxCost in uptide.yml to ${to.toFixed(2)}`
    : `Run again with --max-cost ${to.toFixed(2)}`;
}
/** `estimated $0.18 for 3 sites; limit $1.00`. */
export const describeEstimate = (e: CostEstimate): string =>
  `estimated ${usd(e.usd)} for ${plural(e.sites, 'site')}; limit ${usd(e.limitUsd)}`;
/** The preflight stop: the estimate does not fit the limit, so nothing is spent. */
export const overEstimateMessage = (e: CostEstimate): string =>
  `${describeEstimate(e)}. ${raiseLimit(e.setting, e.usd)}.`;
/** The stop at the limit: the estimate, what was left, and the limit that continues. */
export function costStopMessage(
  limit: { limitUsd: number; notAttempted: number },
  e?: CostEstimate,
): string {
  const to = Math.max(2 * limit.limitUsd, e?.usd ?? 0);
  return `stopped at the ${usd(limit.limitUsd)} cost limit${e ? ` (${describeEstimate(e)})` : ''}: ${plural(limit.notAttempted, 'site')} not completed. ${raiseLimit(e?.setting ?? '--max-cost', to)} to continue.`;
}
// One token per UTF-8 byte, including JSON, schema, system prompt and retry feedback,
// plus 8192 tokens for provider framing/tool overhead. Deliberately NOT chars / 4.
export const estimateInputTokens = (call: Call): number =>
  Buffer.byteLength(JSON.stringify(call.body), 'utf8') + 8192;
export class CostLimitError extends Error {
  constructor(readonly requiredUsd: number) {
    super(
      `Next LLM call requires a worst-case reservation of $${requiredUsd.toFixed(6)}; insufficient --max-cost budget.`,
    );
  }
}
export function providerFixer(
  selection: Selection,
  options: {
    env?: NodeJS.ProcessEnv;
    fetch?: typeof fetch;
    effort?: 'low' | 'medium' | 'high';
  } = {},
): Fixer | undefined {
  const key = (options.env ?? process.env)[KEY_ENV[selection.provider]];
  if (!key?.trim()) return undefined;
  const adapter = adapters[selection.provider],
    fetcher = options.fetch ?? fetch;
  const prepare = (request: FixRequest) =>
    adapter.prepare(selection.model, messages(request), MAX_OUTPUT_TOKENS, selection.baseUrl, {
      effort: options.effort,
    });
  const estimate = (request: FixRequest) => {
    const call = prepare(request);
    return reserveCost(
      selection.provider,
      selection.model,
      estimateInputTokens(call),
      call.maxTokens,
    );
  };
  return {
    id: selection.model,
    provider: selection.provider,
    estimate,
    async fix(request, remainingUsd = DEFAULT_MAX_COST_USD) {
      const prepared = prepare(request),
        inputBound = estimateInputTokens(prepared);
      const reserved = reserveCost(
        selection.provider,
        selection.model,
        inputBound,
        prepared.maxTokens,
      );
      if (!Number.isFinite(remainingUsd) || nanos(reserved) > Math.floor(remainingUsd * 1e9))
        throw new CostLimitError(reserved);
      const unknown = (
        failure: string,
        failureKind: FixResponse['failureKind'] = 'api-error',
      ): FixResponse => ({
        failureKind,
        reservationUsd: reserved,
        diff: '',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        unreportedCostUsd: reserved,
        failure,
      });
      let body: unknown;
      try {
        const res = await fetcher(prepared.url, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(120_000),
          headers: { 'content-type': 'application/json', ...adapter.headers(key) },
          body: JSON.stringify(prepared.body),
        });
        // Never echo URLs, API error bodies, request headers or provider-controlled text.
        if (res.status === 429) {
          const after = res.headers.get('retry-after');
          const seconds = after === null ? NaN : Number(after);
          const retryAfterMs =
            after && !Number.isFinite(seconds) ? Date.parse(after) - Date.now() : seconds * 1000;
          return {
            ...unknown(
              `${selection.provider} rate limited (HTTP 429); wait before retrying. Worst-case cost reserved because no usage was returned.`,
              'rate-limited',
            ),
            retryAfterMs:
              Number.isFinite(retryAfterMs) && retryAfterMs >= 0 ? Math.ceil(retryAfterMs) : 60_000,
          };
        }
        if (!res.ok)
          return unknown(
            `${selection.provider} request failed (HTTP ${res.status}); worst-case cost reserved because no usage was returned.`,
          );
        body = await res.json();
      } catch {
        return unknown(
          `${selection.provider} request failed or timed out; worst-case cost reserved because no usage was returned.`,
        );
      }
      const result = adapter.parse(body);
      if (!result.usage)
        return unknown(
          'Provider returned no valid usage; worst-case cost reserved.',
          'usage-unavailable',
        );
      const u = result.usage;
      const billedInput = u.inputTokens + u.cacheWriteTokens + u.cacheWriteHourTokens;
      const base = {
        reservationUsd: reserved,
        ...(result.model ? { responseModel: result.model } : {}),
        inputTokens: billedInput,
        outputTokens: u.outputTokens,
        costUsd: usageCost(selection.provider, selection.model, u),
      };
      if (billedInput > inputBound || u.outputTokens > prepared.maxTokens)
        return {
          ...base,
          diff: '',
          failure: 'Provider exceeded the reserved token bounds; no further LLM calls are allowed.',
          halt: true,
          failureKind: 'token-bounds',
        };
      const tool = result.calls[0],
        args = tool?.arguments;
      if (
        result.failure ||
        result.calls.length !== 1 ||
        tool?.name !== 'submit_patch' ||
        !args ||
        typeof args !== 'object' ||
        Array.isArray(args) ||
        Object.keys(args).some((k) => k !== 'diff' && k !== 'explanation') ||
        !('diff' in args) ||
        typeof args.diff !== 'string' ||
        !('explanation' in args) ||
        typeof args.explanation !== 'string'
      )
        return {
          ...base,
          diff: '',
          failureKind: result.calls.length === 0 ? 'no-tool-call' : 'invalid-tool-call',
          failure:
            'Missing or invalid submit_patch: respond only by calling submit_patch, exactly once with string diff and explanation fields.',
        };
      return { ...base, diff: args.diff, explanation: args.explanation };
    },
  };
}
