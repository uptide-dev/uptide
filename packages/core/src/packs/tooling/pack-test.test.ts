import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import type { CheckReport, Finding } from '../../domain/report.js';
import { aiPack } from '../ai/index.js';
import type { PackVerification } from '../contract.js';
import { registeredPacks } from '../index.js';
import {
  companionOutcome,
  gateOf,
  minimumProblems,
  overclaims,
  predictedSites,
  type RepoScore,
  testPack,
} from './pack-test.js';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const verification = JSON.parse(
  readFileSync(fileURLToPath(new URL('../ai/verification.json', import.meta.url)), 'utf8'),
) as PackVerification;

it('fails a pack with a companion that has no source, and scores nothing', async () => {
  const pack = { ...aiPack, companions: [{ name: 'ai-sdk-ollama', source: '' }] };
  const report = await testPack({ dir: 'ai', pack, verification }, { root, fixturesOnly: true });
  expect(report.problems).toEqual([
    'companions[0] "ai-sdk-ollama": source must be the https URL of the official migration guide or changelog that says it moves with ai',
  ]);
  expect(report.passed).toBe(false);
});

it('rejects a release group without an official source', async () => {
  const pack = { ...aiPack, releaseGroup: [{ name: 'plugin', source: '' }] };
  const report = await testPack({ dir: 'ai', pack, verification }, { root, fixturesOnly: true });
  expect(report.problems[0]).toContain('releaseGroup[0]');
  expect(report.passed).toBe(false);
});

it('rejects an alternate lead without an official source', async () => {
  const pack = { ...aiPack, alternateLeads: [{ name: 'ai-compat', source: 'http://example.com' }] };
  const report = await testPack({ dir: 'ai', pack, verification }, { root, fixturesOnly: true });
  expect(report.problems[0]).toContain('alternateLeads[0] "ai-compat"');
  expect(report.passed).toBe(false);
});

it('passes every registered pack: each companion it names carries its source', async () => {
  for (const entry of registeredPacks()) {
    const report = await testPack(entry, { root, fixturesOnly: true });
    expect(report.problems, entry.pack.name).toEqual([]);
  }
});

it('scores an anchored finding at its anchor; the call sites listed as evidence are not sites', () => {
  const finding = (file: string, line: number, over: Partial<Finding> = {}): Finding => ({
    change: {
      package: 'ai',
      from: '6.0.0',
      to: '7.0.0',
      path: 'TS2345',
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
      symbolPath: 'TS2345',
      access: 'read',
      via: 'inferred',
      snippet: '',
    },
    severity: 'breaking',
    confidence: 1,
    fixability: 'unknown',
    reason: 'compile error',
    ...over,
  });
  const anchor = finding('packages/lib/hook.ts', 6, {
    change: { ...finding('', 0).change, kind: 'cause', path: 'cause:ref' },
    anchorOnly: true,
    downstream: [
      { file: 'apps/a/src/x.tsx', line: 11, code: 2345, message: 'm' },
      { file: 'apps/b/src/y.tsx', line: 59, code: 2345, message: 'm' },
    ],
  });
  // A pack finding that happens to land on an evidence line is not scored either.
  const onEvidence = finding('apps/a/src/x.tsx', 11, { rule: 'tool-context' });
  const report: CheckReport = {
    repo: '/repo',
    workspaces: ['apps/a', 'apps/b', 'packages/lib'],
    packages: [
      {
        workspace: '*',
        name: 'ai',
        installed: '6.0.0',
        latest: '7.0.0',
        target: '7.0.0',
        majorsBehind: 1,
        findings: [anchor, onEvidence],
        callSitesChecked: 3,
        unanalyzed: [],
        status: 'breaking',
        notes: [],
        timing: { fetchMs: 0, diffMs: 0, usagesMs: 0, compileMs: 0 },
        plan: [
          {
            rule: 'tool-context',
            title: 't',
            severity: 'breaking',
            by: { rule: 0, agent: 2, manual: 0 },
            sites: 2,
            fixes: 2,
            locations: [
              { file: 'apps/a/src/x.tsx', line: 11 },
              { file: 'packages/lib/hook.ts', line: 6 },
            ],
            detail: '',
          },
        ],
      },
    ],
    summary: {
      packagesNeedingAttention: 1,
      breaking: 1,
      deprecated: 0,
      unverified: 0,
      unaffected: 0,
      notImported: 0,
      partiallyAnalyzed: 0,
      autoFixable: 0,
      skippedForTime: 0,
      failed: 0,
    },
  };
  expect(predictedSites(report, aiPack).map((s) => `${s.file}:${s.line} ${s.rule}`)).toEqual([
    'packages/lib/hook.ts:6 tool-context',
  ]);
});

