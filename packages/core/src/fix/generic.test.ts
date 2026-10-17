import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ts } from 'ts-morph';
import { afterAll, describe, expect, it } from 'vitest';
import { printCompilerNode } from '../adapters/typescript/serialize.js';
import type { CheckReport, Finding } from '../domain/report.js';
import { genericPack } from '../packs/generic.js';
import { onReset } from '../shared-state.js';
import { git } from './process.js';
import { publicationBlockers } from './publish.js';
import { prBody } from './report.js';
import { type FixServices, fix, publishVerified } from './run.js';
import type { FixRequest } from './types.js';
import { diagnostics, testWorkspaces } from './verify.js';

const scratch = mkdtempSync(join(tmpdir(), 'uptide-generic-fix-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const V1 = 'export declare function fill(color: string): void;\n';
const V2 = 'export declare function fill(color: { name: string }): void;\n';

/** A committed repository on `paint` 1 (no pack exists for it) with `sites` calls that 2.0 breaks. */
function paintFixture(sites = 1) {
  const root = mkdtempSync(join(scratch, 'repo-'));
  mkdirSync(join(root, 'node_modules/paint'), { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'consumer', type: 'module', dependencies: { paint: '1.0.0' } }),
  );
  writeFileSync(
    join(root, 'pnpm-lock.yaml'),
    "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      paint:\n        specifier: 1.0.0\n        version: 1.0.0\n",
  );
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        skipLibCheck: true,
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
      },
      include: ['*.ts'],
    }),
  );
  writeFileSync(
    join(root, 'node_modules/paint/package.json'),
    JSON.stringify({ name: 'paint', version: '1.0.0', types: 'index.d.ts' }),
  );
  writeFileSync(join(root, 'node_modules/paint/index.d.ts'), V1);
  const files = Array.from({ length: sites }, (_, i) => `wall${i + 1}.ts`);
  for (const file of files)
    writeFileSync(join(root, file), "import { fill } from 'paint';\nfill('red');\n");
  writeFileSync(join(root, '.gitignore'), 'node_modules\n');
  git(root, 'init');
  git(root, 'config', 'user.email', 'test@example.test');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'baseline');
  const finding = (file: string, severity: Finding['severity'] = 'breaking'): Finding => ({
    change: {
      package: 'paint',
      from: '1.0.0',
      to: '2.0.0',
      path: 'fill',
      kind: 'signature',
      severity: 'breaking',
      confidence: 1,
      source: 'types',
      before: '(color: string) => void',
      after: '(color: { name: string }) => void',
    },
    usage: {
      file,
      line: 2,
      column: 6,
      endLine: 2,
      endColumn: 11,
      symbolPath: 'fill',
      access: 'call',
      snippet: "fill('red');",
      via: 'direct',
      compileCode: 2345,
      compileError:
        "Argument of type 'string' is not assignable to parameter of type '{ name: string; }'.",
    },
    severity,
    confidence: 1,
    fixability: 'assisted',
    reason: 'signature changed',
    ...(severity === 'breaking' ? { evidence: 'compiler' as const } : {}),
  });
  const report: CheckReport = {
    repo: root,
    workspaces: ['.'],
    summary: {
      packagesNeedingAttention: 1,
      breaking: sites,
      deprecated: 0,
      unverified: 0,
      unaffected: 0,
      notImported: 0,
      partiallyAnalyzed: 0,
      autoFixable: 0,
      skippedForTime: 0,
      failed: 0,
    },
    packages: [
      {
        name: 'paint',
        workspace: '.',
        tier: 'generic',
        installed: '1.0.0',
        latest: '2.0.0',
        target: '2.0.0',
        majorsBehind: 1,
        findings: files.map((file) => finding(file)),
        callSitesChecked: sites,
        status: 'breaking',
        unanalyzed: [],
        notes: [],
        timing: { fetchMs: 0, diffMs: 0, usagesMs: 0, compileMs: 0 },
      },
    ],
  };
  const services: FixServices = {
    check: async () => report,
    diagnostics,
    tests: testWorkspaces,
    resolve: async () => '2.0.0',
    install: async (dir) => {
      writeFileSync(join(dir, 'node_modules/paint/index.d.ts'), V2);
      const file = join(dir, 'node_modules/paint/package.json');
      writeFileSync(
        file,
        JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), version: '2.0.0' }),
      );
      writeFileSync(
        join(dir, 'pnpm-lock.yaml'),
        readFileSync(join(dir, 'pnpm-lock.yaml'), 'utf8').replaceAll('1.0.0', '2.0.0'),
      );
    },
  };
  /** An agent that knows the answer and charges `costUsd` per call. */
  const fixer = (costUsd: number, seen: FixRequest[] = []) => ({
    id: 'test-model',
    estimate: () => costUsd,
    fix: async (request: FixRequest) => {
      seen.push(request);
      const file = request.finding.usage.file;
      return {
        diff: `--- a/${file}\n+++ b/${file}\n@@ -2 +2 @@\n-fill('red');\n+fill({ name: 'red' });\n`,
        explanation: 'fill takes an object with the color name in 2.0',
        inputTokens: 100,
        outputTokens: 20,
        costUsd,
      };
    },
  });
  return { root, services, report, fixer, finding };
}

