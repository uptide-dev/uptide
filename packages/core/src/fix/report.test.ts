import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GENERIC_NOTE } from '../packs/generic.js';
import { stripePack } from '../packs/stripe/index.js';
import { largeStripeReport } from './__fixtures__/large-reports.js';
import {
  apiChangeSummary,
  errorSummary,
  formatFix,
  migrationBody,
  migrationRisk,
  PR_BODY_BUDGET,
  prBody,
  renderMigration,
} from './report.js';
import type { FixReport } from './types.js';

function first<T>(items: T[] | undefined): T {
  const value = items?.[0];
  if (!value) throw new Error('missing fixture item');
  return value;
}
function fixture(name: string): FixReport {
  return JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), 'utf8'));
}
function visible(body: string): string {
  let depth = 0;
  return body
    .split('\n')
    .filter((line) => {
      const opens = (line.match(/<details>/g) ?? []).length;
      const closes = (line.match(/<\/details>/g) ?? []).length;
      const hidden = depth > 0 || opens > 0;
      depth += opens - closes;
      return !hidden;
    })
    .join('\n');
}
for (const name of ['storefront-zod', 'stripe'])
  describe(name, () => {
    it('snapshots the full PR description and compact terminal/comment summary', () => {
      const report = fixture(name);
      expect(prBody(report)).toMatchSnapshot();
      expect(formatFix(report)).toMatchSnapshot();
    });
    it('keeps reasoning, probes and run metadata collapsed, except review evidence', () => {
      const report = fixture(name),
        body = prBody(report),
        top = visible(body);
      expect(top.match(/^\| \*\*/gm)).toHaveLength(6);
      // A build that did not run says so; the pack's gate sits beside it, never in its place.
      expect(top).toMatch(
        /^\| \*\*Verified by\*\* \|.* · ⚠️ build not run(?: \(not required by the pack\))? · /m,
      );
      // Decisions and concrete changelog evidence name the code they concern.
      expect(
        top.replace(/### (?:Decisions for you|Stripe API changelog)\n[\s\S]*?(?=\n### |$)/g, ''),
      ).not.toMatch(
        /packages\/|src\/|seed|methodology|tokens|claude|Diagnostic|earlier accepted edit/,
      );
      expect(body).toContain('<details><summary>Verification details</summary>');
      expect(body).toContain('<details><summary>Run details</summary>');
      expect(body).toContain('```diff');
      expect(top).toContain('### What changed');
      expect(formatFix(report)).not.toMatch(
        /<details>|### Worth a look|### Decisions|sampled inputs|No tests ran/,
      );
    });
  });
it('matches the storefront counts and folds the two resolved diagnostics into one fix', () => {
  const body = prBody(fixture('storefront-zod'));
  expect(body).toContain('29 sites in 8 files · 25 auto-fixed · 4 fixed by the agent (LLM)');
  expect(body).toContain('✅ 5 tests in 3 files passed');
  // The one test that asserted zod 3's default wording was updated, and the owner is told.
  expect(visible(body)).toContain(
    '`packages/shared/src/monitoring.test.ts:21` `"Required"` → `"Invalid input: expected string, received undefined"`',
  );
  expect(body).toContain('9 schemas identical · 2 not checked · 21/21 custom-message assertions');
  // The two schemas that import the shared workspace package are named, not silently dropped.
  expect(body).toContain(
    '`signUpSchema` and `createOrderSchema`: behavior not checked (they import another schema file)',
  );
  expect(body).toContain('1 fix, 3 errors · by the agent (LLM)');
  expect(body.match(/^\*\*\d+\./gm)).toHaveLength(4);
  expect(body).not.toContain('diagnostic resolved by an earlier');
  expect(body).toContain('orders.ts` (6)');
});
it('groups stripe API literals and period-end accesses, with actionable business decisions', () => {
  const body = prBody(fixture('stripe'));
  expect(body.match(/^\*\*\d+\./gm)).toHaveLength(2);
  expect(body).toContain('### Decisions for you');
  expect(visible(body)).toContain("items ending `[100, 200]` → that item's `{ start, end }`");
  expect(visible(body)).toContain('what no items means');
  expect(visible(body)).toContain('1 change with evidence in your code');
  expect(visible(body)).toContain('evidence: `src/billing.ts:18`');
});
it("says what the changelog check covered, and lists the breaking changes it can't match (dms-saas, round 4)", () => {
  // The Stripe section uptide 0.16.0 stored for dms-saas: 230 entries, none with evidence.
  const body = prBody({ ...fixture('stripe'), ...fixture('stripe-dms-saas-round-4') });
  expect(body).not.toMatch(/none affects? your code/);
  expect(body).toContain(
    "0 of 230 API changes matched your code by field name; 13 breaking changes can't be matched this way between 2025-08-27.basil and 2026-08-26.dahlia.",
  );
  expect(body).toContain(
    "| **Behavior** | ⚠️ 0 of 230 API changes matched your code by field name; 13 breaking changes can't be matched this way |",
  );
  // The billing-mode default flip is in plain view under its own heading, first, not collapsed.
  const heading = "**13 breaking changes to resources you use that field names can't match**";
  const top = visible(body);
  const list = top.slice(top.indexOf(heading), top.indexOf("[Stripe's changelog]"));
  expect(list.split('\n').find((l) => l.startsWith('- '))).toBe(
    '- 2025-09-30.clover: [Makes flexible billing mode the default for new subscriptions](https://docs.stripe.com/changelog/clover/2025-09-30/billing-mode-default-flexible.md) — breaking; Billing, Checkout',
  );
  expect(list.match(/^- /gm)).toHaveLength(13);
  // Its URL slug reads like a field name, but its title names none.
  expect(list).toContain(
    '[Removes postal code for card payments in certain regions on Checkout and Payment Element]',
  );
  const collapsed = body.slice(
    body.indexOf('Other changes to resources you use (no code evidence)'),
  );
  expect(collapsed).not.toContain('billing-mode-default-flexible');
});
function ruleOnly(): FixReport {
  const report = fixture('storefront-zod');
  report.sites = report.sites.filter(
    (s) => s.outcome === 'mechanical' && s.rule === 'error-params',
  );
  delete report.decisions;
  report.sites.forEach((s) => {
    s.finding.usage.file = 'plain.ts';
  });
  report.behavior = (report.behavior ?? []).filter((b) => !b.skipped);
  report.verification.tests.forEach((t) => {
    t.status = 'passed';
  });
  return report;
}
it('omits empty review and decision sections for a fully verified rule-only run', () => {
  const report = ruleOnly();
  expect(migrationRisk(report)).toEqual({ level: 'Low', reason: 'rule-only; all verified' });
  expect(prBody(report)).not.toContain('### Worth a look');
  expect(prBody(report)).not.toContain('### Decisions for you');
});
it('computes medium risk for agent edits, sensitive paths, missing tests and unchecked schemas', () => {
  for (const change of [
    (r: FixReport) => {
      first(r.sites).outcome = 'agent';
    },
    (r: FixReport) => {
      first(r.sites).finding.usage.file = 'src/auth/login.ts';
    },
    (r: FixReport) => {
      first(r.sites).finding.usage.file = 'src/billing.ts';
    },
    (r: FixReport) => {
      r.verification.tests = [];
    },
    (r: FixReport) => {
      first(r.behavior).skipped = 'import unavailable';
    },
  ]) {
    const report = ruleOnly();
    change(report);
    expect(migrationRisk(report).level).toBe('Medium');
  }
});
it('computes high risk for unverified sites, manual work, behavior differences and failed verification', () => {
  for (const change of [
    (r: FixReport) => {
      first(r.sites).finding.severity = 'unverified';
    },
    (r: FixReport) => {
      first(r.sites).outcome = 'manual';
    },
    (r: FixReport) => {
      r.verification.passed = false;
    },
    (r: FixReport) => {
      first(r.behavior).differences = [
        { kind: 'acceptance', input: '', before: true, after: false },
      ];
    },
    (r: FixReport) => {
      first(r.behavior).messageChecks = [
        {
          site: 'plain.ts:1',
          path: ['email'],
          input: 'missing',
          status: 'different',
          before: 'required',
          after: 'invalid',
        },
      ];
    },
  ]) {
    const report = ruleOnly();
    change(report);
    expect(migrationRisk(report).level).toBe('High');
    expect(visible(prBody(report))).toContain('Review required before merging.');
  }
});
it("calls a behavior record's site a behavior change, not an unverified site", () => {
  const report = ruleOnly();
  const site = first(report.sites);
  site.finding.severity = 'unverified';
  site.finding.rule = 'zod/mcp-input-schema-additional-properties';
  report.packContext = {
    from: '3.25.76',
    to: '4.6.5',
    includeDeprecated: false,
    recordSites: [
      {
        record: 'zod/mcp-input-schema-additional-properties',
        file: site.finding.usage.file,
        line: site.finding.usage.line,
        snippet: site.finding.usage.snippet,
        kept: true,
      },
    ],
  };
  expect(migrationRisk(report)).toEqual({ level: 'High', reason: 'behavior changes' });
});
it('shows a minimal behavior difference in the actionable review list', () => {
  const report = ruleOnly();
  first(report.behavior).differences = [
    { kind: 'acceptance', input: {}, before: false, after: true },
  ];
  expect(visible(prBody(report))).toContain('minimal example `{}` → before `false`, after `true`');
});
it('groups mixed mechanical and agent sites of the same rule only once', () => {
  const report = ruleOnly();
  first(report.sites).outcome = 'agent';
  expect(prBody(report).match(/^\*\*\d+\./gm)).toHaveLength(1);
});

it('limits coverage notes to multi-field objects and omits redundant missing-test logs', () => {
  const report = fixture('storefront-zod');
  report.behavior = [
    {
      file: 'schemas.ts',
      schema: 'objectCoverage',
      schemaKind: 'object',
      inputs: 200,
      identical: 200,
      validInputs: 1,
      differences: [],
    },
    {
      file: 'schemas.ts',
      schema: 'emailField',
      schemaKind: 'single-field',
      inputs: 200,
      identical: 200,
      validInputs: 1,
      differences: [],
    },
    {
      file: 'schemas.ts',
      schema: 'oneFieldObject',
      schemaKind: 'single-field',
      inputs: 200,
      identical: 200,
      validInputs: 1,
      differences: [],
    },
    {
      file: 'schemas.ts',
      schema: 'enumChoice',
      schemaKind: 'enum',
      inputs: 200,
      identical: 200,
      validInputs: 1,
      differences: [],
    },
    {
      file: 'schemas.ts',
      schema: 'literalChoice',
      schemaKind: 'literal',
      inputs: 200,
      identical: 200,
      validInputs: 1,
      differences: [],
    },
  ];
  // A workspace without tests: its "missing" log would repeat what the table says.
  for (const run of [...report.verification.tests, ...report.verification.baselineTests]) {
    run.status = 'missing';
    run.output = 'no test script';
  }
  const body = prBody(report);
  expect(body.match(/fewer than 20 valid inputs/g)).toHaveLength(1);
  expect(body).toContain('objectCoverage | 200 | 200 | 1 | 0; fewer than 20 valid inputs');
  expect(body).not.toContain('**Tests: packages/api**');
  expect(body).not.toContain('**Tests: packages/shared**');
  expect(body).toContain('| packages/api | missing | missing |');
  report.verification.tests[0] = {
    workspace: 'packages/api',
    status: 'failed',
    output: 'assertion failed',
  };
  expect(prBody(report)).toContain('**Tests: packages/api**');
  expect(prBody(report)).toContain('assertion failed');
});
it('shows the verifier version, tool commit and PR commit separately inside Run details', () => {
  const report = fixture('storefront-zod');
  const body = prBody(report);
  const details = body.split('<details><summary>Run details</summary>')[1];
  expect(details).toContain('Uptide 0.1.0');
  expect(details).toContain(`Uptide commit: \`${report.uptideCommit}\``);
  expect(details).toContain(`Verified commit: \`${report.head}\``);
  expect(visible(body)).not.toContain(report.uptideCommit ?? 'missing');
});
it('keeps the behavior evidence complete, including both webhook schemas and all custom messages', () => {
  const report = fixture('storefront-zod');
  const schemas = (report.behavior ?? []).filter(
    (b) => b.schema !== '(reported site)' && !b.skipped,
  );
  expect(schemas).toHaveLength(9);
  expect(schemas.reduce((n, b) => n + b.inputs, 0)).toBe(1800);
  expect(schemas.reduce((n, b) => n + b.identical, 0)).toBe(1800);
  expect(schemas.every((b) => !b.skipped && b.schemaKind && !b.differences.length)).toBe(true);
  const checks = schemas
    .flatMap((b) => b.messageChecks ?? [])
    .filter((c) => c.status !== 'default');
  expect(checks).toHaveLength(21);
  expect(checks.every((c) => c.status === 'identical')).toBe(true);
  for (const schema of ['paymentWebhookSchema', 'shipmentWebhookSchema']) {
    expect(schemas.find((b) => b.schema === schema)?.identical).toBe(200);
    expect(schemas.find((b) => b.schema === schema)?.loadedModules).toContain(
      'packages/api/src/routes/webhooks.ts',
    );
  }
});

describe('runs are scoped to their own repository', () => {
  const site = (file: string, line: number, over: Partial<FixReport['sites'][number]> = {}) =>
    ({
      outcome: 'agent',
      reason: 'migrated',
      ...over,
      finding: {
        severity: 'breaking',
        confidence: 1,
        fixability: 'assisted',
        reason: 'type incompatible',
        change: {
          package: 'stripe',
          from: '22.5.0',
          to: '22.6.2',
          path: 'Stripe.LatestApiVersion',
          kind: 'type',
          severity: 'breaking',
          source: 'types',
          confidence: 1,
        },
        usage: {
          file,
          line,
          column: 1,
          endLine: line,
          endColumn: 2,
          symbolPath: 'Stripe.LatestApiVersion',
          access: 'write',
          snippet:
            'export const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2026-07-29.dahlia";',
          via: 'direct',
        },
      },
    }) as FixReport['sites'][number];
  const run = (over: Partial<FixReport>): FixReport => ({
    repo: '/work/other',
    package: 'stripe',
    from: '22.5.0',
    target: '22.6.2',
    branch: 'uptide/stripe-22.6.2',
    sites: [],
    verification: {
      baseline: [],
      target: [],
      after: [],
      newErrors: [],
      baselineTests: [],
      tests: [{ workspace: 'packages/api', status: 'passed', output: '' }],
      passed: true,
    },
    llm: { inputTokens: 0, outputTokens: 0, costUsd: 0, available: true },
    timingMs: 1000,
    prBody: '/work/other/.uptide/pr-body.md',
    notes: [],
    ...over,
  });

  it('renders two stripe repositories in one process without one leaking into the other', () => {
    // Repository A: the fixture consumer, which migrated subscription period accesses.
    const a = fixture('stripe');
    // Repository B: only pins the API version; its review material comes from its own rules.
    const context = {
      from: '22.5.0',
      to: '22.6.2',
      includeDeprecated: false,
      apiVersions: { from: '2026-07-29.dahlia', to: '2026-08-26.dahlia' },
      payloadVersions: [
        { file: 'packages/api/src/webhook.test.ts', line: 12, value: '2026-07-29.dahlia' },
      ],
    };
    const rules = ['api-version'];
    const b = run({
      sites: [site('packages/api/src/modules/billing/container.ts', 68, { rule: 'api-version' })],
      reviewSections: stripePack.reviewSections?.(context, rules) ?? [],
      decisions: stripePack.decisions?.(context, rules) ?? [],
    });
    const first = prBody(a);
    const other = prBody(b);
    // B says nothing A's run decided, and names none of A's files.
    for (const foreign of [
      'current_period_end',
      'Subscription billing period',
      'latest-ending item',
      'empty item list',
      'empty items',
      'src/billing.ts',
    ])
      expect(other, foreign).not.toContain(foreign);
    // B's own decision is there, and only there.
    expect(other).toContain('### Decisions for you');
    expect(other).toContain('`api_version` stays `2026-07-29.dahlia` in 1 webhook payload fixture');
    expect(first).not.toContain('webhook.test.ts');
    expect(first).not.toContain('container.ts');
    // Rendering B changed nothing about A: no state survives between runs.
    expect(prBody(a)).toBe(first);
    expect(prBody(b)).toBe(other);
  });

  it('says in the verdict and the summary table when no API change affects the code', () => {
    const body = prBody(
      run({
        sites: [site('packages/api/src/modules/billing/container.ts', 68, { rule: 'api-version' })],
        apiChanges: {
          from: '2026-07-29.dahlia',
          to: '2026-08-26.dahlia',
          total: 12,
          relevant: 0,
          breaking: 0,
        },
        verification: {
          baseline: [],
          target: [{ file: 'a.ts', line: 1, column: 1, code: 2322, message: 'x' }],
          after: [],
          newErrors: [],
          baselineTests: [],
          tests: [{ workspace: 'packages/api', status: 'passed', output: '' }],
          passed: true,
        },
      }),
    );
    expect(body).toContain(
      '**Ready for review.** The code was migrated to stripe 22.6.2 in `api`. Types compile. 0 of 12 API changes matched your code by field name, all additive between 2026-07-29.dahlia and 2026-08-26.dahlia.',
    );
    // Nothing in the body contradicts that: the risk, the rule summary and what is left to check.
    expect(body).toContain(
      '| **Risk** | Medium: billing path; API version bump with additive changes only |',
    );
    expect(body).toContain(
      '| **Changes** | 1 site in 1 file · 0 auto-fixed · 1 fixed by the agent (LLM) |',
    );
    expect(body).toContain(
      "### Worth a look\n\n- Check the webhook endpoint's API version in the Stripe Dashboard before deploying.",
    );
    for (const contradiction of [
      'behavior changes',
      'Runtime behavior was not checked',
      'runtime behavior needs review',
      'needs review',
      'Coordinate the API-version rollout',
    ])
      expect(body, contradiction).not.toContain(contradiction);
    // A breaking or relevant entry keeps the stricter wording.
    const risky = prBody(
      run({
        sites: [site('packages/api/src/modules/billing/container.ts', 68, { rule: 'api-version' })],
        apiChanges: { from: 'a', to: 'b', total: 12, relevant: 2, breaking: 1 },
      }),
    );
    expect(risky).toContain('| **Risk** | High: behavior changes |');
    expect(risky).toContain('Runtime behavior was not checked');
    expect(risky).toContain('Coordinate the API-version rollout');
    expect(body).toContain(
      '| **Behavior** | ✅ 0 of 12 API changes matched your code by field name, all additive |',
    );
    // One error is one error.
    expect(body).toContain('| **Types** | ✅ the upgrade broke 1 · Uptide left 0 |');
    expect(body).toContain('| **Tests** | ✅ 1 workspace passed |');
  });

  it('names widened fixture casts as their own change', () => {
    const body = prBody(
      run({
        package: 'stripe',
        sites: [
          site('src/billing/renewal.test.ts', 7, {
            outcome: 'mechanical',
            rule: 'fixture-cast',
            reason: 'the test already cast this partial fixture to Stripe.Subscription',
          }),
        ],
      }),
    );
    expect(body).toMatch(/^\*\*1\. Test fixture casts widened\*\* · 1 site · auto-fixed$/m);
    expect(body).toContain('the same cast now goes through `unknown`');
  });

  it('adds the workspaces up: one total of tests and files', () => {
    const passed = (workspace: string, summary: string) => ({
      workspace,
      status: 'passed' as const,
      output: '',
      summary,
    });
    const tests = [
      passed('packages/api', '3 tests in 2 files'),
      passed('packages/shared', '2 tests in 1 file'),
    ];
    const body = prBody(
      run({
        verification: {
          baseline: [],
          target: [],
          after: [],
          newErrors: [],
          baselineTests: tests,
          tests,
          passed: true,
        },
      }),
    );
    expect(body).toContain('| **Tests** | ✅ 5 tests in 3 files passed |');
  });

  it('reports what ran: the counts, how the scope was chosen and the command', () => {
    const tests = [
      {
        workspace: '.',
        status: 'passed' as const,
        output: '',
        command: 'vitest related --run --passWithNoTests packages/api/src/container.ts',
        scope: 'vitest tests related to 1 affected file, vitest.config.ts',
        covers: ['packages/api', 'packages/shared'],
        summary: '270 tests in 41 files',
      },
    ];
    const body = prBody(
      run({
        verification: {
          baseline: [],
          target: [],
          after: [],
          newErrors: [],
          baselineTests: tests,
          tests,
          passed: true,
        },
      }),
    );
    expect(body).toContain('| **Tests** | ✅ 270 related tests passed |');
    const rerun = prBody(
      run({
        verification: {
          baseline: [],
          target: [],
          after: [],
          newErrors: [],
          baselineTests: tests,
          tests: [
            {
              ...(tests[0] as (typeof tests)[number]),
              retried: ['src/routes/session.e2e.test.ts'],
            },
          ],
          passed: true,
        },
      }),
    );
    expect(rerun).toContain(
      '| **Tests** | ✅ 270 related tests passed · 1 unrelated test failed once and passed on rerun |',
    );
    expect(rerun).toContain(
      'failed once outside the affected files and passed on rerun: `src/routes/session.e2e.test.ts`',
    );
    expect(body).toContain(
      '- `.`: vitest tests related to 1 affected file, vitest.config.ts, covering `packages/api`, `packages/shared` — `vitest related --run --passWithNoTests packages/api/src/container.ts` — 270 tests in 41 files passed',
    );
    const none = prBody(
      run({
        verification: {
          baseline: [],
          target: [],
          after: [],
          newErrors: [],
          baselineTests: [],
          tests: [
            {
              workspace: 'packages/api',
              status: 'missing',
              output: '',
              scope: 'no test script, and no vitest or jest configuration covers this workspace',
              covers: ['packages/api'],
            },
          ],
          passed: true,
        },
      }),
    );
    expect(none).toContain(
      '| **Tests** | ⚠️ no tests ran: no test script or runner configuration for `api` |',
    );
  });

  it('counts the integration tests that were not run and says how to include them', () => {
    const body = prBody(
      run({
        verification: {
          baseline: [],
          target: [],
          after: [],
          newErrors: [],
          baselineTests: [],
          tests: [
            {
              workspace: '.',
              status: 'passed',
              output: '',
              command: 'vitest related --run --config vitest.uptide-unit.config.mjs src/a.ts',
              scope: 'vitest unit tests related to 1 affected file, vitest.config.ts',
              covers: ['packages/api'],
              summary: '8 tests in 2 files',
              notRun: { files: 61, needs: ['Postgres', 'Redis'] },
            },
          ],
          passed: true,
        },
      }),
    );
    expect(body).toContain(
      '| **Tests** | ✅ 8 related unit tests passed · ⚠️ 61 integration test files not run |',
    );
    expect(body).toContain(
      '- 61 integration test files not run (need Postgres/Redis). Run with `--with-services` to include them.',
    );
    const withServices = prBody(
      run({
        verification: {
          baseline: [],
          target: [],
          after: [],
          newErrors: [],
          baselineTests: [],
          tests: [
            {
              workspace: '.',
              status: 'passed',
              output: '',
              command: 'vitest related --run src/a.ts',
              scope: 'vitest tests related to 1 affected file, vitest.config.ts',
              summary: '191 tests in 13 files',
              services: {
                names: ['Postgres'],
                targets: ['postgresql://***@localhost:5432/app_test'],
              },
            },
          ],
          passed: true,
        },
      }),
    );
    expect(withServices).toContain('| **Tests** | ✅ 191 related tests passed |');
    expect(withServices).toContain(
      'ran against Postgres (postgresql://***@localhost:5432/app_test)',
    );
    expect(withServices).not.toContain('integration test file');
  });

  it('words the changelog count for every case, saying what was checked', () => {
    const facts = { from: 'a', to: 'b', total: 12, relevant: 0, breaking: 0 };
    expect(apiChangeSummary(facts)).toBe(
      '0 of 12 API changes matched your code by field name, all additive',
    );
    expect(apiChangeSummary({ ...facts, breaking: 2 })).toBe(
      '0 of 12 API changes matched your code by field name',
    );
    expect(apiChangeSummary({ ...facts, breaking: 2 }, 1)).toBe(
      "0 of 12 API changes matched your code by field name; 1 breaking change can't be matched this way",
    );
    expect(apiChangeSummary({ ...facts, relevant: 3, breaking: 3 }, 2)).toBe(
      "3 of 12 API changes matched your code by field name; 2 breaking changes can't be matched this way",
    );
    expect(apiChangeSummary({ ...facts, total: 1 })).toBe(
      '0 of 1 API change matched your code by field name, additive',
    );
    expect(apiChangeSummary({ ...facts, total: 0 })).toBe('no API changes');
    expect(apiChangeSummary(facts, 0, 2)).toBe(
      '2 cited behavior sites; 0 of 12 API changes matched by field name',
    );
  });

  it('describes a zod migration from its own files, never from another repository', () => {
    const storefront = prBody(fixture('storefront-zod'));
    const other = prBody(
      run({
        repo: '/work/shop',
        package: 'zod',
        from: '3.25.76',
        target: '4.6.5',
        branch: 'uptide/zod-4.6.5',
        verification: {
          baseline: [],
          target: [],
          after: [],
          newErrors: [],
          baselineTests: [],
          tests: [],
          passed: true,
        },
        sites: [
          site('src/queue/JobConsumer.ts', 9, {
            rule: 'types',
            diff: '- constructor(private schema: ZodType<Job, ZodTypeDef, unknown>) {}\n+ constructor(private schema: ZodType<Job, unknown>) {}',
          }),
        ],
      }),
    );
    expect(other).toContain('`JobConsumer` now types schemas as `ZodType<Job, unknown>`');
    expect(other).toContain('Smoke-test the routes that use the changed schemas before merging.');
    for (const foreign of ['AzureServiceBus', 'TMessage', 'onboarding', 'instances', 'packages/'])
      expect(other, foreign).not.toContain(foreign);
    expect(storefront).not.toContain('JobConsumer');
  });
});

it('names a compiler-only rule by what it expected, keeps e.g. inside a sentence, and tells a pre-existing test failure apart', () => {
  const report = fixture('stripe');
  const site = first(report.sites);
  report.sites = [
    {
      ...site,
      rule: 'TS2322',
      outcome: 'agent',
      finding: {
        ...site.finding,
        change: { ...site.finding.change, path: 'TS2322', kind: 'type' },
        usage: {
          ...site.finding.usage,
          snippet: 'billing_cycle_anchor: "now",',
          compileCode: 2322,
          compileError: "Type 'string' is not assignable to type 'BillingCycleAnchor'.",
        },
      },
      attempts: [
        {
          attempt: 1,
          outcome: 'accepted',
          before: [],
          after: [],
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          explanation:
            'The param changed from a plain string (e.g. "now") to an object. Nothing else moved.',
          diff: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n',
        },
      ],
    },
  ];
  report.verification.tests = [
    { workspace: 'core', status: 'failed', output: '', preexisting: ['src/index.test.ts'] },
  ];
  const body = prBody(report);
  expect(body).toContain(
    '**1. billing_cycle_anchor no longer accepts a string (expects BillingCycleAnchor)**',
  );
  expect(body).toContain('The param changed from a plain string (e.g. "now") to an object.');
  expect(body).toContain(
    '- Tests in `core` were failing before this change (`index.test.ts`); not caused here',
  );
});

it("keeps a PR description under GitHub's limit: what matters first, the rest counted and linked, nothing cut mid-block", () => {
  const report = fixture('stripe');
  const context = {
    from: '14.25.0',
    to: '23.0.0',
    includeDeprecated: false,
    apiVersions: { from: '2023-10-16', to: '2026-09-30.endive' },
    usagePaths: [
      'Stripe.Subscription#current_period_end',
      'Stripe.Checkout.SessionsResource#create',
    ],
    eventTypes: ['customer.subscription.updated'],
    evidence: [
      {
        path: 'Stripe.Subscription#current_period_end',
        kind: 'field' as const,
        file: 'ui/src/webhook.ts',
        line: 44,
      },
    ],
  };
  report.reviewSections = stripePack.reviewSections?.(context, ['subscription-period']);
  report.packContext = context;
  // A long test log, the kind a real suite prints.
  report.verification.tests = [
    {
      workspace: 'ui',
      status: 'passed',
      output: 'ok line\n'.repeat(4000),
      summary: '7 tests in 1 file',
    },
  ];
  const full = migrationBody(report);
  const body = prBody(report);
  expect(full.length).toBeGreaterThan(100_000);
  expect(body.length).toBeLessThanOrEqual(PR_BODY_BUDGET);
  // Kept, in order: the verdict and table, what changed, decisions, the evidenced entry.
  expect(body).toContain('| **Risk** |');
  expect(body).toContain('### What changed');
  expect(body).toContain('### Decisions for you');
  expect(body).toContain('evidence: `ui/src/webhook.ts:44`');
  // Breaking entries no field name can match stay in the open, above the collapsed rest.
  const open = body.slice(0, body.indexOf('Other changes to resources you use (no code evidence)'));
  expect(open).toContain("to resources you use that field names can't match**");
  expect(open).toContain('— breaking;');
  expect(body).toMatch(
    /\[Stripe's changelog\]\(https:\/\/docs\.stripe\.com\/changelog\), 2023-10-16 → 2026-09-30\.endive\./,
  );
  expect(body).toContain('ok line (repeated 4000 times)');
  // A description is read on GitHub: it never points at a file on the author's machine.
  expect(body).not.toMatch(/report\.html|stored run|\.git\//);
  // Decisions once; commands use the installed CLI.
  expect(body.match(/Decisions for you/g)).toHaveLength(1);
  expect(body).not.toMatch(/npx uptide|uptide@next|fix --only/);
  // Nothing is cut inside a block.
  const count = (pattern: RegExp) => (body.match(pattern) ?? []).length;
  expect(count(/<details>/g)).toBe(count(/<\/details>/g));
  expect(count(/^```/gm) % 2).toBe(0);
  // The page has all of it.
  expect(full).toContain('ok line');
  expect(full).not.toContain('more not shown here');
});

describe('a bump that needed no code changes', () => {
  const at = (code: number, message: string) => ({
    file: 'packages/api/src/index.ts',
    line: 1,
    column: 1,
    code,
    message,
  });
  const nodeTypes = [
    ...Array.from({ length: 40 }, () => at(2688, "Cannot find type definition file for 'node'.")),
    ...Array.from({ length: 34 }, () =>
      at(
        2591,
        "Cannot find name 'Buffer'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.",
      ),
    ),
    at(2322, "Type 'string' is not assignable to type 'number'."),
  ];
  const report = (): FixReport => {
    const base = fixture('storefront-zod');
    return {
      ...base,
      package: 'vitest',
      tier: 'generic',
      sites: [],
      // What the generic pack says of agent edits, recorded with the run: there were none.
      notes: [GENERIC_NOTE('vitest')],
      verification: {
        ...base.verification,
        baseline: nodeTypes,
        target: nodeTypes,
        after: nodeTypes,
        newErrors: [],
        passed: true,
      },
    };
  };

  it('says only versions and the lockfile changed, and drops what speaks of edits', () => {
    const body = prBody(report());
    expect(body).toContain('No code changes were needed; only versions and the lockfile changed.');
    expect(body).not.toContain('written by the agent');
    expect(body).not.toContain('### What changed');
    expect(body).toContain('| **Changes** | none: versions and lockfile only |');
    const clean = report();
    clean.verification = { ...clean.verification, baseline: [], target: [], after: [] };
    delete clean.behavior;
    // No pack analyzed vitest 4: a clean type-check and green tests are not Low, and the body
    // says which checks ran and which did not.
    expect(prBody(clean)).toContain(
      '**Review required before merging.** No code changes were needed; only versions and the lockfile changed. Types compile; runtime behavior needs review.',
    );
    expect(prBody(clean)).toContain(
      '| **Verified by** | ⚠️ no migration pack: nothing analyzed what vitest 4.6.5 changes · ✅ type-check · ⚠️ build not run · ✅ tests (2 runs) |',
    );
    expect(migrationRisk(report())).toEqual({
      level: 'Medium',
      reason:
        "no migration pack for vitest: the bump is verified by the repository's own checks only",
    });
  });

  it('counts pre-existing errors by kind in one line, and lists at most ten', () => {
    expect(errorSummary(nodeTypes, 'pre-existing error')).toBe(
      '75 pre-existing errors (74 × TS2688/TS2591 missing Node types, 1 × TS2322)',
    );
    const body = prBody(report());
    expect(body).toContain(
      '**75 pre-existing errors (74 × TS2688/TS2591 missing Node types, 1 × TS2322)**',
    );
    expect(body).toContain('<details><summary>First 10 of 75</summary>');
    expect(body).toContain('- … and 65 more');
    expect(
      body.split('\n').filter((l) => l.startsWith('- packages/api/src/index.ts:1')),
    ).toHaveLength(10);
  });

  it('joins three workspaces with commas and one "and"', () => {
    const base = fixture('storefront-zod');
    const tests = ['apps/web', 'apps/worker', 'packages/api'].map((workspace) => ({
      ...first(base.verification.tests),
      workspace,
      covers: [workspace],
    }));
    const body = prBody({ ...base, verification: { ...base.verification, tests } });
    expect(body).toContain('in `web`, `worker` and `api`.');
  });
});

it('keeps accepted lockfile housekeeping collapsed with counts and exact placements', () => {
  const report = fixture('storefront-zod');
  report.lockfile = {
    manager: 'npm',
    file: 'package-lock.json',
    added: [],
    removed: ['node_modules/parent/node_modules/shared'],
    changed: ['node_modules/stable'],
    allowed: [],
    housekeeping: {
      deduped: [
        {
          from: 'node_modules/parent/node_modules/shared',
          to: 'node_modules/shared',
          name: 'shared',
          version: '1.0.0',
        },
      ],
      metadata: ['node_modules/stable'],
    },
  };
  const body = prBody(report);
  expect(body).toContain(
    '<details><summary>Lockfile housekeeping · 1 dedupe move · 1 metadata-only change</summary>',
  );
  expect(body).toContain('`node_modules/parent/node_modules/shared` → `node_modules/shared`');
  expect(body).toContain('Metadata only: `node_modules/stable`');
  expect(visible(body)).not.toContain('node_modules/');
  expect(migrationBody(report)).toContain('Lockfile housekeeping');
});

it('lists a dependency moved onto the upgrade’s copy as housekeeping (UPT-135)', () => {
  const report = fixture('storefront-zod');
  report.lockfile = {
    manager: 'pnpm',
    file: 'pnpm-lock.yaml',
    added: [],
    removed: ['snapshots:qs@6.12.0'],
    changed: ['snapshots:http-client@2.0.0'],
    allowed: [],
    housekeeping: {
      deduped: [],
      metadata: [],
      onto: [{ name: 'qs', from: '6.12.0', to: '6.16.1' }],
    },
  };
  const body = prBody(report);
  expect(body).toContain(
    "<details><summary>Lockfile housekeeping · 0 dedupe moves · 0 metadata-only changes · 1 move onto the upgrade's copies</summary>",
  );
  expect(body).toContain("- `qs` 6.12.0 → 6.16.1: onto the upgrade's copy.");
});

it('lists each allowed transitive change under the moved package that caused it', () => {
  const report = fixture('storefront-zod');
  report.lockfile = {
    manager: 'yarn-berry',
    file: 'yarn.lock',
    added: [],
    removed: [],
    changed: [],
    allowed: [],
    transitive: [
      {
        name: 'cmdk',
        from: ['0.2.1'],
        to: ['1.0.1'],
        changes: [
          { name: '@radix-ui/primitive', from: '1.0.0', to: '1.1.1' },
          { name: '@radix-ui/react-dialog', from: '1.0.0', to: '1.2.0' },
          { name: 'use-sync-external-store', to: '1.5.0' },
        ],
      },
    ],
  };
  const body = migrationBody(report);
  expect(body).toContain('Moved with the upgraded packages · 3 transitive changes');
  expect(body).toContain(
    '- `cmdk` 0.2.1 → 1.0.1 replaced @radix-ui/primitive 1.0.0 with 1.1.1; replaced @radix-ui/react-dialog 1.0.0 with 1.2.0; added use-sync-external-store 1.5.0.',
  );
});

it('lists npm peer re-resolutions and their pre-existing ranges in the report and PR', () => {
  const report = fixture('storefront-zod');
  report.lockfile = {
    manager: 'npm',
    file: 'package-lock.json',
    added: [],
    removed: [],
    changed: [],
    allowed: [],
    peerReresolved: [
      {
        name: 'plugin',
        from: '1.1.0',
        to: '1.2.0',
        peers: ['zod'],
        ranges: { '. (dependencies)': '^1' },
        records: ['node_modules/plugin'],
      },
    ],
  };
  for (const body of [prBody(report), migrationBody(report)]) {
    expect(body).toContain('Re-resolved because a peer changed');
    expect(body).toContain('`plugin` 1.1.0 → 1.2.0; peers on `zod`');
    expect(body).toContain('. (dependencies): ^1');
  }
});

it('says in the PR body which imported packages the repo does not declare (UPT-109)', () => {
  const report = fixture('storefront-zod');
  report.lockfile = {
    manager: 'npm',
    file: 'package-lock.json',
    added: [],
    removed: [],
    changed: [],
    allowed: [],
    undeclared: [{ name: 'picker-types', version: '1.0.0', kept: true }],
  };
  for (const body of [prBody(report), migrationBody(report)]) {
    expect(body).toContain('### Imported but not declared');
    expect(body).toContain(
      '- picker-types 1.0.0 is imported by the repo but not declared in package.json. The re-resolve would have dropped it; it was kept at 1.0.0. Add it to package.json.',
    );
  }
});

it('says in the PR body when the lockfile resolved another version than the target (UPT-124)', () => {
  const report = fixture('storefront-zod');
  report.lockfile = {
    manager: 'yarn-classic',
    file: 'yarn.lock',
    added: [],
    removed: [],
    changed: [],
    allowed: [],
    resolved: [{ name: 'zod', requested: '4.1.0', version: '4.1.3' }],
  };
  for (const body of [prBody(report), migrationBody(report)]) {
    expect(body).toContain('### Resolved version differs from the target');
    expect(body).toContain(
      '- zod: asked for 4.1.0; the package manager resolved 4.1.3 (same major, inside the manifest range). Verification ran against 4.1.3; the breaking-change analysis used 4.1.0.',
    );
  }
});

it('renders scoped declarative behavior decisions in the PR body', async () => {
  const { nextPack } = await import('../packs/next/index.js');
  const { packDecisions } = await import('../packs/decisions.js');
  const report = fixture('storefront-zod');
  report.package = 'next';
  report.decisions = packDecisions(
    nextPack,
    {
      from: '15.5.5',
      to: '16.0.1',
      includeDeprecated: false,
      inventory: [{ file: 'next.config.mjs', text: 'export default { webpack() {} }' }],
    },
    [],
  );
  const body = prBody(report);
  const section = body.split('### Decisions for you\n')[1]?.split('\n### ')[0];
  expect(section).toContain('`next.config.mjs` has `webpack`');
  expect(section).toContain('keep --webpack or migrate');
  expect(section).toContain('Also review');
  expect(section).not.toContain('image defaults');
  expect(section).not.toContain('cacheComponents');
});
it('says why a required build failed when it stopped before the framework build', () => {
  const report = ruleOnly();
  report.verification.buildRequired = true;
  report.verification.build = [
    {
      workspace: '.',
      status: 'failed',
      script: 'build',
      command: 'prisma generate && prisma db push && next build',
      output: 'error: Environment variable not found: DATABASE_URL.',
      cause: 'needs DATABASE_URL',
    },
  ];
  expect(visible(prBody(report))).toContain(
    '❌ build: error: Environment variable not found: DATABASE_URL. (build needs DATABASE_URL; set verify.build)',
  );
  expect(prBody(report)).toContain(
    'the build needs DATABASE_URL before the framework build started. Set `verify.build` in uptide.yml',
  );
});
it('lists required moves apart from companions, and blockers, next to what stays', () => {
  const report = ruleOnly();
  report.companions = [
    {
      name: 'zod',
      from: '3.24.2',
      to: '3.25.0',
      reason: 'openai 7.4.0 requires zod ^3.25 || ^4.0',
      required: true,
    },
  ];
  report.companionBlockers = [
    '@openai/agents 0.1.11 depends on openai ^5.20.2; only a new major accepts openai 7.9.0 (@openai/agents 0.15.0, which needs zod ^4.0.0; installed 3.25.76)',
  ];
  const body = visible(prBody(report));
  expect(body).not.toContain('Upgraded with');
  expect(body).toContain(
    '- `zod` 3.24.2 → 3.25.0 (moved because openai 7.4.0 requires zod ^3.25 || ^4.0)',
  );
  expect(body).toContain(
    '- @openai/agents 0.1.11 depends on openai ^5.20.2; only a new major accepts openai 7.9.0',
  );
  expect(migrationRisk(report)).toMatchObject({ level: 'High' });
  expect(migrationRisk(report).reason).toContain('a required move is blocked');
});
it('names the packages of the scope that stay where they are', () => {
  const report = ruleOnly();
  report.companionStays = [
    '@sentry/vite-plugin stays at 5.4.0 (not in the release group of @sentry/react)',
  ];
  expect(visible(prBody(report))).toContain(
    '- `@sentry/vite-plugin` stays at 5.4.0 (not in the release group of @sentry/react)',
  );
  delete report.companionStays;
  expect(prBody(report)).not.toContain('Left where they are');
});

it('keeps root pin review first even when the PR body must be shortened', () => {
  const report = largeStripeReport();
  report.rootPins = [
    {
      file: 'package.json',
      path: ['resolutions', 'stripe'],
      name: 'stripe',
      before: '14.25.0',
      after: '22.6.2',
      to: '22.6.2',
    },
  ];
  for (const budget of [undefined, 16_000]) {
    const body = renderMigration(report, 'full', budget);
    expect(body).toMatch(/^## Upgrade[^\n]+\n\n### Root pins changed: review\n/);
    expect(body).toContain('package.json "resolutions" > "stripe": 14.25.0 → 22.6.2');
    expect(body).not.toContain('explicit `--update-pins` consent');
    if (budget !== undefined) expect(body.length).toBeLessThanOrEqual(budget);
  }
});
it('says a companion major without a pack needs its own migration, and marks the risk (UPT-10)', () => {
  const report = ruleOnly();
  report.companions = [
    {
      name: '@headlessui/react',
      from: '1.7.19',
      to: '2.2.0',
      reason: 'explicit peer upgrade accepting react 19.3.0',
      migration: 'own',
    },
  ];
  expect(migrationRisk(report)).toMatchObject({ level: 'High' });
  expect(migrationRisk(report).reason).toContain('a companion major needs its own migration');
  expect(prBody(report)).toContain(
    '### Needs its own migration\n\n- `@headlessui/react` 1.7.19 → 2.2.0 is a major upgrade with no migration pack',
  );
  report.companions = report.companions.map((c) => ({ ...c, migration: 'pack' as const }));
  expect(prBody(report)).not.toContain('Needs its own migration');
});

describe('a run where nothing was migrated (UPT-134)', () => {
  it('says no code changed instead of "migrated", and why the agent did nothing', () => {
    const base = fixture('storefront-zod');
    const report: FixReport = {
      ...base,
      sites: base.sites.map((s) => ({ ...s, outcome: 'manual' as const })),
      llm: { ...base.llm, tasks: [], agentIdle: 'the session failed: Invalid API key' },
    };
    const body = prBody(report);
    expect(body).toContain(
      `No code was changed: all ${report.sites.length} sites need a manual migration.`,
    );
    expect(body).not.toContain('The code was migrated');
    expect(body).toContain(
      '> ⚠️ **The agent did not change anything:** the session failed: Invalid API key.',
    );
    expect(prBody(base)).not.toContain('The agent did not change anything');
  });
});

describe('group titles (UPT-134)', () => {
  const titled = (rule: string, over: Partial<FixReport> = {}, compileCode?: number) => {
    const base = fixture('storefront-zod');
    const site = base.sites[0] as FixReport['sites'][number];
    const report: FixReport = {
      ...base,
      ...over,
      sites: [
        {
          ...site,
          rule,
          outcome: 'manual',
          reason: 'SDK agent made no change',
          finding: {
            ...site.finding,
            rule: undefined,
            change: { ...site.finding.change, path: rule, kind: 'removed' },
            usage: {
              ...site.finding.usage,
              compileCode,
              compileError: compileCode
                ? "Property 'query' does not exist on type 'typeof e'."
                : undefined,
            },
          },
        },
      ],
    };
    return /\*\*1\. (.+?)\*\* · /.exec(prBody(report))?.[1];
  };

  it("titles a rule's sites with the pack's summary of it, not its id", () => {
    expect(
      titled('query-middleware-removed', {
        ruleSummaries: { 'query-middleware-removed': '`express.query()` middleware is removed' },
      }),
    ).toBe('`express.query()` middleware is removed');
    // A report stored before the summaries were recorded keeps the id.
    expect(titled('query-middleware-removed')).toBe('query-middleware-removed');
  });

  it('titles sites no rule covers by what the compiler said, else by what changed', () => {
    expect(titled('e.query', {}, 2339)).toBe('A property no longer exists');
    expect(titled('e.query')).toBe(
      `\`e.query\` was removed in zod ${fixture('storefront-zod').target}`,
    );
  });
});
