import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import { check } from '../check/check.js';
import { isolatedFix } from '../fix/isolate.js';
import { git } from '../fix/process.js';
import { publicationBlockers } from '../fix/publish.js';
import { formatFix, prBody } from '../fix/report.js';
import { fix } from '../fix/run.js';
import { zodFixture } from '../fix/test-fixture.js';
import { fromChecked, fromFix } from '../run-report/build.js';
import { ruleFor } from './contract.js';
import { activePack, activePacks, registeredPacks } from './index.js';
import type { MigrationPack } from './types.js';

vi.mock('./registry.js', async () => {
  const { zodPack } = await import('./zod/index.js');
  const record = {
    status: 'candidate',
    truth: '',
    repos: 0,
    breaking: { precision: 0, recall: 0, falsePositives: 0 },
  };
  return {
    REGISTRY: [
      { dir: 'zod', pack: zodPack, verification: record },
      {
        dir: 'verified',
        pack: { ...zodPack, name: 'verified' },
        verification: { ...record, status: 'verified', repos: 2 },
      },
      {
        dir: 'blocked',
        pack: { ...zodPack, name: 'blocked' },
        verification: { ...record, status: 'blocked' },
      },
      { dir: 'unrecorded', pack: { ...zodPack, name: 'unrecorded' } },
      {
        dir: 'inconsistent',
        pack: { ...zodPack, name: 'inconsistent' },
        verification: { ...record, status: 'verified' },
      },
    ],
  };
});