describe('fix for a dependency without a pack', () => {
  it('migrates through the agent, verifies with the compiler, and says there is no pack', async () => {
    const { root, services, fixer } = paintFixture();
    const seen: FixRequest[] = [];
    const result = await fix({ cwd: root, only: 'paint', fixer: fixer(0.01, seen) }, services);
    expect(result.tier).toBe('generic');
    expect(result.verification.passed).toBe(true);
    expect(result.sites.map((s) => s.outcome)).toEqual(['agent']);
    expect(readFileSync(join(root, 'wall1.ts'), 'utf8')).toContain("fill({ name: 'red' });");
    expect(git(root, 'branch', '--show-current')).toBe('uptide/paint-2.0.0');
    // The guide is made of what the check found, and forbids hiding the error.
    expect(seen[0]?.guide).toContain('Migrate this call site of paint from 1.0.0 to 2.0.0');
    expect(seen[0]?.guide).toContain('After: (color: { name: string }) => void');
    expect(seen[0]?.guide).toContain('Never cast, never suppress a diagnostic');
    // What check learned about the target travels with the finding into the guide.
    expect(
      genericPack('paint').guide({
        ...(seen[0]?.finding as Finding),
        details: ['paint 2.0.0 exports: fill, stroke'],
      }),
    ).toContain('paint 2.0.0 exports: fill, stroke');
    const body = prBody(result);
    expect(body).toContain(
      '> No migration pack covers `paint`. Every edit here was written by the agent and kept only because the compiler error at that site went away and no new one appeared: review each change carefully.',
    );
    expect(body).toContain(
      '| **Risk** | Medium: no migration pack for paint: agent edits verified by the compiler only |',
    );
    expect(body).not.toMatch(/billing|webhook|Stripe/);
    expect(body).toContain(
      'Tier: generic (no migration pack: nothing analyzed the upgrade; only the checks under Verified by vouch for it)',
    );
  }, 20000);

  it('discards shared TypeScript state after an attempt fails inside it, then retries the site', async () => {
    let resets = 0;
    onReset(() => {
      resets++;
    });
    const { root, services, fixer } = paintFixture();
    const answer = fixer(0.01);
    // The first attempt fails inside TypeScript's printer, as a stack overflow does.
    const f = ts.factory;
    const boom = f.createIdentifier('Boom');
    Object.defineProperty(boom, 'escapedText', {
      get() {
        throw new RangeError('Maximum call stack size exceeded');
      },
    });
    let calls = 0;
    const flaky = {
      ...answer,
      fix: async (request: FixRequest) => {
        if (++calls === 1)
          printCompilerNode(
            f.createTypeReferenceNode('Partial', [f.createTypeReferenceNode(boom)]),
          );
        return answer.fix(request);
      },
    };
    const before = resets;
    const result = await fix({ cwd: root, only: 'paint', fixer: flaky }, services);
    expect(resets).toBe(before + 1);
    expect(calls).toBe(2);
    expect(result.sites.map((s) => s.outcome)).toEqual(['agent']);
    expect(result.verification.passed).toBe(true);
  }, 20000);

  it('refuses plainly without an agent, before anything changes', async () => {
    for (const [fixerOption, why] of [
      [null, 'assisted fixes are off (--no-llm)'],
      [
        undefined,
        'no selected-provider API key is set; accepted environment variables: ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY',
      ],
    ] as const) {
      const { root, services } = paintFixture();
      const names = [
        'ANTHROPIC_API_KEY',
        'OPENAI_API_KEY',
        'GEMINI_API_KEY',
        'UPTIDE_PROVIDER',
        'UPTIDE_MODEL',
      ];
      const saved = names.map((name) => [name, process.env[name]] as const);
      for (const name of names) delete process.env[name];
      try {
        await expect(
          fix(
            { cwd: root, only: 'paint', ...(fixerOption === null ? { fixer: null } : {}) },
            services,
          ),
        ).rejects.toMatchObject({
          code: 'NO_FIXER',
          message: `paint has no migration pack, so every fix would come from the agent, and ${why}`,
        });
      } finally {
        for (const [name, value] of saved) {
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
        }
      }
      expect(git(root, 'branch', '--show-current')).not.toContain('uptide/');
      expect(git(root, 'status', '--porcelain')).toBe('');
    }
  });

  it('stops at --max-cost, keeps what was verified, and says what was not attempted', async () => {
    const { root, services, fixer } = paintFixture(3);
    const seen: FixRequest[] = [];
    const result = await fix(
      { cwd: root, only: 'paint', fixer: fixer(0.6, seen), maxCostUsd: 1 },
      services,
    );
    // $0.60 per site: only one call fits under the strict $1 ceiling.
    expect(seen).toHaveLength(1);
    expect(result.sites.map((s) => s.outcome).sort()).toEqual(['agent', 'manual', 'manual']);
    expect(result.llm.costLimit).toEqual({ limitUsd: 1, notAttempted: 2 });
    expect(result.sites.find((s) => s.outcome === 'manual')?.reason).toContain(
      'stopped before calling: next call needs $0.600000, remaining $0.400000',
    );
    // One site still fails to compile: the run is not verified, so nothing could be published.
    expect(result.verification.passed).toBe(false);
    // The estimate was made before the first call, for the three sites left to the agent.
    expect(result.llm.estimate).toEqual({
      sites: 3,
      usd: 0.18,
      limitUsd: 1,
      setting: '--max-cost',
    });
    expect(prBody(result)).toContain(
      '- The agent stopped at the $1.00 cost limit (estimated $0.18 for 3 sites; limit $1.00): 2 sites not completed. Run again with `--max-cost 2.00` to continue.',
    );
    // Wall time per phase, in order, and the agent's spend where it was made.
    expect(result.phases?.map((p) => p.name)).toEqual([
      'analyze',
      'baseline',
      'install',
      'rules',
      'agent',
      'verify',
      'feedback',
    ]);
    expect(result.phases?.find((p) => p.name === 'agent')?.costUsd).toBe(0.6);
    const total = (result.phases ?? []).reduce((ms, p) => ms + p.ms, 0);
    expect(total).toBeLessThanOrEqual(result.timingMs);
    expect(prBody(result)).toMatch(/Phases: analyze \d+s · baseline \d+s · .* agent \d+s \$0\.60/);
  }, 30000);

  it('without --max-cost, keeps the $1 limit and shows the estimate before the first call', async () => {
    const { root, services, fixer } = paintFixture(3);
    const events: string[] = [];
    const seen: FixRequest[] = [];
    const result = await fix(
      {
        cwd: root,
        only: 'paint',
        fixer: fixer(0.01, seen),
        onProgress: (e) => {
          if (e.warning && e.detail) events.push(e.detail);
          if (e.phase === 'assist' && e.state === 'start' && e.detail) events.push('call');
        },
      },
      services,
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(result.llm.estimate).toEqual({
      sites: 3,
      usd: 0.18,
      limitUsd: 1,
      setting: '--max-cost',
    });
    expect(result.llm.feedback?.maxCostUsd).toBe(1);
    const shown = events.indexOf('Agent estimated $0.18 for 3 sites; limit $1.00 (--max-cost)');
    expect(shown).toBeGreaterThanOrEqual(0);
    expect(shown).toBeLessThan(events.indexOf('call'));
  }, 30000);

  it('stops before any agent call when the estimate exceeds the limit', async () => {
    for (const [costSetting, raise] of [
      [undefined, 'Run again with --max-cost 0.18.'],
      ['maxCost', 'Raise maxCost in uptide.yml to 0.18.'],
    ] as const) {
      const { root, services, fixer } = paintFixture(3);
      const seen: FixRequest[] = [];
      await expect(
        fix(
          {
            cwd: root,
            only: 'paint',
            fixer: fixer(0.01, seen),
            maxCostUsd: 0.1,
            ...(costSetting ? { costSetting } : {}),
          },
          services,
        ),
      ).rejects.toMatchObject({
        code: 'COST_ESTIMATE',
        message: `estimated $0.18 for 3 sites; limit $0.10. ${raise}`,
      });
      // Nothing was spent: no call reached the agent.
      expect(seen).toHaveLength(0);
    }
  }, 30000);

  it('repairs an unconfirmed site when final verification proves a new type error', async () => {
    const { root, services, fixer, report, finding } = paintFixture();
    (report.packages[0] as (typeof report.packages)[number]).findings = [
      finding('wall1.ts', 'unverified'),
    ];
    const seen: FixRequest[] = [];
    const result = await fix({ cwd: root, only: 'paint', fixer: fixer(0.01, seen) }, services);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.compilerError).toContain('TS2345');
    expect(result.sites).toEqual([]);
    expect(result.verification.passed).toBe(true);
    expect(result.llm.tasks?.[0]?.gate).toBe('accepted');
  }, 20000);
});

