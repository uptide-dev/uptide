import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MigrationPack } from '../packs/types.js';
import { dependencyEdits } from './dependency-edits.js';
import { prBody } from './report.js';
import {
  assistWithSdk,
  type DependencyGate,
  editRules,
  guard,
  type TaskRunner,
} from './sdk-agent.js';
import type { AgentSummary, FixReport, FixSite } from './types.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
function repo(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'uptide-dependency-edits-')));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'test');
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'base');
  return root;
}
const json = (value: unknown) => `${JSON.stringify(value, null, 4)}\n`;
/** A manual site in `file`, as the sentry pack reports one on a package.json script line. */
const site = (file: string): FixSite =>
  ({
    finding: {
      change: { package: 'typescript', from: '5.9.3', to: '6.0.3', path: 'x', kind: 'removed' },
      usage: { file, line: 2, column: 1, snippet: '' },
      severity: 'breaking',
      confidence: 'high',
      fixability: 'assisted',
      reason: '',
    },
    outcome: 'manual',
    reason: 'assisted review required',
    rule: 'module-resolution-node10',
  }) as unknown as FixSite;
const said = (what: string): AgentSummary => ({
  changed: [{ file: 'package.json', what }],
  newFiles: [],
  decisions: [],
  assumptions: [],
  couldNotDo: [],
});

// guardian/support-dotcom-components after the typescript 6 bump, before the agent.
const ROOT = json({
  name: 'workspace',
  dependencies: { '@guardian/libs': '33.0.0', '@guardian/ophan-tracker-js': '2.8.3' },
  devDependencies: { typescript: '6.0.3' },
  pnpm: { overrides: { tslib: '2.8.1' } },
});
const DOTCOM = json({
  name: '@guardian/support-dotcom-components',
  peerDependencies: { '@guardian/libs': '^22.0.0', '@guardian/ophan-tracker-js': '2.8.0' },
});

/** One agent session over manual sites in both manifests; `edit` plays the agent. */
async function session(edit: (root: string) => void, scope = ['typescript']) {
  const root = repo({ 'package.json': ROOT, 'src/dotcom/package.json': DOTCOM });
  const sites = [site('package.json'), site('src/dotcom/package.json')];
  const runner: TaskRunner = async () => {
    edit(root);
    return {
      turns: 1,
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0.01,
      durationMs: 1,
      toolCalls: {},
      summary: said('@guardian/libs 33.0.0 pins @guardian/ophan-tracker-js 3.1.0'),
    };
  };
  const llm = await assistWithSdk({
    root,
    workspaces: ['.', 'src/dotcom'],
    scope,
    sites,
    pack: { name: 'typescript', rules: [] } as unknown as MigrationPack,
    context: { from: '5.9.3', to: '6.0.3', includeDeprecated: false },
    model: 'claude-sonnet-5-5',
    maxCostUsd: 1,
    diagnostics: () => [],
    tests: async () => [{ workspace: '.', status: 'passed', output: '' }],
    lint: async () => [],
    format: async () => [],
    baselineTests: [{ workspace: '.', status: 'passed', output: '' }],
    baselineLint: [],
    affected: [],
    runner,
  });
  return { root, sites, record: llm.tasks?.[0], llm };
}
type Manifest = Record<string, Record<string, unknown>>;
const rewrite = (root: string, file: string, change: (m: Manifest) => void) => {
  const manifest = JSON.parse(readFileSync(join(root, file), 'utf8')) as Manifest;
  change(manifest);
  writeFileSync(join(root, file), json(manifest));
};

