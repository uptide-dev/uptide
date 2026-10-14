import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { UPTIDE_COMMAND } from '../version.js';
import { largeStripeReport, manySitesReport } from './__fixtures__/large-reports.js';
import { migrationBody, PR_BODY_BUDGET, prBody, renderMigration } from './report.js';
import { stripeChangelog } from './stripe-changelog.js';
import type { FixReport } from './types.js';

function balanced(body: string) {
  expect((body.match(/<details>/g) ?? []).length).toBe((body.match(/<\/details>/g) ?? []).length);
  expect((body.match(/^```/gm) ?? []).length % 2).toBe(0);
}

it('keeps the under-budget output byte-for-byte unchanged', () => {
  const report = JSON.parse(
    readFileSync(new URL('./__fixtures__/storefront-zod.json', import.meta.url), 'utf8'),
  ) as FixReport;
  expect(prBody(report)).toBe(migrationBody(report));
  expect(prBody(report)).toMatchSnapshot();
});

it('groups and caps a large Stripe changelog, linking the omitted range', () => {
  const report = largeStripeReport();
  const before = JSON.stringify(report);
  const body = prBody(report);
  expect(migrationBody(report).length).toBeGreaterThan(PR_BODY_BUDGET);
  expect(body.length).toBeLessThanOrEqual(PR_BODY_BUDGET);
  expect(body).not.toContain('account change');
  for (const resource of ['customer', 'invoice', 'subscription']) {
    expect(body).toContain(`${resource} · 30 changes`);
    expect(body.match(new RegExp(`\\[${resource} change`, 'g'))).toHaveLength(5);
  }
  expect(body).toContain("[Stripe's changelog](https://docs.stripe.com/changelog)");
  expect(body.match(/\[Stripe's changelog\]/g)).toHaveLength(1);
  expect(body).toContain('2024-12-18.acacia → 2026-09-30.clover');
  expect(body).toContain('report.json');
  expect(body).toContain('PASS billing scenario 0');
  expect(body).not.toContain('Test output (passed) left out');
  expect(JSON.stringify(report)).toBe(before);
  balanced(body);
  expect(body).toMatchSnapshot();
});

it('caps the total across resources and discloses unrecognized legacy entries', () => {
  const report = largeStripeReport();
  const names = ['invoice', 'customer', 'subscription', 'account', 'charge'];
  if (!report.apiChanges?.resources) throw new Error('missing API facts');
  report.apiChanges.resources.names = names;
  const section = stripeChangelog(
    {
      title: 'Stripe API changelog',
      lines: [],
      lists: [
        {
          summary: 'Resource changes',
          more: '',
          items: [
            ...names.flatMap((name) =>
              Array.from(
                { length: 6 },
                (_, i) =>
                  `- 2026-09-30.clover: [${name} change ${i}](https://docs.stripe.com/changelog/${name}-${i}) — breaking; All products`,
              ),
            ),
            '- Legacy entry with an unknown format',
          ],
        },
      ],
    },
    report,
  );
  expect(section.lists?.flatMap((l) => l.items)).toHaveLength(20);
  expect(section.lists?.every((l) => l.items.length <= 5)).toBe(true);
  expect(section.lines.join('\n')).toContain(
    '10 resource changes and 1 other changelog entries omitted',
  );
  expect(section.lines.join('\n')).toContain('report.json');
});

it('trims low-priority material before verification and retains diffs with many sites in any pack', () => {
  const report = manySitesReport();
  const body = prBody(report);
  expect(migrationBody(report).length).toBeGreaterThan(PR_BODY_BUDGET);
  expect(body.length).toBeLessThanOrEqual(PR_BODY_BUDGET);
  for (const section of [
    '| **Risk** |',
    '### What changed',
    '### Worth a look',
    '### Decisions for you',
    'Verification details',
  ])
    expect(body).toContain(section);
  expect(body.match(/```diff/g)).toHaveLength(2);
  expect(body).toContain(report.sites[0]?.diff?.trim());
  expect(body).toContain('PASS billing scenario 0');
  expect(body).toContain('report.json');
  balanced(body);
  expect(body).toMatchSnapshot();
  const tight = renderMigration(largeStripeReport(), 'full', 16_000);
  expect(tight.length).toBeLessThanOrEqual(16_000);
  expect(tight).toContain('PASS billing scenario 0');
});

it('trims transitive lists before verification, including notices and expanded commands in the budget', () => {
  const report = manySitesReport();
  report.lockfile = {
    manager: 'npm',
    file: 'package-lock.json',
    added: [],
    removed: [],
    changed: [],
    allowed: [],
    transitive: [
      {
        name: 'example-sdk',
        from: ['1'],
        to: ['2'],
        changes: Array.from({ length: 1500 }, (_, i) => ({
          name: `transitive-${i}`,
          from: '1.0.0',
          to: '2.0.0',
        })),
      },
    ],
  };
  report.decisions = ['- Run `uptide verify` after reviewing.'];
  const body = prBody(report);
  expect(body.length).toBeLessThanOrEqual(PR_BODY_BUDGET);
  expect(body).toContain('1500 transitive changes omitted');
  expect(body).not.toContain('replaced transitive-0');
  expect(body).toContain('PASS billing scenario 0');
  expect(body).toContain(`${UPTIDE_COMMAND} verify`);
  balanced(body);
});