describe('fix never publishes an upgrade nothing analyzed', () => {
  /**
   * uptide-test/saas-starter-kit PR #3: next 15.5.14 → 16.4.0, no pack, and the type-check
   * clean, so it opened as if verified while Next 16 breaks the build configuration. Here:
   * paint 1 → 2, no pack, no site the compiler rejects.
   */
  const CLEAN_TOOL = { uptideVersion: '0.0.0', uptideCommit: 'a'.repeat(40), uptideDirty: false };
  function cleanMajor() {
    const fixture = paintFixture(0);
    const lead = fixture.report.packages[0] as CheckReport['packages'][number];
    lead.status = 'safe';
    const published: string[] = [];
    fixture.services.publish = async (result) => void published.push(result.branch);
    return { ...fixture, published };
  }

  it('refuses a major upgrade without a pack under --pr before anything changes', async () => {
    const { root, services, fixer, published } = cleanMajor();
    const head = git(root, 'rev-parse', 'HEAD');
    await expect(
      fix(
        { cwd: root, only: 'paint', tool: CLEAN_TOOL, fixer: fixer(0.01), pr: true, yes: true },
        services,
      ),
    ).rejects.toMatchObject({
      code: 'PUBLICATION_REFUSED',
      message: expect.stringMatching(/^no pack yet: paint 1\.0\.0 → 2\.0\.0 is a major upgrade/),
    });
    expect(published).toEqual([]);
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(root, 'branch', '--show-current')).not.toContain('uptide/');
  });

  it('keeps a clean type-check of a major upgrade without a pack from ever being published', async () => {
    const { root, services, fixer } = cleanMajor();
    const result = await fix(
      { cwd: root, only: 'paint', tool: CLEAN_TOOL, fixer: fixer(0.01) },
      services,
    );
    // Everything that ran passed: the type-check is clean.
    expect(result.tier).toBe('generic');
    expect(result.verification.newErrors).toEqual([]);
    expect(result.verification.passed).toBe(true);
    // And still no PR: `uptide pr` and the Action ask the same gate.
    expect(publicationBlockers(result, { uptideDirty: false })).toEqual([
      'no pack yet: paint 1.0.0 → 2.0.0 is a major upgrade, and Uptide opens one only with a verified migration pack',
    ]);
    await publishVerified(result, { tool: { uptideDirty: false }, yes: true });
    expect(result.prUrl).toBeUndefined();
    expect(result.publication?.refused[0]).toMatch(/^no pack yet/);
    const body = prBody(result);
    expect(body).toContain('**Review required before merging.**');
    expect(body).toContain(
      '| **Verified by** | ⚠️ no migration pack: nothing analyzed what paint 2.0.0 changes · ✅ type-check · ⚠️ build not run: no build script · ⚠️ tests not run: none ran |',
    );
  }, 20000);

  /** paint 1.0.0 → 1.1.0 without a pack: a minor, with the build and tests given here. */
  function cleanMinor(build: FixServices['build'], tests?: FixServices['tests']) {
    const fixture = paintFixture(0);
    const lead = fixture.report.packages[0] as CheckReport['packages'][number];
    Object.assign(lead, { status: 'safe', latest: '1.1.0', target: '1.1.0', majorsBehind: 0 });
    fixture.services.resolve = async () => '1.1.0';
    fixture.services.install = async (dir) => {
      const file = join(dir, 'node_modules/paint/package.json');
      writeFileSync(
        file,
        JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), version: '1.1.0' }),
      );
      writeFileSync(
        join(dir, 'pnpm-lock.yaml'),
        readFileSync(join(dir, 'pnpm-lock.yaml'), 'utf8').replaceAll('1.0.0', '1.1.0'),
      );
    };
    if (build) fixture.services.build = build;
    if (tests) fixture.services.tests = tests;
    return fixture;
  }
  const passingTests: FixServices['tests'] = async () => [
    { workspace: '.', status: 'passed', output: '', command: 'vitest run' },
  ];

  it('publishes a minor upgrade without a pack only when its build and tests pass', async () => {
    const built: string[][] = [];
    const { root, services, fixer } = cleanMinor(async (_root, workspaces) => {
      built.push(workspaces);
      return [{ workspace: '.', status: 'passed', command: 'next build', output: '' }];
    }, passingTests);
    const result = await fix(
      { cwd: root, only: 'paint', tool: CLEAN_TOOL, fixer: fixer(0.01) },
      services,
    );
    expect(built).toEqual([['.'], ['.']]);
    expect(result.verification.build).toEqual([
      { workspace: '.', status: 'passed', command: 'next build', output: '' },
    ]);
    expect(publicationBlockers(result, { uptideDirty: false })).toEqual([]);
    expect(prBody(result)).toContain(
      '| **Verified by** | ⚠️ no migration pack: nothing analyzed what paint 1.1.0 changes · ✅ type-check · ✅ build · ✅ tests (1 run) |',
    );
    expect(prBody(result)).toContain('Build after the bump in `.`: `next build` — passed');
  }, 20000);

  it('does not publish a minor upgrade without a pack when the repository has no build script or no tests', async () => {
    const noBuild = cleanMinor(undefined, passingTests);
    const first = await fix(
      { cwd: noBuild.root, only: 'paint', tool: CLEAN_TOOL, fixer: noBuild.fixer(0.01) },
      noBuild.services,
    );
    expect(first.verification.build).toEqual([
      { workspace: '.', status: 'missing', output: 'no build script' },
    ]);
    expect(publicationBlockers(first, { uptideDirty: false })).toEqual([
      'no pack yet: the repository has no build script to verify the bump with, and the type-check alone does not',
    ]);
    const noTests = cleanMinor(async () => [
      { workspace: '.', status: 'passed', command: 'tsc -b', output: '' },
    ]);
    const second = await fix(
      { cwd: noTests.root, only: 'paint', tool: CLEAN_TOOL, fixer: noTests.fixer(0.01) },
      noTests.services,
    );
    expect(publicationBlockers(second, { uptideDirty: false })).toEqual([
      'no pack yet: the repository has no tests to verify the bump with, and the type-check alone does not',
    ]);
  }, 30000);

  it('fails a minor upgrade without a pack whose build fails after the bump', async () => {
    const { root, services, fixer } = cleanMinor(
      async () => [
        {
          workspace: '.',
          status: 'failed',
          command: 'next build',
          output: 'Error: next lint was removed',
        },
      ],
      passingTests,
    );
    const result = await fix(
      { cwd: root, only: 'paint', tool: CLEAN_TOOL, fixer: fixer(0.01) },
      services,
    );
    expect(result.verification.passed).toBe(false);
    expect(publicationBlockers(result, { uptideDirty: false })).toEqual([
      'verification failed: build failed in .',
    ]);
    expect(prBody(result)).toContain('❌ build');
  }, 20000);
});

