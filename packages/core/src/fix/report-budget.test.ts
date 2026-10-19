import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { published, uptideCommand } from '../version.js';
import {
  largeStripeReport,
  manySitesReport,
  unmatchedStripeReport,
} from './__fixtures__/large-reports.js';
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
    expect(body).toContain(`${resource} · 22 changes`);
    expect(body.match(new RegExp(`\\[${resource} change`, 'g'))).toHaveLength(13);
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

it('shortens the breaking entries no field name can match, never drops them, and keeps them over test output', () => {
  const report = unmatchedStripeReport();
  const shown = (body: string) =>
    [...body.matchAll(/subscription-unmatched-(\d+)\.md/g)].map((m) => Number(m[1]));
  // Whole when it fits, ahead of the passed test log.
  const whole = renderMigration(report, 'full', 20_000) ?? '';
  expect(whole.length).toBeLessThanOrEqual(20_000);
  expect(shown(whole)).toHaveLength(40);
  expect(whole).not.toContain('PASS billing scenario 0');
  // Tighter: the count, the first ten with the new defaults first, and where the rest are.
  const tight = renderMigration(report, 'full', 16_000) ?? '';
  expect(tight.length).toBeLessThanOrEqual(16_000);
  expect(tight).toContain(
    "**40 breaking changes to resources you use that field names can't match**",
  );
  expect(tight).toContain('The first 10, new defaults first; all 40 are in report.json.');
  expect(shown(tight)).toHaveLength(10);
  expect(shown(tight).slice(0, 3)).toEqual([37, 38, 39]);
  expect(tight).toContain("40 breaking changes can't be matched this way");
  balanced(tight);
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
                  `- 2026-09-30.clover: [${name} change ${i} to \`old_field\`](https://docs.stripe.com/changelog/${name}-${i}) — breaking; All products`,
              ),
            ),
            '- Legacy entry with an unknown format',
            '- Legacy evidenced entry — evidence: `src/billing.ts:18` (field `Stripe.Subscription#current_period_end`)',
          ],
        },
      ],
    },
    report,
  );
  expect(section.lists?.flatMap((l) => l.items)).toHaveLength(20);
  expect(section.lists?.every((l) => l.items.length <= 5)).toBe(true);
  expect(section.summary).toContain('10 resource changes and 1 other changelog entries omitted');
  expect(section.summary).toContain('report.json');
  expect(section.lines.join('\n')).toContain('Legacy evidenced entry — evidence:');
  expect(section.lists?.flatMap((l) => l.items).join('\n')).not.toContain(' — evidence:');
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
  expect(body).toContain(`${uptideCommand(published)} verify`);
  balanced(body);
});

