import { expect, it } from 'vitest';
import { costEstimate, costStopMessage, describeLimit, MAX_DEFAULT_COST_USD } from './fixer.js';

// claude-sonnet-5-5 at $2/$10 per million: 20k in + 2k out is $0.06 a site.
const sonnet = (sites: number, maxCostUsd?: number) =>
  costEstimate('anthropic', 'claude-sonnet-5-5', sites, maxCostUsd);

it('estimates from the sites the agent will handle, priced for the model', () => {
  expect(sonnet(0).usd).toBe(0);
  expect(sonnet(10).usd).toBe(0.6);
  expect(costEstimate('anthropic', 'claude-opus-5-5', 10).usd).toBe(1.2);
});

it('scales the default limit to twice the estimate, from $1 up to the cap', () => {
  expect(sonnet(3)).toEqual({ sites: 3, usd: 0.18, limitUsd: 1, scaled: true });
  expect(sonnet(25).limitUsd).toBe(3);
  expect(sonnet(500).limitUsd).toBe(MAX_DEFAULT_COST_USD);
  // An explicit --max-cost is kept as given, above or below the estimate.
  expect(sonnet(500, 2)).toEqual({ sites: 500, usd: 30, limitUsd: 2, scaled: false });
});

it('says where the limit came from', () => {
  expect(describeLimit(sonnet(3))).toBe(
    'default: the $1 minimum; the $0.18 estimate for 3 agent sites',
  );
  expect(describeLimit(sonnet(25))).toBe('default: 2× the $1.50 estimate for 25 agent sites');
  expect(describeLimit(sonnet(500))).toBe(
    'default: 2× the $30.00 estimate for 500 agent sites, capped at $10',
  );
  expect(describeLimit(sonnet(1, 4))).toBe('--max-cost; the $0.06 estimate for 1 agent site');
});

it('names the estimate in the stop message and a limit that continues', () => {
  const capped = sonnet(500);
  expect(costStopMessage({ limitUsd: capped.limitUsd, notAttempted: 312 }, capped)).toBe(
    'stopped at the $10.00 cost limit (default: 2× the $30.00 estimate for 500 agent sites, capped at $10): 312 sites not completed. Run again with --max-cost 60 to continue.',
  );
  expect(costStopMessage({ limitUsd: 1, notAttempted: 1 })).toBe(
    'stopped at the $1.00 cost limit (--max-cost): 1 site not completed. Run again with --max-cost 2 to continue.',
  );
});