describe('dependency edits by the agent (UPT-126)', () => {
  it('refuses and reverts an unrelated major bump and a widened nested peer range, whatever the agent says', async () => {
    const { root, sites, record } = await session((r) => {
      rewrite(r, 'package.json', (m) => {
        (m.dependencies as Record<string, string>)['@guardian/ophan-tracker-js'] = '3.1.0';
      });
      rewrite(r, 'src/dotcom/package.json', (m) => {
        (m.peerDependencies as Record<string, string>)['@guardian/ophan-tracker-js'] =
          '2.8.0 || ^3.0.0';
      });
    });
    expect(record?.gate).toBe('rejected');
    expect(record?.outOfScopeDependencyEdits).toEqual([
      {
        file: 'package.json',
        field: 'dependencies',
        name: '@guardian/ophan-tracker-js',
        before: '2.8.3',
        after: '3.1.0',
        reverted: true,
      },
      {
        file: 'src/dotcom/package.json',
        field: 'peerDependencies',
        name: '@guardian/ophan-tracker-js',
        before: '2.8.0',
        after: '2.8.0 || ^3.0.0',
        reverted: true,
      },
    ]);
    // The feedback the next round gets: the package, and that it is out of scope.
    expect(record?.rejection).toContain(
      "outside this upgrade's scope (the upgraded package and its planned companions)",
    );
    expect(record?.rejection).toContain(
      'package.json dependencies @guardian/ophan-tracker-js: 2.8.3 → 3.1.0',
    );
    expect(sites.every((s) => s.outcome === 'manual')).toBe(true);
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(ROOT);
    expect(readFileSync(join(root, 'src/dotcom/package.json'), 'utf8')).toBe(DOTCOM);
    expect(git(root, 'status', '--porcelain')).toBe('');
  });

  it('refuses removing a dependency and editing overrides', async () => {
    const { record } = await session((r) =>
      rewrite(r, 'package.json', (m) => {
        delete m.dependencies?.['@guardian/libs'];
        m.pnpm = { overrides: { tslib: '2.9.0' } };
      }),
    );
    expect(record?.gate).toBe('rejected');
    expect(record?.outOfScopeDependencyEdits?.map((e) => [e.field, e.name, e.after])).toEqual([
      ['dependencies', '@guardian/libs', undefined],
      ['pnpm', 'overrides', '{"tslib":"2.9.0"}'],
    ]);
  });

  it('keeps a new dependency the agent adds, records it and lists it in the PR body', async () => {
    const { root, record, llm } = await session((r) =>
      rewrite(r, 'package.json', (m) => {
        (m.devDependencies as Record<string, string>)['@types/jest'] = '^30.0.0';
      }),
    );
    expect(record?.gate).toBe('accepted');
    expect(record?.outOfScopeDependencyEdits).toBeUndefined();
    expect(record?.agentAddedDependencies).toEqual([
      { file: 'package.json', field: 'devDependencies', name: '@types/jest', after: '^30.0.0' },
    ]);
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies).toEqual({
      typescript: '6.0.3',
      '@types/jest': '^30.0.0',
    });
    const report = JSON.parse(
      readFileSync(new URL('./__fixtures__/storefront-zod.json', import.meta.url), 'utf8'),
    ) as FixReport;
    const body = prBody({ ...report, llm: { ...report.llm, tasks: llm.tasks ?? [] } });
    expect(body).toContain(
      '**Added by the agent**\n\n- `@types/jest` ^30.0.0 in package.json (devDependencies)',
    );
  });

  it('leaves the upgraded package and its planned companions to the engine, rewritten or not', async () => {
    const { record } = await session(
      (r) =>
        rewrite(r, 'package.json', (m) => {
          (m.devDependencies as Record<string, string>).typescript = '~6.0.3';
          (m.dependencies as Record<string, string>)['@guardian/libs'] = '33.0.0';
          (m.dependencies as Record<string, string>)['@guardian/ophan-tracker-js'] = '3.1.0';
        }),
      ['typescript', '@guardian/ophan-tracker-js'],
    );
    expect(record?.gate).toBe('accepted');
    expect(record?.outOfScopeDependencyEdits).toBeUndefined();
  });

  it('never flags overrides the engine wrote before the session, kept or reformatted', () => {
    const engine = json({ overrides: { react: '19.0.0' }, resolutions: { zod: '4.6.5' } });
    const reformatted = JSON.stringify(JSON.parse(engine));
    expect(dependencyEdits('package.json', engine, reformatted, [])).toEqual({
      refused: [],
      added: [],
    });
  });
});

it('refuses and records an edited lockfile or a new package.json after the session, whatever the guard let through', () => {
  for (const file of ['pnpm-lock.yaml', 'src/new/package.json']) {
    const root = repo({ 'package.json': ROOT, 'pnpm-lock.yaml': 'lockfileVersion: 9.0\n' });
    mkdirSync(join(root, 'src/new'), { recursive: true });
    writeFileSync(join(root, file), '{}\n');
    const gate: DependencyGate = { scope: [], refused: [], added: [] };
    const task = { id: 'r', rule: 'r', sites: [], files: [file] };
    expect(editRules(root, task, { ...said(''), newFiles: [file] }, [], [], gate)).toContain(
      `${file}: lockfiles, package-manager configuration and new package.json files are read-only`,
    );
    expect(gate.refused).toEqual([{ file, reverted: true }]);
  }
});

describe('guard: package-manager files (UPT-126)', () => {
  const root = repo({
    'package.json': ROOT,
    'pnpm-lock.yaml': '',
    'package-lock.json': '{}',
    'yarn.lock': '',
    '.npmrc': '',
    '.yarnrc.yml': '',
    'src/a.ts': '',
  });
  // npm, pnpm, Yarn classic and Berry, and Bun: lockfiles, configuration and hooks.
  const every = [
    'pnpm-lock.yaml',
    'package-lock.json',
    'npm-shrinkwrap.json',
    'yarn.lock',
    'bun.lock',
    '.npmrc',
    '.yarnrc',
    '.yarnrc.yml',
    '.pnpmfile.cjs',
    'pnpm-workspace.yaml',
    'src/dotcom/yarn.lock',
  ];

  it.each(every)('refuses editing or creating %s, even as a task file', (file) => {
    for (const tool of ['Edit', 'Write'])
      expect(guard(root, [file, 'src/a.ts'], tool, { file_path: file })).toMatch(/is read-only/);
  });

  it('refuses a new package.json and allows editing an existing one the task names', () => {
    expect(guard(root, ['src/a.ts'], 'Write', { file_path: 'src/new/package.json' })).toMatch(
      /is read-only/,
    );
    expect(guard(root, ['package.json'], 'Edit', { file_path: 'package.json' })).toBeUndefined();
    expect(guard(root, ['src/a.ts'], 'Write', { file_path: 'src/new/b.ts' })).toBeUndefined();
  });
});