it('counts a required move as moved, and names the blocker that keeps a package behind', () => {
  // batch-ai moved zod with openai; guardrails moved @openai/agents and zod across their majors.
  const own = [
    {
      companions: [
        {
          name: 'zod',
          from: '3.24.2',
          to: '3.25.0',
          reason: 'openai 7.4.0 requires zod ^3.25 || ^4.0',
          required: true as const,
        },
      ],
    },
  ] as unknown as CheckReport['packages'];
  expect(companionOutcome(own, { zod: '4.4.3' })).toEqual({ companions: own[0]?.companions });
  const blocker =
    '@openai/agents 0.1.11 depends on openai ^5.20.2; only a new major accepts openai 7.9.0 (@openai/agents 0.15.0, which needs zod ^4.0.0; installed 3.25.76)';
  const blocked = [{ companionBlockers: [blocker] }] as unknown as CheckReport['packages'];
  expect(companionOutcome(blocked, { '@openai/agents': '0.17.2', zod: '4.5.4' })).toEqual({
    blockers: [blocker],
    leftBehind: [
      `@openai/agents: the upgrade moved it to 0.17.2, check leaves it (blocked: ${blocker})`,
      `zod: the upgrade moved it to 4.5.4, check leaves it (blocked: ${blocker})`,
    ],
  });
});

it('fails a record only when it claims more than the run measures', () => {
  expect(overclaims('verified', 'candidate')).toBe(true);
  // Recorded lower on purpose: the runtime treats the package as generic, and the test passes.
  expect(overclaims('candidate', 'verified')).toBe(false);
  expect(overclaims('verified', 'verified')).toBe(false);
  expect(overclaims('candidate', 'candidate')).toBe(false);
});

it('never finds a fixtures-only run over-claiming, whatever the record says', async () => {
  const report = await testPack(
    { dir: 'ai', pack: aiPack, verification },
    { root, fixturesOnly: true },
  );
  expect(report).toMatchObject({ recorded: 'verified', status: 'candidate', overclaimed: false });
});

it('gates on real sites only: a fixture repository scores, never counts, and never exercises a rule', () => {
  const pack = {
    rules: [
      {
        id: 'rename',
        summary: '',
        severity: 'breaking' as const,
        rewrite: () => ({ applied: false as const, reason: '' }),
      },
      {
        id: 'json',
        summary: '',
        severity: 'breaking' as const,
        rewrite: () => ({ applied: false as const, reason: '' }),
      },
      { id: 'look', summary: '', severity: 'breaking' as const },
    ],
    behavior: [],
    meta: {},
  } as unknown as Parameters<typeof gateOf>[0];
  const site = (file: string, rule: string) => ({
    file,
    line: 1,
    rule,
    severity: 'breaking' as const,
  });
  const repo = (
    label: string,
    sites: ReturnType<typeof site>[],
    over: Partial<RepoScore> = {},
  ): RepoScore => ({
    label,
    from: '1.0.0',
    to: '2.0.0',
    predicted: sites,
    expected: sites,
    falsePositives: [],
    falseNegatives: [],
    wrongRule: [],
    ...over,
  });
  const real = (i: number) =>
    repo(`o/r${i}`, [site('a.ts', 'rename'), site('b.ts', 'look')], { repo: `o/r${i}` });
  const truth = {
    package: 'x',
    repos: [0, 1].map((i) => ({
      repo: `o/r${i}`,
      commit: 'c',
      from: '1.0.0',
      to: '2.0.0',
      why: '',
      findings: [],
    })),
  };
  const fixture = repo('fixture', [site('c.ts', 'json'), site('d.ts', 'json')], {
    fixture: 'fixtures/repos/x',
  });

  const gate = gateOf(pack, truth, [real(0), real(1), fixture]);
  expect(gate.breakingSites).toBe(4);
  expect(gate.unexercised).toEqual(['json']);
  expect(gate.reasons).toEqual(['4 breaking sites in public ground truth, verified needs 5']);

  const third = repo('o/r2', [site('e.ts', 'rename')], { repo: 'o/r2' });
  expect(gateOf(pack, truth, [real(0), real(1), third, fixture]).status).toBe('verified');
  // A repository that could not be scored is no evidence.
  const broken = { ...third, error: 'clone failed' };
  expect(gateOf(pack, truth, [real(0), real(1), broken]).breakingSites).toBe(4);
});

it('takes a lower breaking-site minimum only with its reason written in RESEARCH.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uptide-minimum-'));
  const needs = [
    'meta.minBreakingSites needs its reason under "## Breaking-site minimum" in RESEARCH.md',
  ];
  expect(minimumProblems(undefined, dir)).toEqual([]);
  expect(minimumProblems(3, dir)).toEqual(needs);
  writeFileSync(
    join(dir, 'RESEARCH.md'),
    '# x\n\n## Breaking-site minimum\n\n## Sources\n\nguide\n',
  );
  expect(minimumProblems(3, dir)).toEqual(needs);
  writeFileSync(
    join(dir, 'RESEARCH.md'),
    '# x\n\n## Breaking-site minimum\n\nThe 2.0 guide lists three breaking changes.\n\n## Sources\n',
  );
  expect(minimumProblems(3, dir)).toEqual([]);
  expect(minimumProblems(0, dir)[0]).toContain('at least 1');
});
