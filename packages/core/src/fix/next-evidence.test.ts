import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { decidedRules, packDecisions } from '../packs/decisions.js';
import { nextPack } from '../packs/next/index.js';
import { stripePack } from '../packs/stripe/index.js';
import { uniqueSites } from './paired.js';
import { prBody } from './report.js';
import { agentDecisionLines } from './review-evidence.js';
import type { FixReport, FixSite } from './types.js';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture evidence');
  return value;
}
function fixture(name: string): FixReport {
  return JSON.parse(
    readFileSync(new URL(`./__fixtures__/next-${name}.json`, import.meta.url), 'utf8'),
  );
}
for (const name of ['exif', 'wort']) {
  it(`snapshots the regenerated public ${name} PR body`, () => {
    const report = fixture(name);
    report.decisions = packDecisions(
      nextPack,
      required(report.packContext),
      report.sites.flatMap((s) => (s.rule ? [s.rule] : [])),
    );
    const body = prBody(report);
    expect(body).toMatchSnapshot();
    expect(body).not.toContain('not retained');
    expect(body).not.toContain('decision Verification');
    if (name === 'exif') {
      expect(body).toContain('10 sites');
      expect(body).toContain('10 revalidateTag calls');
      expect(body).toContain('immediate expiry, as in Next 15');
      expect(body).toContain('```diff');
      expect(body).toContain('+const REVALIDATE_PROFILE');
      expect(body).toContain('No Node version found');
      expect(body).not.toContain('No TypeScript version found');
    } else expect(body).not.toContain('platform-minimums');
  });
}
it('merges compiler evidence into its pack site without losing the accepted patch', () => {
  const report = fixture('exif');
  const pack = required(report.sites[0]);
  const compiler = structuredClone(pack);
  compiler.rule = undefined;
  compiler.finding.rule = undefined;
  compiler.finding.change.source = 'types';
  compiler.finding.usage.compileError = 'Expected 2 arguments, but got 1.';
  const sites = uniqueSites([compiler, ...report.sites]);
  expect(sites).toHaveLength(10);
  expect(sites[0]?.rule).toBe('revalidate-tag-profile');
  expect(sites[0]?.finding.usage.compileError).toContain('Expected 2');
  expect(sites[0]?.diff).toContain('@@');
  expect(prBody({ ...report, sites: [compiler, ...report.sites] })).toBe(
    prBody({ ...report, sites }),
  );
  compiler.finding.usage.line += 1;
  expect(uniqueSites([compiler, pack])).toHaveLength(2);
});
it('lists supporting files and preserves general accepted choices but not rejected plans', () => {
  const report = fixture('exif');
  report.package = 'example';
  required(report.sites[0]).editedFiles = ['src/support.ts'];
  const task = required(report.llm.tasks?.[0]);
  required(task.summary).decisions = ['Chose A to preserve behavior; B changes caching.'];
  expect(agentDecisionLines(report).join('\n')).toContain(
    'Chose A to preserve behavior; B changes caching.',
  );
  expect(prBody(report)).toContain('`src/support.ts`');
  task.gate = 'rejected';
  expect(agentDecisionLines(report)).toEqual([]);
});

it('does not describe mixed cache choices as uniform immediate expiry', () => {
  const report = fixture('exif');
  const task = required(report.llm.tasks?.[0]);
  const diffs = required(task.diffs);
  diffs['src/photo/cache.ts'] = required(diffs['src/photo/cache.ts']).replace(
    '+  revalidateTag(KEY_PHOTOS, REVALIDATE_PROFILE);',
    '+  revalidateTag(KEY_PHOTOS, "max");',
  );
  expect(agentDecisionLines(report).join('\n')).not.toContain('10 revalidateTag calls');
});

it('says each decision once per rule and resource (UPT-70)', () => {
  // The stripe PR body from the 0.13.0 smoke: two agent tasks restated the pack's own
  // multi-item billing-period decision, one per file.
  const context = {
    from: '17.7.0',
    to: '19.1.0',
    includeDeprecated: false,
    apiVersions: { from: '2025-02-24.acacia', to: '2025-09-30.clover' },
    payloadVersions: [{ file: 'test/webhook.test.ts', line: 3, value: '2025-02-24.acacia' }],
  };
  // The payload-fixture bullet is said on every run: it decides no rule.
  expect(
    decidedRules(stripePack, context, [
      'api-version-unpinned',
      'subscription-period',
      'sdk-surface',
    ]),
  ).toEqual(['api-version-unpinned', 'subscription-period']);
  const site = (file: string, rule: string, path: string) =>
    ({
      rule,
      outcome: 'agent',
      finding: { usage: { file, line: 1 }, change: { path } },
    }) as FixSite;
  const task = (file: string, decision: string) => ({
    gate: 'accepted',
    files: [file],
    summary: { decisions: [decision] },
  });
  const report = {
    package: 'stripe',
    decidedRules: ['api-version-unpinned', 'subscription-period'],
    sites: [
      site(
        'pages/api/webhooks/stripe.ts',
        'subscription-period',
        'Stripe.Subscription#current_period_end',
      ),
      site('lib/billing.ts', 'subscription-period', 'Stripe.Subscription#current_period_start'),
      site('lib/stripe.ts', 'sdk-surface', 'Stripe.Invoice#subscription'),
      site('lib/invoices.ts', 'sdk-surface', 'Stripe.Invoice#subscription'),
      site('lib/prices.ts', 'sdk-surface', 'Stripe.Price#tiers'),
    ],
    llm: {
      tasks: [
        task(
          'pages/api/webhooks/stripe.ts',
          'Multi-item subscriptions take the latest-ending item',
        ),
        task('lib/billing.ts', 'With several items, the period comes from the item that ends last'),
        task('lib/stripe.ts', 'The subscription id is read from parent.subscription_details'),
        task('lib/invoices.ts', 'Read the subscription id from parent.subscription_details'),
        task('lib/prices.ts', 'Tiers are expanded on retrieve'),
      ],
    },
  } as unknown as FixReport;
  expect(agentDecisionLines(report)).toMatchInlineSnapshot(`
    [
      "- \`lib/stripe.ts\`, \`lib/invoices.ts\`: The subscription id is read from parent.subscription_details. Confirm or change.",
      "- \`lib/prices.ts\`: Tiers are expanded on retrieve. Confirm or change.",
    ]
  `);
});
