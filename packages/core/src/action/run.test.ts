import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CheckReport } from '../domain/report.js';
import type { FixReport } from '../fix/types.js';
import type { ListedDependency, ListReport } from '../list/list.js';
import { reportProblems } from '../run-report/safe.js';
import { renderSummary } from '../run-report/summary.js';
import type { EngineRun } from './engine.js';
import { ActionAuthError } from './oidc.js';
import { type ActionInputs, type ActionServices, runAction } from './run.js';

const fixture = <T>(path: string): T =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const storefrontFix = (): FixReport => fixture('../fix/__fixtures__/storefront-zod.json');
const storefrontCheck = () => fixture('../../../cli/src/__fixtures__/storefront-check.json');

const dep = (
  name: string,
  current: string,
  latest: string,
  extra: Partial<ListedDependency> = {},
) =>
  ({
    name,
    current,
    latest,
    change: 'major',
    classification: 'used',
    ...extra,
  }) as ListedDependency;
const listReport = (packages: ListedDependency[]): ListReport =>
  ({
    repo: '.',
    workspaces: ['.'],
    packages,
    groups: [],
    failures: [],
    timing: { totalMs: 1 },
  }) as ListReport;

function workspace(settings?: string, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'uptide-action-'));
  mkdirSync(join(dir, '.git'));
  if (settings !== undefined) writeFileSync(join(dir, 'uptide.yml'), settings);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const inputs = (ws: string, extra: Partial<ActionInputs> = {}): ActionInputs => ({
  workspace: ws,
  config: 'uptide.yml',
  mode: 'fix',
  apiKey: 'test-key',
  engineVersion: '0.9.0',
  github: {
    repository: 'acme/storefront',
    repositoryId: '123',
    sha: 'c'.repeat(40),
    runId: '77',
    runAttempt: '1',
  },
  ...extra,
});

/** Fake services: the engine answers by command; everything is recorded. */
function services(answers: {
  list: ListReport;
  check?: unknown;
  fix?: (name: string) => EngineRun;
  open?: string[];
  token?: () => Promise<string>;
  publish?: (branch: string) => Promise<string>;
}) {
  const calls: { args: string[]; apiKey?: string }[] = [];
  const published: { branch: string; token: string }[] = [];
  let clock = Date.UTC(2026, 9, 13, 6, 17);
  const s: ActionServices = {
    async engine(args, apiKey) {
      calls.push({ args, ...(apiKey ? { apiKey } : {}) });
      const [command, name] = args;
      if (command === 'list') return { code: 0, stdout: JSON.stringify(answers.list) };
      if (command === 'check') return { code: 1, stdout: JSON.stringify(answers.check) };
      if (command === 'fix' && answers.fix) return answers.fix(name as string);
      return { code: 2, stdout: '' };
    },
    token: answers.token ?? (async () => 'installation-token'),
    openUptideBranches: async () => answers.open ?? [],
    async publish(branch, token) {
      published.push({ branch, token });
      return answers.publish
        ? answers.publish(branch)
        : 'https://github.com/acme/storefront/pull/9';
    },
    now: () => (clock += 1000),
    log: () => {},
  };
  return { s, calls, published };
}
const fixRun = (report: FixReport, code = 0): EngineRun => ({
  code,
  stdout: JSON.stringify(report),
});

