import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { baselineHeadline, baselineHealth, baselineHealthOf, fixVerdict } from './baseline.js';
import { renderMigration, summaryCells } from './report.js';
import type { FixDiagnostic, FixReport, TestResult } from './types.js';
import { diagnostics } from './verify.js';

const scratch = mkdtempSync(join(tmpdir(), 'uptide-baseline-tests-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A one-workspace repository on disk, measured the way `fix` measures its baseline. */
function measured(files: Record<string, string>): FixDiagnostic[] {
  const root = realpathSync(mkdtempSync(join(scratch, 'repo-')));
  const all: Record<string, string> = {
    'package.json': '{"name":"app"}',
    'tsconfig.json': JSON.stringify({
      compilerOptions: { strict: true, baseUrl: '.', paths: { '@/*': ['./*'] } },
    }),
    ...files,
  };
  for (const [file, text] of Object.entries(all)) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return diagnostics(root, ['.']);
}

const failing: TestResult = { workspace: '.', status: 'failed', output: '1 failed' };
const passing: TestResult = { workspace: '.', status: 'passed', output: 'ok' };

function run(
  baseline: FixDiagnostic[],
  baselineTests: TestResult[],
  newErrors: FixDiagnostic[],
  passed: boolean,
): FixReport {
  return {
    repo: '/repo',
    package: 'zod',
    from: '3.25.76',
    target: '4.6.7',
    branch: 'uptide/zod-4.6.7',
    sites: [],
    verification: {
      baseline,
      target: [...baseline, ...newErrors],
      after: [...baseline, ...newErrors],
      newErrors,
      baselineTests,
      tests: baselineTests.map((t) => (t.status === 'failed' ? { ...t, preexisting: ['*'] } : t)),
      baselineHealth: baselineHealth(baseline, baselineTests),
      passed,
    },
    llm: { inputTokens: 0, outputTokens: 0, costUsd: 0, available: false },
    timingMs: 1,
    prBody: '/repo/.uptide/pr-body.md',
    notes: [],
  };
}

const introduced: FixDiagnostic = {
  file: 'schema.ts',
  line: 3,
  column: 1,
  code: 2339,
  message: "Property 'errors' does not exist on type 'ZodError'.",
};

describe('healthy baseline', () => {
  const baseline = measured({ 'index.ts': 'export const n: number = 1;\n' });

  it('measures nothing wrong and keeps the strict words', () => {
    const health = baselineHealth(baseline, [passing]);
    expect(health).toEqual({ healthy: true, typeErrors: 0, failingTests: 0, missingModules: [] });
    expect(baselineHeadline(health)).toBeUndefined();
    expect(fixVerdict(run(baseline, [passing], [], true)).text).toBe('verification passed');
  });

  it('a new error still fails, with no pre-existing count to blame', () => {
    const report = run(baseline, [passing], [introduced], false);
    expect(fixVerdict(report)).toEqual({
      text: 'verification failed: 1 type error introduced by the upgrade',
      tone: 'failed',
    });
    expect(renderMigration(report)).not.toContain('does not type-check');
  });
});

describe('unhealthy baseline', () => {
  const baseline = measured({
    'index.ts': 'export const n: number = "one";\nexport const m: string = 2;\n',
  });

  it('counts the errors and the failing tests, and says so first', () => {
    const health = baselineHealth(baseline, [failing]);
    expect(health).toMatchObject({ healthy: false, typeErrors: 2, failingTests: 1 });
    expect(baselineHeadline(health)).toBe(
      'this repository does not type-check before the upgrade (2 errors) and its tests fail before the upgrade (1 run); verification can only compare, not prove',
    );
  });

  it('nothing new is "no new errors", never "verification passed"', () => {
    const report = run(baseline, [failing], [], true);
    expect(fixVerdict(report)).toEqual({ text: 'no new errors', tone: 'compared' });
    const body = renderMigration(report);
    expect(body.split('\n')[2]).toBe(
      '> ⚠️ This repository does not type-check before the upgrade (2 errors) and its tests fail before the upgrade (1 run); verification can only compare, not prove.',
    );
  });

  it('a failure separates what the upgrade introduced from what was there', () => {
    const report = run(baseline, [], [introduced], false);
    expect(fixVerdict(report).text).toBe(
      'verification failed: 1 type error introduced by the upgrade, 2 pre-existing',
    );
    expect(summaryCells(report).types).toBe(
      '❌ the upgrade broke 1 · Uptide left 1 (2 pre-existing, not counted)',
    );
  });

  it('failing tests alone make it unhealthy', () => {
    expect(baselineHeadline(baselineHealth([], [failing]))).toBe(
      'this repository has failing tests before the upgrade (1 run); verification can only compare, not prove',
    );
  });

  it('a stored run without the field is measured from what it kept', () => {
    const report = run(baseline, [], [], true);
    delete report.verification.baselineHealth;
    expect(baselineHealthOf(report).typeErrors).toBe(2);
    expect(fixVerdict(report).text).toBe('no new errors');
  });
});

describe('missing-module baseline', () => {
  // An open-core layout: `@/ee/*` imports whose files are not in the repository, and a
  // package imported without being declared or installed.
  const baseline = measured({
    'pages/a.ts': [
      "import { brand } from '@/ee/branding/brand';",
      "import { logo } from '@/ee/branding/logo';",
      "import { Html } from '@react-email/components';",
      'export const used = [brand, logo, Html];',
    ].join('\n'),
    'pages/b.ts': "import { brand } from '@/ee/branding/brand';\nexport const b = brand;\n",
    'pages/c.ts': "import { flag } from '@/lib/missing';\nexport const c = flag;\n",
  });

  it('groups TS2307 by alias folder and package, biggest first', () => {
    expect(baseline.every((d) => d.code === 2307)).toBe(true);
    expect(baselineHealth(baseline, []).missingModules).toEqual([
      { under: '@/ee/', errors: 3, modules: 2 },
      { under: '@/lib/', errors: 1, modules: 1 },
      { under: '@react-email/components', errors: 1, modules: 1 },
    ]);
  });

  it('names the biggest groups in the headline', () => {
    expect(baselineHeadline(baselineHealth(baseline, []))).toBe(
      'this repository does not type-check before the upgrade (5 errors, 5 from missing modules: 3 under @/ee/, 1 under @/lib/, …); verification can only compare, not prove',
    );
  });
});