describe('fix with companions', () => {
  /** `paint` with `brush` installed beside it: check says brush has to move with paint 2. */
  function withBrush(conflicts: string[] = []) {
    const fixture = paintFixture();
    const { root, report, services } = fixture;
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    manifest.dependencies.brush = '1.0.0';
    writeFileSync(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    git(root, 'commit', '-am', 'brush');
    const lead = report.packages[0] as CheckReport['packages'][number];
    lead.companions = [
      { name: 'brush', from: '1.0.0', to: '2.0.0', reason: 'brush 2.0.0 pins paint 2.0.0' },
    ];
    if (conflicts.length) lead.companionConflicts = conflicts;
    const installs: Parameters<FixServices['install']>[1][] = [];
    const install = services.install;
    services.install = async (dir, upgrade) => {
      installs.push(upgrade);
      await install(dir, upgrade);
      for (const move of upgrade?.also ?? []) {
        mkdirSync(join(dir, 'node_modules', move.name), { recursive: true });
        writeFileSync(join(dir, 'node_modules', move.name, 'package.json'), JSON.stringify(move));
      }
    };
    return { ...fixture, installs };
  }

  it('installs the package and every companion in one step, and says so', async () => {
    // Moving paint alone would leave brush 1 pinned to paint 1: the install only
    // agrees when both move.
    const { root, services, fixer, installs } = withBrush();
    const result = await fix({ cwd: root, only: 'paint', fixer: fixer(0.01) }, services);
    expect(installs).toHaveLength(1);
    expect(installs[0]).toMatchObject({
      name: 'paint',
      version: '2.0.0',
      also: [{ name: 'brush', version: '2.0.0' }],
    });
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(manifest.dependencies).toEqual({ paint: '2.0.0', brush: '2.0.0' });
    expect(git(root, 'log', '--format=%s', '-n', '1', 'HEAD~1')).toBe(
      'chore: upgrade paint to 2.0.0 with brush 2.0.0',
    );
    expect(result.companions).toEqual([
      { name: 'brush', from: '1.0.0', to: '2.0.0', reason: 'brush 2.0.0 pins paint 2.0.0' },
    ]);
    expect(prBody(result)).toContain(
      'Upgraded with paint, so the install stays consistent:\n\n- `brush` 1.0.0 → 2.0.0 (brush 2.0.0 pins paint 2.0.0)',
    );
  }, 20000);

  it('installs what the target requires with it, and names why apart from its companions', async () => {
    const { root, report, services, fixer, installs } = withBrush();
    const lead = report.packages[0] as CheckReport['packages'][number];
    lead.companions = [
      {
        name: 'brush',
        from: '1.0.0',
        to: '1.4.0',
        reason: 'paint 2.0.0 requires brush ^1.4.0',
        required: true,
      },
    ];
    const result = await fix({ cwd: root, only: 'paint', fixer: fixer(0.01) }, services);
    // The install scope is the lead and the required move, one install.
    expect(installs[0]).toMatchObject({ also: [{ name: 'brush', version: '1.4.0' }] });
    const body = prBody(result);
    expect(body).toContain(
      'Moved because the new version requires it:\n\n- `brush` 1.0.0 → 1.4.0 (moved because paint 2.0.0 requires brush ^1.4.0)',
    );
    expect(body).not.toContain('Upgraded with paint');
  }, 20000);

  it('names a required move it will not make, a new major, as a blocker in the PR body', async () => {
    const { root, report, services, fixer, installs } = withBrush();
    const lead = report.packages[0] as CheckReport['packages'][number];
    delete lead.companions;
    lead.companionBlockers = [
      'paint 2.0.0 needs brush ^2.0.0; installed 1.0.0, and only a new major satisfies it (brush 2.0.0)',
    ];
    const result = await fix({ cwd: root, only: 'paint', fixer: fixer(0.01) }, services);
    expect(installs[0]?.also).toBeUndefined();
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies.brush).toBe(
      '1.0.0',
    );
    const body = prBody(result);
    expect(body).toContain(
      'Blocked: a required move only a new major makes, which Uptide never makes:\n\n- paint 2.0.0 needs brush ^2.0.0; installed 1.0.0, and only a new major satisfies it (brush 2.0.0)',
    );
    expect(body).toContain('a required move is blocked');
  }, 20000);

  it('removes a deprecated @types stub in the same install, and names it apart', async () => {
    const { root, report, services, fixer, installs } = withBrush();
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    manifest.devDependencies = { '@types/paint': '^1.0.0' };
    writeFileSync(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    git(root, 'commit', '-am', 'types');
    const lead = report.packages[0] as CheckReport['packages'][number];
    delete lead.companions;
    lead.companionRemovals = [
      { name: '@types/paint', from: '1.0.0', reason: 'paint 2 ships its own types' },
    ];
    const result = await fix({ cwd: root, only: 'paint', fixer: fixer(0.01) }, services);
    // One install: the lead moves, the stub goes, and the scope guard is told so.
    expect(installs).toHaveLength(1);
    expect(installs[0]).toMatchObject({ name: 'paint', remove: ['@types/paint'] });
    expect(installs[0]?.also).toBeUndefined();
    expect(installs[0]?.workspaces).toEqual(['.']);
    const after = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(after.devDependencies).toEqual({});
    expect(after.dependencies.brush).toBe('1.0.0');
    expect(git(root, 'log', '--format=%s', '-n', '1', 'HEAD~1')).toBe(
      'chore: upgrade paint to 2.0.0, remove @types/paint',
    );
    expect(result.companionRemovals).toEqual(lead.companionRemovals);
    const body = prBody(result);
    expect(body).toContain('Removed:\n\n- `@types/paint`, paint 2 ships its own types');
    expect(body).not.toContain('Upgraded with paint');
  }, 20000);

  it('falls back to the lead when a companion has no version that agrees', async () => {
    const { root, services, fixer, installs } = withBrush([
      'brush 1.0.0 has no release that agrees with paint 2.0.0',
    ]);
    const result = await fix({ cwd: root, only: 'paint', fixer: fixer(0.01) }, services);
    expect(installs).toHaveLength(1);
    expect(installs[0]?.also).toBeUndefined();
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies.brush).toBe(
      '1.0.0',
    );
    expect(result.verification.passed).toBe(false);
    expect(prBody(result)).toContain('Agent-led fallback: Planner refused');
  });
});