describe('the Uptide Action run', () => {
  it('list: what is behind, nothing else run', async () => {
    const { s, calls } = services({
      list: listReport([
        dep('zod', '3.25.76', '4.6.5'),
        dep('eslint', '8.57.0', '9.1.0', { classification: 'tooling' }),
      ]),
    });
    const report = await runAction(inputs(workspace('version: 1\n'), { mode: 'list' }), s);
    expect(reportProblems(report)).toEqual([]);
    expect(report.upgrades.map((u) => [u.package, u.status, u.kind])).toEqual([
      ['zod', 'available', 'major'],
      ['eslint', 'available', 'major'],
    ]);
    expect(calls.map((c) => c.args[0])).toEqual(['list']);
    expect(calls[0]?.args).toContain('--config');
    expect(calls.some((c) => c.apiKey)).toBe(false);
  });

  it('check: the used dependencies, with the sites each upgrade breaks', async () => {
    const { s, calls } = services({
      list: listReport([dep('zod', '3.25.76', '4.6.5')]),
      check: storefrontCheck(),
    });
    const report = await runAction(inputs(workspace('version: 1\n'), { mode: 'check' }), s);
    expect(reportProblems(report)).toEqual([]);
    expect(calls[1]?.args.slice(0, 2)).toEqual(['check', 'zod']);
    const zod = report.upgrades.find((u) => u.package === 'zod');
    expect(zod?.status).toBe('available');
    expect(zod?.breaking.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.apiKey)).toBe(false);
  });

  it('check: a package without a pack is not analyzed, and companions move with their lead', async () => {
    const pkg = (name: string, installed: string, target: string, extra: object = {}) => ({
      workspace: '.',
      name,
      installed,
      latest: target,
      target,
      majorsBehind: 0,
      findings: [],
      callSitesChecked: 3,
      unanalyzed: [],
      status: 'safe',
      notes: [],
      timing: { fetchMs: 0, diffMs: 0, usagesMs: 0, compileMs: 0 },
      ...extra,
    });
    const zod = (storefrontCheck() as CheckReport).packages.find((p) => p.name === 'zod');
    const { s } = services({
      list: listReport([
        dep('zod', '3.25.76', '4.6.5'),
        dep('react', '18.3.1', '19.2.0'),
        dep('react-dom', '18.3.1', '19.2.0'),
        dep('@types/react', '18.3.12', '19.2.2'),
        dep('prisma', '6.16.0', '7.0.0'),
      ]),
      check: {
        repo: '.',
        workspaces: ['.'],
        packages: [
          { ...zod, findings: [] },
          pkg('react', '18.3.1', '19.2.0', {
            tier: 'generic',
            companions: [
              { name: '@types/react', from: '18.3.12', to: '19.2.2', reason: 'types react' },
              { name: 'react-dom', from: '18.3.1', to: '19.2.0', reason: 'released with react' },
            ],
          }),
          // What `check` reports for a companion asked for by name: its installed version.
          pkg('react-dom', '18.3.1', '18.3.1', { notes: ['up to date'] }),
          pkg('@types/react', '18.3.12', '18.3.12', { notes: ['up to date'] }),
          pkg('prisma', '6.16.0', '7.0.0', { tier: 'generic' }),
        ],
        summary: {},
        timing: { totalMs: 1 },
      },
    });
    const report = await runAction(inputs(workspace('version: 1\n'), { mode: 'check' }), s);
    expect(reportProblems(report)).toEqual([]);
    const row = (name: string) => report.upgrades.find((u) => u.package === name);
    // Zero from a pack is an answer; zero without one is not.
    expect(row('zod')).toMatchObject({ analysis: 'pack', breaking: [] });
    expect(row('prisma')).toMatchObject({ analysis: 'none', breaking: [] });
    expect(row('react')).toMatchObject({ analysis: 'none', status: 'available' });
    expect(row('react-dom')).toMatchObject({
      from: '18.3.1',
      to: '19.2.0',
      kind: 'major',
      status: 'available',
      movesWith: 'react',
    });
    expect(row('@types/react')).toMatchObject({ to: '19.2.2', movesWith: 'react' });
    expect(row('react-dom')?.analysis).toBeUndefined();
    const summary = renderSummary(report);
    expect(summary).toContain(
      '| `prisma` | 6.16.0 → 7.0.0 (major) | available | not analyzed: no pack yet |',
    );
    expect(summary).toContain('| `zod` | 3.25.76 → 4.6.5 (major) | available | 0 |');
    expect(summary).toContain(
      '| `react-dom` | 18.3.1 → 19.2.0 (major) | moves with `react` | with `react` |',
    );
    expect(summary).not.toContain('up to date');
    // Nothing breaks anywhere: no breaking-sites section at all.
    expect(summary).not.toContain('### Breaking sites');
  });

  it('fix: migrates, opens the PR with the installation token, and reports it', async () => {
    const { s, calls, published } = services({
      list: listReport([dep('zod', '3.25.76', '4.6.5')]),
      fix: () => fixRun(storefrontFix()),
    });
    const report = await runAction(inputs(workspace('version: 1\nmaxCost: 2\n')), s);
    expect(reportProblems(report)).toEqual([]);
    const fix = calls.find((c) => c.args[0] === 'fix');
    expect(fix?.args).toEqual(
      expect.arrayContaining(['zod', '--llm', '--agent', 'sdk', '--max-cost', '2.00', '--json']),
    );
    expect(fix?.apiKey).toBe('test-key');
    expect(published).toEqual([{ branch: storefrontFix().branch, token: 'installation-token' }]);
    expect(report.upgrades[0]).toMatchObject({
      package: 'zod',
      status: 'fixed',
      pr: { number: 9, url: 'https://github.com/acme/storefront/pull/9' },
    });
    expect(report.error).toBeUndefined();
  });

  it('fix: never more open pull requests than maxOpenPrs, and never a second for a package', async () => {
    const { s, calls } = services({
      list: listReport([
        dep('zod', '3.25.76', '4.6.5'),
        dep('stripe', '14.25.0', '19.0.0'),
        dep('ai', '4.0.0', '5.0.0'),
      ]),
      open: ['uptide/stripe-18.0.0'],
      fix: () => fixRun(storefrontFix()),
    });
    const report = await runAction(inputs(workspace('version: 1\nmaxOpenPrs: 2\n')), s);
    expect(report.upgrades.map((u) => [u.package, u.status])).toEqual([
      ['zod', 'fixed'],
      ['stripe', 'skipped'],
      ['ai', 'available'],
    ]);
    expect(report.upgrades[2]?.error).toContain('maxOpenPrs');
    expect(calls.filter((c) => c.args[0] === 'fix')).toHaveLength(1);
  });

  it('fix: rule-based only without a key, or with the LLM off; the patch executor without --agent', async () => {
    for (const [settings, apiKey, expected] of [
      ['version: 1\n', undefined, '--no-llm'],
      ['version: 1\nllm:\n  enabled: false\n', 'test-key', '--no-llm'],
      ['version: 1\nexecutor: patch\n', 'test-key', '--llm'],
    ] as const) {
      const { s, calls } = services({
        list: listReport([dep('zod', '3.25.76', '4.6.5')]),
        fix: () => fixRun(storefrontFix()),
      });
      await runAction(inputs(workspace(settings), apiKey ? { apiKey } : { apiKey: undefined }), s);
      const fix = calls.find((c) => c.args[0] === 'fix');
      expect(fix?.args).toContain(expected);
      expect(fix?.args.includes('--agent')).toBe(false);
      expect(fix?.apiKey).toBe(expected === '--llm' ? 'test-key' : undefined);
    }
  });

  it('fix: a migration that does not verify is reported failed and never published', async () => {
    const failing = storefrontFix();
    failing.verification.passed = false;
    (failing.verification.tests[0] as { status: string }).status = 'failed';
    const { s, published } = services({
      list: listReport([dep('zod', '3.25.76', '4.6.5')]),
      fix: () => fixRun(failing, 1),
    });
    const report = await runAction(inputs(workspace('version: 1\n')), s);
    expect(published).toEqual([]);
    expect(report.upgrades[0]).toMatchObject({
      status: 'failed',
      pr: null,
      error: 'verification failed: tests failed in packages/api',
    });
    expect(report.error).toBeUndefined();
  });

  it('fix: without a token, nothing is migrated and the run says why', async () => {
    const { s, calls } = services({
      list: listReport([dep('zod', '3.25.76', '4.6.5')]),
      token: async () => {
        throw new ActionAuthError(
          'the Uptide app has no installation for this repository (HTTP 404): install the Uptide GitHub App on it',
        );
      },
    });
    const report = await runAction(inputs(workspace('version: 1\n')), s);
    expect(calls.map((c) => c.args[0])).toEqual(['list']);
    expect(report.error).toContain('install the Uptide GitHub App');
    expect(report.upgrades[0]?.status).toBe('available');
  });

  it('fix: a verified migration whose PR cannot be opened is failed, with a reason that quotes nothing', async () => {
    const { s } = services({
      list: listReport([dep('zod', '3.25.76', '4.6.5')]),
      fix: () => fixRun(storefrontFix()),
      publish: async () => {
        throw new Error('gh: HTTP 422 Validation Failed\nsecret-looking output');
      },
    });
    const report = await runAction(inputs(workspace('version: 1\n')), s);
    expect(report.upgrades[0]).toMatchObject({ status: 'failed', pr: null });
    expect(report.upgrades[0]?.error).toBe(
      'verified, but the pull request could not be opened; the job log has the reason',
    );
  });

  it('a settings file that does not validate stops the run before anything runs', async () => {
    const { s, calls } = services({ list: listReport([]) });
    const report = await runAction(inputs(workspace('version: 1\nmaxOpenPrs: lots\n')), s);
    expect(calls).toEqual([]);
    expect(report.error).toBe('uptide.yml is not valid; the job log names each problem');
  });

  it('a named package that is not behind is up to date, at its installed version', async () => {
    const ws = workspace('version: 1\n', {
      'node_modules/zod/package.json': '{"version":"4.6.5"}',
    });
    const { s } = services({ list: listReport([]) });
    const report = await runAction(inputs(ws, { package: 'zod' }), s);
    expect(report.upgrades).toEqual([
      expect.objectContaining({ package: 'zod', from: '4.6.5', to: '4.6.5', status: 'up_to_date' }),
    ]);
  });

  it('a package with no release old enough for the policy is skipped, with the reason', async () => {
    const reason =
      '5.0.0 is 1 day old; your policy is 7 days (min-release-age in .npmrc); nothing newer than 4.0.0 qualifies';
    const list = {
      ...listReport([dep('zod', '3.25.76', '4.6.5')]),
      releaseAge: [{ name: 'gadget', current: '4.0.0', reason }],
    };
    const all = await runAction(
      inputs(workspace('version: 1\n'), { mode: 'list' }),
      services({ list }).s,
    );
    expect(reportProblems(all)).toEqual([]);
    expect(all.upgrades.map((u) => [u.package, u.status, u.from, u.error])).toEqual([
      ['gadget', 'skipped', '4.0.0', `gadget ${reason}`],
      ['zod', 'available', '3.25.76', undefined],
    ]);
    const named = await runAction(
      inputs(workspace('version: 1\n'), { package: 'gadget' }),
      services({ list }).s,
    );
    expect(named.upgrades).toEqual([
      expect.objectContaining({ package: 'gadget', status: 'skipped', error: `gadget ${reason}` }),
    ]);
  });

  it('runs with the defaults when the repository has no uptide.yml', async () => {
    const { s, calls } = services({ list: listReport([]) });
    const report = await runAction(inputs(workspace(), { mode: 'list' }), s);
    expect(report.error).toBeUndefined();
    expect(calls[0]?.args).not.toContain('--config');
  });
});
