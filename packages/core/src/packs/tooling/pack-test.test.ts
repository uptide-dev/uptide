import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  formatRecord,
  gateOf,
  minimumProblems,
  overclaims,
  predictedSites,
  type RepoScore,
  testPack,
} from './pack-test.js';
import { cachedRepoDir } from './truth.js';

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
  // Evidence the ground truth names is covered by the anchor, at the truth's rule and severity;
  // evidence it does not name (x.tsx:11) stays unscored.
  const expected = [
    { file: 'apps/b/src/y.tsx', line: 59, rule: 'generic', severity: 'breaking' as const },
  ];
  expect(predictedSites(report, aiPack, expected)).toEqual([
    { file: 'apps/b/src/y.tsx', line: 59, rule: 'generic', severity: 'breaking' },
    { file: 'packages/lib/hook.ts', line: 6, rule: 'tool-context', severity: 'breaking' },
  ]);
});

it('counts a required move as moved, and a move check reports only a new major makes as explained', () => {
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
  // A move check reports and does not make, only a new major away, is explained.
  const stay =
    '@openai/agents 0.1.11 keeps its own openai ^5.20.2; only a new major accepts openai 7.9.0 (@openai/agents 0.15.0, which needs zod ^4.0.0; installed 3.25.76)';
  const stayed = [{ companionStays: [stay] }] as unknown as CheckReport['packages'];
  expect(companionOutcome(stayed, { '@openai/agents': '0.17.2', zod: '4.5.4' })).toEqual({
    stays: [stay],
    explained: [
      `@openai/agents: the upgrade moved it to 0.17.2, check leaves it (${stay})`,
      `zod: the upgrade moved it to 4.5.4, check leaves it (${stay})`,
    ],
  });
  const blocker =
    'openai 7.9.0 needs zod ^4.0.0; installed 3.25.76, and only a new major satisfies it (zod 4.0.0)';
  const blocked = [{ companionBlockers: [blocker] }] as unknown as CheckReport['packages'];
  expect(companionOutcome(blocked, { zod: '4.5.4' })).toEqual({
    blockers: [blocker],
    explained: [`zod: the upgrade moved it to 4.5.4, check leaves it (blocked: ${blocker})`],
  });
  // A stub the upgrade bumped and check removes is reported, and explained (UPT-62).
  const removal = {
    name: '@types/ioredis',
    from: '4.28.10',
    reason: 'ioredis 5 ships its own types',
  };
  const removed = [{ companionRemovals: [removal] }] as unknown as CheckReport['packages'];
  expect(companionOutcome(removed, { '@types/ioredis': '5.0.0' })).toEqual({
    removals: [removal],
    explained: [
      '@types/ioredis: the upgrade moved it to 5.0.0, check removes it (ioredis 5 ships its own types)',
    ],
  });
  // netlify/cli: http-proxy-middleware 2 peers on @types/express ^4, which moves to 5 with
  // express; check reports the conflict and never moves it across its major.
  const conflict = 'http-proxy-middleware 2.0.9 declares @types/express ^4.17.13';
  const peers = [{ peerConflicts: [conflict] }] as unknown as CheckReport['packages'];
  expect(companionOutcome(peers, { 'http-proxy-middleware': '3.0.5' })).toEqual({
    explained: [
      `http-proxy-middleware: the upgrade moved it to 3.0.5, check leaves it (peer conflict: ${conflict})`,
    ],
  });
  // A stay that names no new major explains nothing: the release group left it on purpose.
  const group = [
    { companionStays: ['@sentry/vite-plugin stays at 5.4.0 (versioned on its own)'] },
  ] as unknown as CheckReport['packages'];
  expect(companionOutcome(group, { '@sentry/vite-plugin': '6.0.0' }).leftBehind).toEqual([
    '@sentry/vite-plugin: the upgrade moved it to 6.0.0, check leaves it',
  ]);
});

