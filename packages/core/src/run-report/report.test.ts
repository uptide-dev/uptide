import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CheckReport } from '../domain/report.js';
import type { FixReport } from '../fix/types.js';
import { KEYWORDS } from '../onboarding/validate.js';
import { fromChecked, fromFix, kindOf, sentence, skipped } from './build.js';
import { assertSafeReport, reportProblems } from './safe.js';
import { RUN_REPORT_SCHEMA, RUN_REPORT_SCHEMA_ID, type RunReport } from './schema.js';
import { renderSummary } from './summary.js';

const json = <T>(path: string): T =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
// A real migration run of the synthetic storefront fixture: diffs, snippets, compiler
// messages, test output, the PR body. Everything the report must leave behind.
const storefront = (): FixReport => json<FixReport>('../fix/__fixtures__/storefront-zod.json');
const check = (): CheckReport =>
  json<CheckReport>('../../../cli/src/__fixtures__/storefront-check.json');

const SHA = 'a'.repeat(40);
const run = (upgrades: RunReport['upgrades'], extra: Partial<RunReport> = {}): RunReport => ({
  schema: RUN_REPORT_SCHEMA_ID,
  engineVersion: '0.9.0',
  repo: { id: 123456, owner: 'acme', name: 'storefront' },
  sha: SHA,
  runId: 987654321,
  runAttempt: 1,
  mode: 'fix',
  startedAt: '2026-10-13T06:17:00.000Z',
  finishedAt: '2026-10-13T06:29:41.512Z',
  upgrades,
  ...extra,
});
const PR = { number: 42, url: 'https://github.com/acme/storefront/pull/42' };

