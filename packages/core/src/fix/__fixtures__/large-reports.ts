import { readFileSync } from 'node:fs';
import type { FixReport } from '../types.js';

export function largeStripeReport(): FixReport {
  const report = JSON.parse(
    readFileSync(new URL('./stripe.json', import.meta.url), 'utf8'),
  ) as FixReport;
  const names = ['subscription', 'customer', 'invoice'];
  report.apiChanges = {
    from: '2024-12-18.acacia',
    to: '2026-09-30.clover',
    total: 420,
    relevant: 24,
    breaking: 24,
    resources: { total: 90, breaking: 30, names },
  };
  const items = Array.from({ length: 420 }, (_, i) => {
    const resource = i < 90 ? names[i % 3] : 'account';
    return `- 2026-09-30.clover: [${resource} change ${i}: review response compatibility${i < 30 ? ' of `old_field`' : ''}](https://docs.stripe.com/changelog/clover/2026-09-30/${resource}-${i}.md) — ${i < 30 ? 'breaking' : 'non-breaking'}; ${i < 90 ? 'Billing' : 'Connect'}${i < 24 ? ` — evidence: \`src/billing-${i}.ts:${i + 1}\` (field \`Stripe.Subscription#current_period_end\`)` : ''}`;
  });
  report.reviewSections = [
    {
      title: 'Stripe API changelog',
      lines: ['24 changes with evidence in your code', '', ...items.slice(0, 24)],
      lists: [
        {
          summary:
            '66 other changes to resources you use (6 breaking): subscription, customer, invoice',
          items: items.slice(24, 90),
          more: '- … {n} resource changes omitted.',
        },
        {
          summary: '330 other changelog entries',
          items: items.slice(90),
          more: '- … {n} other changes omitted.',
        },
      ],
    },
  ];
  report.verification.tests = [
    {
      workspace: '.',
      status: 'passed',
      output: Array.from(
        { length: 60 },
        (_, i) =>
          `PASS billing scenario ${i}: invoice and subscription response compatibility verified`,
      ).join('\n'),
    },
  ];
  return report;
}

export function manySitesReport(): FixReport {
  const report = largeStripeReport();
  // Exercise the same engine budget on a different pack, with two independent rule groups.
  report.package = 'example-sdk';
  delete report.apiChanges;
  report.reviewSections = [
    {
      title: 'SDK changelog',
      lines: [],
      lists: [
        {
          summary: '400 SDK changes',
          items: Array.from(
            { length: 400 },
            (_, i) => `- SDK change ${i}: ${'compatibility detail '.repeat(12)}`,
          ),
          more: '- {n} SDK changes omitted.',
        },
      ],
    },
  ];
  report.decisions = ['- Confirm the billing policy before deploying.'];
  report.verification.tests.push({ workspace: 'integration', status: 'missing', output: '' });
  const base = report.sites[0];
  if (!base) throw new Error('stripe fixture needs a site');
  report.sites = Array.from({ length: 500 }, (_, i) => ({
    ...structuredClone(base),
    rule: `resource-${i % 2}`,
    finding: {
      ...base.finding,
      usage: { ...base.finding.usage, file: `src/billing-${i}.ts`, line: i + 1 },
    },
  }));
  return report;
}