const scratch = mkdtempSync(join(tmpdir(), 'uptide-candidate-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const banner = 'candidate pack, not verified';

it('opts in only to registered packs with an explicitly recorded candidate status', () => {
  expect(activePacks().map((p) => p.name)).toEqual(['verified']);
  expect(activePacks(true).map((p) => p.name)).toEqual(['zod', 'verified']);
  expect(activePack('zod', true)).toBe(registeredPacks()[0]?.pack);
  expect(activePack('missing', true)).toBeUndefined();
  expect(activePack('blocked', true)).toBeUndefined();
  expect(activePack('unrecorded', true)).toBeUndefined();
  expect(activePack('inconsistent', true)).toBeUndefined();
  expect(activePack('verified', true)).toBe(activePack('verified'));
});

it.each([{ pr: true }, { yes: true }, { forPublication: true }])(
  'refuses candidate publication before any work: %j',
  async (flags) => {
    const options = { cwd: '/does-not-exist', only: 'zod', allowCandidate: true, ...flags };
    await expect(fix(options)).rejects.toThrow('--allow-candidate');
    await expect(isolatedFix(options)).rejects.toThrow('--allow-candidate');
  },
);

it('runs a candidate locally, persists the banner and prevents later publication', async () => {
  const { root, services } = zodFixture(scratch);
  const checked = vi.fn(services.check);
  const result = await fix(
    { cwd: root, only: 'zod', allowCandidate: true, fixer: null },
    { ...services, check: checked },
  );
  expect(checked.mock.calls[0]?.[0].allowCandidate).toBe(true);
  expect(result.sites.some((s) => s.outcome === 'mechanical')).toBe(true);
  expect(formatFix(result)).toContain(banner);
  expect(prBody(result)).toContain(banner);
  expect(readFileSync(result.prBody, 'utf8')).toContain(banner);
  const stored = JSON.parse(readFileSync(join(root, '.uptide/report.json'), 'utf8'));
  expect(stored.packWarning).toBe(banner);
  expect(publicationBlockers(stored, { uptideDirty: false })).toContain(banner);
  expect(fromFix(result, { pr: null, durationMs: 1 }).error).toContain(banner);
});

it('check activates the candidate and labels its report without changing the default', async () => {
  const { root } = zodFixture(scratch);
  // Use the real checker with synthetic declarations; no registry, repository scripts or LLM.
  const target = join(scratch, 'target');
  mkdirSync(target);
  writeFileSync(
    join(target, 'package.json'),
    JSON.stringify({ name: 'zod', version: '4.6.5', types: 'index.d.ts' }),
  );
  writeFileSync(
    join(target, 'index.d.ts'),
    'export declare const z: { string(options: {error?: string}): string };',
  );
  const options = {
    cwd: root,
    only: ['zod'],
    runtime: false,
    workspaceConcurrency: 1,
    cache: { get: async () => undefined, set: async () => {} },
    fetcher: {
      resolve: async () => '4.6.5',
      release: async () => {},
      fetch: async (name: string, version: string) => ({ name, version, dir: target }),
    },
  };
  const normal = await check(options);
  const candidate = await check({ ...options, allowCandidate: true });
  expect(normal.packages[0]?.packWarning).toBeUndefined();
  expect(candidate.packages[0]?.packWarning).toBe(banner);
  expect(candidate.packages[0]?.plan?.some((p) => p.rule === 'error-params')).toBe(true);
  const checked = candidate.packages[0];
  if (!checked) throw new Error('missing candidate report');
  expect(fromChecked(checked).error).toBe(banner);
});

it('labels no-llm tool-call union sites with the claiming rule (PR 130 smoke regression)', async () => {
  const { root, services } = zodFixture(scratch);
  // A stand-in SDK and consumer, not the smoke repository or any pack truth.
  const source =
    "import type { ChatCompletionMessageToolCall } from 'openai';\nexport function use(tc: ChatCompletionMessageToolCall) {\n  return [tc.function.name, tc.function.arguments];\n}\n";
  for (const file of ['package.json', 'pnpm-lock.yaml'])
    writeFileSync(
      join(root, file),
      readFileSync(join(root, file), 'utf8')
        .replaceAll('zod', 'openai')
        .replaceAll('3.25.76', '4.104.0'),
    );
  writeFileSync(join(root, 'index.ts'), source);
  mkdirSync(join(root, 'node_modules/openai'));
  const sdk = (version: string) => {
    writeFileSync(
      join(root, 'node_modules/openai/package.json'),
      JSON.stringify({ name: 'openai', version, types: 'index.d.ts' }),
    );
    writeFileSync(
      join(root, 'node_modules/openai/index.d.ts'),
      'export type ChatCompletionMessageToolCall = { type: "function"; function: { name: string; arguments: string } }' +
        (version.startsWith('7') ? ' | { type: "custom"; custom: { name: string } };' : ';'),
    );
  };
  sdk('4.104.0');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'synthetic union consumer');
  const report = await services.check({ cwd: root });
  const pkg = report.packages[0];
  if (!pkg) throw new Error('missing fixture package');
  pkg.name = 'openai';
  pkg.installed = '4.104.0';
  pkg.target = '7.33.0';
  const original = pkg.findings[0];
  if (!original) throw new Error('missing fixture finding');
  pkg.findings = [14, 32].map((column) => ({
    ...original,
    change: {
      ...original.change,
      package: 'openai',
      from: '4.104.0',
      to: '7.33.0',
      kind: 'type',
      path: 'ChatCompletionMessageToolCall.function',
    },
    usage: {
      ...original.usage,
      line: 3,
      column,
      compileCode: 2339,
      compileError: "Property 'function' does not exist on type 'ChatCompletionMessageToolCall'.",
    },
    fixability: 'assisted',
  }));
  const rules = [
    {
      id: 'tool-call-union',
      kinds: ['type'] as const,
      symbols: /ChatCompletionMessageToolCall/,
      guide: 'Narrow the tool-call union before reading function.',
    },
  ];
  const pack: MigrationPack = {
    name: 'openai',
    defaultTarget: '7.33.0',
    supports: () => true,
    rules,
    ruleOf: (f) => ruleFor(rules, f)?.id,
    transform: (text) => ({ text, applied: false, reason: 'needs narrowing' }),
    guide: () => 'Narrow the tool-call union before reading function.',
    reviewNotes: () => [],
  };
  const result = await fix(
    { cwd: root, only: 'openai', fixer: null, pack },
    {
      ...services,
      check: async () => report,
      resolve: async () => '7.33.0',
      install: async () => {
        sdk('7.33.0');
        writeFileSync(
          join(root, 'pnpm-lock.yaml'),
          readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8').replaceAll('4.104.0', '7.33.0'),
        );
      },
    },
  );
  expect(result.sites).toHaveLength(2);
  expect(result.sites.map((s) => [s.outcome, s.rule])).toEqual([
    ['manual', 'tool-call-union'],
    ['manual', 'tool-call-union'],
  ]);
  expect(prBody(result)).toContain('tool-call-union');
});