describe('uptide.run/v1', () => {
  it('a fix run reports versions, sites, verification counts, the PR and cost', () => {
    const report = run([fromFix(storefront(), { pr: PR, durationMs: 754_000 })]);
    expect(reportProblems(report)).toEqual([]);
    const [upgrade] = report.upgrades;
    expect(upgrade).toMatchObject({
      package: 'zod',
      from: '3.25.76',
      to: '4.6.5',
      kind: 'major',
      status: 'fixed',
      pr: PR,
      durationMs: 754_000,
      verification: { tests: { passed: 2, failed: 0 } },
    });
    expect(upgrade?.breaking.length).toBeGreaterThan(10);
    for (const site of upgrade?.breaking ?? []) {
      expect(Object.keys(site).sort()).toEqual(['change', 'file', 'line', 'symbol']);
      expect(site.file).not.toMatch(/^\//);
    }
  });

  it('carries no source, diff, snippet, message, command, output or environment value', () => {
    const fix = storefront();
    const secret = `sk-ant-api03-${'q'.repeat(30)}`;
    process.env.UPTIDE_TEST_SECRET = secret;
    const report = run([
      fromFix(fix, { pr: PR, durationMs: 1 }),
      ...check().packages.map((p) => fromChecked(p)),
    ]);
    const text = JSON.stringify(report);
    // Every free-text field of the engine's output, collected, must be absent.
    const forbidden = new Set<string>();
    for (const site of fix.sites) {
      if (site.diff) forbidden.add(site.diff);
      const usage = site.finding.usage as { snippet?: string; compileError?: string };
      if (usage.snippet && usage.snippet.length > 12) forbidden.add(usage.snippet);
      if (usage.compileError) forbidden.add(usage.compileError);
      if (site.reason.length > 12) forbidden.add(site.reason);
    }
    for (const d of [...fix.verification.baseline, ...fix.verification.after])
      forbidden.add(d.message);
    for (const t of fix.verification.tests) {
      if (t.output) forbidden.add(t.output);
      if (t.command) forbidden.add(t.command);
    }
    forbidden.add(fix.repo); // the absolute path of the checkout
    for (const value of forbidden) expect(text, value.slice(0, 60)).not.toContain(value);
    // Not even fragments: no code punctuation, no line breaks, no absolute paths, no env value.
    expect(text).not.toMatch(/\\n|=>|import |from '|;\s|\+\+\+|@@ /);
    expect(text).not.toContain(secret);
    expect(text).not.toMatch(/"\/(?:home|tmp|Users|private)\//);
    delete process.env.UPTIDE_TEST_SECRET;
  });

  it('refuses a report that could carry code, by schema and by shape', () => {
    const good = run([fromFix(storefront(), { pr: PR, durationMs: 1 })]);
    const tamper = (change: (r: RunReport & Record<string, unknown>) => void): string[] => {
      const copy = structuredClone(good) as RunReport & Record<string, unknown>;
      change(copy);
      return reportProblems(copy);
    };
    // A field nobody declared, wherever it is.
    expect(
      tamper((r) => {
        r.diff = '-a\n+b';
      }),
    ).toContain(
      'diff is not a setting here (known: schema, engineVersion, repo, sha, runId, runAttempt, mode, startedAt, finishedAt, upgrades, error)',
    );
    expect(
      tamper((r) => {
        (r.upgrades[0] as unknown as Record<string, unknown>).snippet = 'z.string()';
      }),
    ).toEqual(
      expect.arrayContaining([expect.stringContaining('upgrades[0].snippet is not a setting')]),
    );
    expect(
      tamper((r) => {
        (r.upgrades[0]?.breaking[0] as unknown as Record<string, unknown>).code = 'x';
      }),
    ).toEqual(
      expect.arrayContaining([expect.stringContaining('breaking[0].code is not a setting')]),
    );
    // Text where only names and paths fit.
    expect(
      tamper((r) => {
        (r.upgrades[0]?.breaking[0] as { symbol: string }).symbol = 'z.string().min(1)';
      }),
    ).toEqual(['upgrades[0].breaking[0].symbol is not in the expected format']);
    expect(
      tamper((r) => {
        (r.upgrades[0]?.breaking[0] as { file: string }).file = '/home/runner/work/x.ts';
      }),
    ).toEqual(['upgrades[0].breaking[0].file is not in the expected format']);
    expect(
      tamper((r) => {
        (r.upgrades[0]?.breaking[0] as { file: string }).file = '../../etc/passwd';
      }),
    ).toHaveLength(1);
    expect(
      tamper((r) => {
        r.error = 'failed:\nconst a = 1';
      }),
    ).toEqual(['error is not in the expected format']);
    expect(
      tamper((r) => {
        r.error = 'see `z.string()`';
      }),
    ).toEqual(['error is not in the expected format']);
    // Credentials, even where a sentence fits.
    expect(
      tamper((r) => {
        r.error = `key ghs_${'a'.repeat(36)} rejected`;
      }),
    ).toEqual(['error looks like a credential']);
    expect(() => assertSafeReport({ ...good, error: 'Bearer abc' })).toThrow(
      'error looks like a credential',
    );
  });

  it('keeps sentences to one bounded line without backticks', () => {
    expect(sentence('tests failed\nin `packages/api`')).toBe('tests failed in packages/api');
    expect(sentence('x'.repeat(400))).toHaveLength(300);
    expect(sentence('')).toBe('unknown error');
  });

  it('reads the kind of an upgrade from its versions', () => {
    expect(kindOf('3.25.76', '4.6.5')).toBe('major');
    expect(kindOf('4.1.0', '4.6.5')).toBe('minor');
    expect(kindOf('4.6.4', '4.6.5')).toBe('patch');
    expect(kindOf('4.6.5', '4.6.5')).toBe('patch');
    expect(kindOf('workspace:*', '1.0.0')).toBe('major');
    expect(skipped({ package: 'zod', from: '4.6.5' }, 'up_to_date')).toMatchObject({
      from: '4.6.5',
      to: '4.6.5',
    });
  });

  it('names an unverified run, in counts and paths', () => {
    const fix = storefront();
    fix.verification.passed = false;
    fix.verification.newErrors = [fix.verification.baseline[0] ?? ({} as never)];
    (fix.verification.tests[0] as { status: string }).status = 'failed';
    const upgrade = fromFix(fix, { pr: null, durationMs: 1 });
    expect(upgrade.status).toBe('failed');
    expect(upgrade.error).toBe(
      'verification failed: 1 new type error(s), tests failed in packages/api',
    );
  });

  it('renders the job summary from the report alone', () => {
    const summary = renderSummary(run([fromFix(storefront(), { pr: PR, durationMs: 1 })]));
    expect(summary).toContain('## Uptide: fix');
    expect(summary).toContain('| `zod` | 3.25.76 → 4.6.5 (major) | fixed |');
    expect(summary).toContain('[#42](https://github.com/acme/storefront/pull/42)');
    // Sites per package, by path and line only: no symbol, no change kind.
    expect(summary).toContain('### Breaking sites');
    expect(summary).toContain('- `packages/api/src/queue/consumer.ts:19`');
    const section = summary.slice(summary.indexOf('### Breaking sites'));
    expect(section).not.toMatch(/ZodType|TS\d{4}|\(type\)|\(signature\)/);
    expect(section).toMatch(/\*\*`zod`\*\* \(\d+\)/);
  });

  it('omits the breaking-sites section when nothing breaks', () => {
    const upgrade = fromFix(storefront(), { pr: PR, durationMs: 1 });
    const summary = renderSummary(run([{ ...upgrade, breaking: [] }]));
    expect(summary).not.toContain('### Breaking sites');
    expect(summary).not.toContain('<details>');
  });

  it('says not analyzed instead of 0 when no pack stands behind the count', () => {
    const base = skipped({ package: 'next', from: '15.5.4', to: '16.0.1' }, 'available');
    const row = (extra: Partial<RunReport['upgrades'][number]>) =>
      renderSummary(run([{ ...base, ...extra }], { mode: 'check' }))
        .split('\n')
        .find((l) => l.startsWith('| `next`'));
    expect(row({ analysis: 'pack' })).toBe(
      '| `next` | 15.5.4 → 16.0.1 (major) | available | 0 |  |  |  |',
    );
    expect(row({ analysis: 'none' })).toBe(
      '| `next` | 15.5.4 → 16.0.1 (major) | available | not analyzed: no pack yet |  |  |  |',
    );
    expect(row({})).toContain('| available | not analyzed |');
    expect(reportProblems(run([{ ...base, analysis: 'none' }]))).toEqual([]);
    expect(reportProblems(run([{ ...base, analysis: 'maybe' as 'none' }]))).toEqual([
      'upgrades[0].analysis must be one of pack, none',
    ]);
  });

  it('prints no kind when nothing moves, and a companion as moving with its lead', () => {
    const current = skipped({ package: 'zod', from: '4.6.5' }, 'up_to_date');
    const summary = renderSummary(run([current]));
    expect(summary).toContain('| `zod` | 4.6.5 | up to date |  |');
    expect(summary).not.toContain('(patch)');
    const companion = {
      ...skipped({ package: 'react-dom', from: '18.3.1', to: '19.2.0' }, 'available'),
      movesWith: 'react',
    };
    expect(renderSummary(run([companion]))).toContain(
      '| `react-dom` | 18.3.1 → 19.2.0 (major) | moves with `react` | with `react` |',
    );
    expect(reportProblems(run([companion]))).toEqual([]);
    expect(reportProblems(run([{ ...companion, movesWith: 'react dom' }]))).toEqual([
      'upgrades[0].movesWith is not in the expected format',
    ]);
  });
});

describe('the report JSON Schema', () => {
  it('uses only keywords the validator enforces, and closes every object', () => {
    const walk = (node: unknown, inProperties: boolean, at: string): void => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach((n, i) => {
          walk(n, false, `${at}[${i}]`);
        });
        return;
      }
      const record = node as Record<string, unknown>;
      if (!inProperties) {
        for (const key of Object.keys(record)) expect(KEYWORDS.has(key), `${at}.${key}`).toBe(true);
        if (record.type === 'object') expect(record.additionalProperties, at).toBe(false);
      }
      for (const [key, value] of Object.entries(record))
        walk(value, !inProperties && key === 'properties', `${at}.${key}`);
    };
    walk(RUN_REPORT_SCHEMA, false, '$');
  });

  it('bounds every string with a pattern, an enum or a const', () => {
    const walk = (node: unknown, at: string): void => {
      if (!node || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      if (record.type === 'string') expect(typeof record.pattern, at).toBe('string');
      for (const [key, value] of Object.entries(record)) walk(value, `${at}.${key}`);
    };
    walk(RUN_REPORT_SCHEMA, '$');
  });

  it('is published as schema/uptide.run.v1.json, unchanged', () => {
    expect(json('../../../../schema/uptide.run.v1.json')).toEqual(
      JSON.parse(JSON.stringify(RUN_REPORT_SCHEMA)),
    );
  });
});

describe('a package check could not analyze', () => {
  it('is failed, with the engine error code and never its message', () => {
    const pkg = {
      ...check().packages[0],
      workspace: 'packages/api',
      status: 'skipped',
      skipReason: 'ANALYSIS_FAILED',
      findings: [],
      // What the engine says about it, which can hold paths outside the repository.
      reason: "analysis failed: Cannot find module '/home/runner/work/_actions/x/errors.js'",
    } as unknown as CheckReport['packages'][number];
    const upgrade = fromChecked(pkg);
    expect(upgrade).toMatchObject({
      status: 'failed',
      error: 'could not be analyzed in packages/api (ANALYSIS_FAILED); the job log has the reason',
    });
    expect(JSON.stringify(upgrade)).not.toContain('Cannot find module');
    expect(reportProblems(run([upgrade]))).toEqual([]);
  });
});