it("reports a move of a package that does not depend on the lead as the repository's choice (openhab-cloud)", () => {
  // openhab/openhab-cloud moved body-parser and serve-static to 2.x with express 5; neither
  // depends on express. @types/express does not either, but check moves it.
  const own = [
    {
      companions: [
        { name: '@types/express', from: '4.17.21', to: '5.0.6', reason: 'release group' },
      ],
    },
  ] as unknown as CheckReport['packages'];
  const dependsOnExpress = (name: string) => name === 'http-proxy-middleware';
  expect(
    companionOutcome(
      own,
      { '@types/express': '5.0.6', 'body-parser': '2.2.2', 'serve-static': '2.2.1' },
      dependsOnExpress,
    ),
  ).toEqual({
    companions: own[0]?.companions,
    repoChoice: [
      "body-parser: the upgrade moved it to 2.2.2, the repository's choice (it does not depend on the package)",
      "serve-static: the upgrade moved it to 2.2.1, the repository's choice (it does not depend on the package)",
    ],
  });
  // One that does depend on it, left behind with no reason, still fails.
  expect(
    companionOutcome(
      [] as CheckReport['packages'],
      { 'http-proxy-middleware': '3.0.5' },
      dependsOnExpress,
    ).leftBehind,
  ).toEqual(['http-proxy-middleware: the upgrade moved it to 3.0.5, check leaves it']);
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

it('writes a record as the formatter would: a short list inline, a long one a line per item', () => {
  for (const entry of registeredPacks()) {
    const file = join(root, 'packages/core/src/packs', entry.dir, 'verification.json');
    expect(`${formatRecord(entry.verification)}\n`, entry.dir).toBe(readFileSync(file, 'utf8'));
  }
});

it('fails a repository whose generated code is missing, unless the ground truth says why (UPT-95)', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'uptide-generated-'));
  const cacheDir = join(tmp, 'cache');
  const repo = { repo: 'example/prisma-app', commit: 'c'.repeat(40) };
  const truth = (withoutGenerated?: string) => {
    mkdirSync(join(tmp, 'packages/core/src/packs/demo'), { recursive: true });
    writeFileSync(
      join(tmp, 'packages/core/src/packs/demo/ground-truth.json'),
      JSON.stringify({
        package: 'demo',
        repos: [
          { ...repo, from: '1.0.0', to: '2.0.0', why: 'synthetic', findings: [], withoutGenerated },
        ],
      }),
    );
  };
  // Installed and cached; its Prisma generator fails the way a missing engine does.
  const dir = cachedRepoDir(repo, cacheDir);
  mkdirSync(join(dir, 'prisma'), { recursive: true });
  mkdirSync(join(dir, 'node_modules/.bin'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"name":"app"}');
  writeFileSync(join(dir, 'prisma/schema.prisma'), 'generator client { provider = "x" }');
  const bin = join(dir, 'node_modules/.bin/prisma');
  writeFileSync(
    bin,
    '#!/bin/sh\necho "Error: request to http://127.0.0.1:9/ failed" >&2\nexit 1\n',
  );
  chmodSync(bin, 0o755);
  writeFileSync(
    join(dir, '.uptide-ground-truth.json'),
    JSON.stringify({ ...repo, installed: ['.'] }),
  );
  const pack = {
    ...aiPack,
    name: 'demo',
    rules: [],
    behavior: [],
    companions: undefined,
    releaseGroup: undefined,
    meta: { ...aiPack.meta, minBreakingSites: undefined },
  };
  const run = () =>
    testPack({ dir: 'demo', pack, verification }, { root: tmp, cacheDir, offline: true });

  truth();
  const incomplete = await run();
  expect(incomplete.repos[0]?.error).toMatch(
    /^incomplete, generated code missing: generator failed: prisma generate/,
  );
  expect(incomplete.gate.reasons).toContain('example/prisma-app@cccccccccccc could not be scored');
  expect(incomplete.passed).toBe(false);

  truth('its prisma.config.ts needs a live DATABASE_URL');
  const declared = await run();
  expect(declared.repos[0]?.error ?? '').not.toMatch(/^incomplete/);
  expect(declared.repos[0]?.generatorFailed?.[0]).toMatch(
    /; scored without it: its prisma.config.ts needs a live DATABASE_URL$/,
  );
});
