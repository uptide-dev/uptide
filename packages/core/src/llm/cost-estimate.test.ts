import { expect, it } from 'vitest';
import {
  costEstimate,
  costStopMessage,
  overEstimateMessage,
  SITE_INPUT_TOKENS,
  SITE_OUTPUT_TOKENS,
} from './fixer.js';
import { DEFAULT_MODELS, PRICES } from './pricing.js';

const sonnet = (sites: number, limitUsd = 1, setting?: '--max-cost' | 'maxCost') =>
  costEstimate('anthropic', 'claude-sonnet-5-5', sites, limitUsd, setting);

it('prices a site with the pricing table entry for the default model', () => {
  const model = DEFAULT_MODELS.anthropic;
  const price = PRICES.anthropic[model];
  expect(model).toBe('claude-sonnet-5-5');
  expect(price).toMatchObject({ input: 2, output: 10 });
  // 20k input at $2/M and 2k output at $10/M: $0.06 a site.
  const site =
    (SITE_INPUT_TOKENS * (price?.input ?? 0) + SITE_OUTPUT_TOKENS * (price?.output ?? 0)) / 1e6;
  expect(site).toBe(0.06);
  expect(costEstimate('anthropic', model, 10, 1).usd).toBe(0.6);
  expect(costEstimate('anthropic', 'claude-opus-5-5', 10, 1).usd).toBe(1.2);
});

it('keeps the limit as given, whatever the estimate', () => {
  expect(sonnet(0)).toEqual({ sites: 0, usd: 0, limitUsd: 1, setting: '--max-cost' });
  expect(sonnet(50)).toEqual({ sites: 50, usd: 3, limitUsd: 1, setting: '--max-cost' });
  expect(sonnet(50, 4, 'maxCost').limitUsd).toBe(4);
});

it('stops before spending with the estimate and the flag, or the uptide.yml setting', () => {
  expect(overEstimateMessage(sonnet(50))).toBe(
    'estimated $3.00 for 50 sites; limit $1.00. Run again with --max-cost 3.00.',
  );
  expect(overEstimateMessage(sonnet(50, 1, 'maxCost'))).toBe(
    'estimated $3.00 for 50 sites; limit $1.00. Raise maxCost in uptide.yml to 3.00.',
  );
});

it('names the estimate in the stop at the limit and a limit that continues', () => {
  expect(costStopMessage({ limitUsd: 1, notAttempted: 3 }, sonnet(10))).toBe(
    'stopped at the $1.00 cost limit (estimated $0.60 for 10 sites; limit $1.00): 3 sites not completed. Run again with --max-cost 2.00 to continue.',
  );
  expect(costStopMessage({ limitUsd: 1, notAttempted: 1 }, sonnet(10, 1, 'maxCost'))).toBe(
    'stopped at the $1.00 cost limit (estimated $0.60 for 10 sites; limit $1.00): 1 site not completed. Raise maxCost in uptide.yml to 2.00 to finish.',
  );
});