it('keeps every evidenced Stripe entry above details and uncapped under budget pressure', () => {
  const report = largeStripeReport();
  const evidence =
    report.reviewSections?.[0]?.lines.filter((line) => line.includes(' — evidence: ')) ?? [];
  expect(evidence).toHaveLength(24); // Exceeds both resource and total caps.
  for (const budget of [PR_BODY_BUDGET, 16_000]) {
    const body = renderMigration(report, 'full', budget);
    expect(body.length).toBeLessThanOrEqual(budget);
    expect(body).toContain('24 changes with evidence in your code');
    let depth = 0;
    const visible: string[] = [];
    for (const line of body.split('\n')) {
      depth += (line.match(/<details>/g) ?? []).length;
      if (depth === 0) visible.push(line);
      depth -= (line.match(/<\/details>/g) ?? []).length;
    }
    for (const entry of evidence) {
      expect(visible).toContain(entry);
      expect(body.indexOf(entry)).toBeLessThan(body.indexOf('### What changed'));
      expect(body.split(entry)).toHaveLength(2);
    }
    balanced(body);
    if (budget === 16_000) {
      expect(body).toContain('Showing 0 of 66');
      expect(body).toContain('66 resource changes and 330 other changelog entries omitted');
      expect(body).toContain('### Decisions for you');
      expect(body).toContain('### Worth a look');
      expect(body.match(/```diff/g)).toHaveLength(2);
      expect(body).toContain('PASS billing scenario 0');
      expect(body).toContain('report.json');
      expect(body).toMatchSnapshot();
    }
  }
});

it.each(['uptide', 'npx uptide', 'npx uptide@next'])(
  'makes shared PR commands portable from %s reports',
  (invocation) => {
    const report = manySitesReport();
    report.decisions = [`- Run \`${invocation} verify\` after reviewing.`];
    expect(prBody(report)).toContain(`Run \`${uptideCommand(published)} verify\``);
  },
);

it('keeps the Action report and PR body portable without an npm invocation', async () => {
  const binary = process.argv[1] ?? '';
  vi.stubEnv('GITHUB_ACTIONS', 'true');
  vi.stubEnv('npm_command', '');
  process.argv[1] = '/home/runner/work/_actions/uptide-dev/uptide/main/dist/index.js';
  try {
    vi.resetModules();
    const { UPTIDE_COMMAND } = await import('../version.js');
    const { prBody } = await import('./report.js');
    expect(UPTIDE_COMMAND).toBe(uptideCommand(published));
    const report = manySitesReport();
    report.decisions = [`- Run \`${UPTIDE_COMMAND} verify\` after reviewing.`];
    expect(prBody(report)).toContain(`Run \`${uptideCommand(published)} verify\``);
  } finally {
    process.argv[1] = binary;
    vi.unstubAllEnvs();
  }
});

/** ~300 manual sites and ~100 churned lockfile entries: required lists far past the limit (UPT-106). */
function overflowingReport(): FixReport {
  const report = manySitesReport();
  report.sites = report.sites.slice(0, 300).map((s, i) => ({
    ...s,
    outcome: 'manual' as const,
    rule: `rule-${i % 3}`,
    reason: `Needs a person: ${'the call site passes options the rule cannot rewrite safely; '.repeat(3)}${i}`,
  }));
  const churn = (prefix: string) =>
    Array.from({ length: 100 }, (_, i) => ({
      name: `${prefix}-${i}`,
      ...(i % 4 === 0 ? {} : { from: '1.0.0' }),
      ...(i % 4 === 1 ? {} : { to: i % 4 === 2 ? '1.0.0' : '1.1.0' }),
    }));
  report.lockfile = {
    manager: 'npm',
    file: 'package-lock.json',
    added: [],
    removed: [],
    changed: [],
    allowed: [],
    outOfScope: churn('outside'),
    parentChurn: churn('parent'),
  };
  return report;
}

it('renders 300 manual sites and 100 churned lockfile entries under the limit, every section represented', () => {
  const report = overflowingReport();
  report.runUrl = 'https://github.com/acme/app/actions/runs/42';
  expect(migrationBody(report).length).toBeGreaterThan(PR_BODY_BUDGET);
  const body = prBody(report);
  expect(body.length).toBeLessThanOrEqual(PR_BODY_BUDGET);
  for (const section of [
    '### Lockfile changes outside the upgrade: review',
    '### Lockfile churn the parent commit already has',
    '| **Risk** |',
    '### What changed',
    '### Worth a look',
    '### Decisions for you',
    'Verification details',
    'Run details',
  ])
    expect(body).toContain(section);
  // Manual sites: by rule, with counts and the first locations.
  expect(body).toContain('- Manual: 300 sites to change by hand');
  expect(body).toContain('- `rule-0` (100): `src/billing-0.ts:1`, `src/billing-3.ts:4`');
  expect(body).toContain('and 95 more');
  expect(body).toContain('[job summary](https://github.com/acme/app/actions/runs/42)');
  expect(body).toContain('- parent-99 1.0.0 → 1.1.0');
  balanced(body);
  // Tighter still, lockfile churn keeps its counts per kind of change and the first packages.
  const tight = renderMigration(report, 'full', 8_000);
  expect(tight.length).toBeLessThanOrEqual(8_000);
  expect(tight).toContain('### Lockfile churn the parent commit already has');
  expect(tight).toContain(
    '100 entries: 25 added, 25 removed, 25 re-resolved at the same version, 25 version changed',
  );
  expect(tight).toContain('- parent-9 ');
  expect(tight).not.toContain('- parent-10 ');
  expect(tight).toContain('- Manual: 300 sites to change by hand');
  balanced(tight);
});

it('falls back to a minimal body when even the compact sections do not fit', () => {
  const report = overflowingReport();
  report.decisions = ['- Owner decision. '.repeat(PR_BODY_BUDGET / 4)];
  const body = prBody(report);
  expect(body.length).toBeLessThanOrEqual(PR_BODY_BUDGET);
  expect(body).toMatch(/^## Upgrade example-sdk [^\n]+\n\n> ⚠️ \*\*Shortened description\.\*\*/);
  expect(body).toContain('Verification: PASS.');
  expect(body).toContain('300 manual');
  expect(body).toContain('report.json');
  expect(body).not.toContain('Owner decision');
});

it('names the files an agent decision changed, not the task scope (UPT-106)', () => {
  const report = manySitesReport();
  const scope = Array.from({ length: 317 }, (_, i) => `src/module-${i}.ts`);
  report.llm.tasks = [
    {
      id: 'verification-1',
      rule: 'verification',
      files: scope,
      sites: 0,
      fixed: 0,
      turns: 3,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMs: 0,
      toolCalls: {},
      gate: 'accepted',
      diffs: { 'src/module-7.ts': '+x' },
      summary: {
        changed: [],
        decisions: ['Kept the ref nullable'],
        assumptions: [],
        couldNotDo: [],
        newFiles: [],
      },
    },
  ];
  expect(prBody(report)).toContain(
    '- `src/module-7.ts`: Kept the ref nullable. Confirm or change.',
  );
  delete (report.llm.tasks[0] as { diffs?: unknown }).diffs;
  expect(prBody(report)).toContain('`src/module-4.ts` and 312 more files: Kept the ref nullable.');
});

it('drops an agent decision that restates a behavior record the PR already decides (UPT-114)', () => {
  const report = manySitesReport();
  const id = 'zod/mcp-input-schema-additional-properties';
  report.packContext = {
    from: '3.25.76',
    to: '4.6.5',
    includeDeprecated: false,
    recordSites: [{ record: id, file: 'src/module-7.ts', line: 3, snippet: 'x', kept: true }],
  };
  report.llm.tasks = [
    {
      id: 't',
      rule: id,
      files: ['src/module-7.ts'],
      sites: 0,
      fixed: 0,
      turns: 3,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMs: 0,
      toolCalls: {},
      gate: 'accepted',
      diffs: { 'src/module-7.ts': '+x' },
      summary: {
        changed: [],
        decisions: [`${id}: chose .strict() at all 5 calls`, 'Kept the ref nullable'],
        assumptions: [],
        couldNotDo: [],
        newFiles: [],
      },
    },
  ];
  const body = prBody(report);
  expect(body).not.toContain('chose .strict()');
  expect(body).toContain('- `src/module-7.ts`: Kept the ref nullable. Confirm or change.');
});
