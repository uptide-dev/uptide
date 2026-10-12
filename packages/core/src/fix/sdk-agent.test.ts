import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripePack } from '../packs/stripe/index.js';
import type { MigrationPack } from '../packs/types.js';
import { fix } from './run.js';
import { assistWithSdk, guard, planTasks, type TaskRun, taskPrompt } from './sdk-agent.js';
import type { AgentSummary, FixDiagnostic, FixSite, TestResult } from './types.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
function repo(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'uptide-sdk-agent-')));
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
const diag = (file: string, line: number, code: number, message: string): FixDiagnostic => ({
  file,
  line,
  column: 1,
  code,
  message,
});
const site = (file: string, line: number, d: FixDiagnostic): FixSite =>
  ({
    finding: {
      change: {
        package: 'stripe',
        from: '17.7.0',
        to: '23.0.0',
        path: 'Stripe.Subscription#current_period_end',
        kind: 'removed',
      },
      usage: {
        file,
        line,
        column: 1,
        snippet: 'sub.current_period_end',
        compileError: d.message,
        compileCode: d.code,
      },
      severity: 'breaking',
      confidence: 'high',
      fixability: 'assisted',
      reason: 'moved to subscription items',
    },
    outcome: 'manual',
    reason: 'assisted review required',
    rule: 'subscription-period',
  }) as unknown as FixSite;
const pack = { name: 'stripe', rules: [] } as unknown as MigrationPack;
const summary = (over: Partial<AgentSummary> = {}): AgentSummary => ({
  changed: [{ file: 'src/a.ts', what: 'reads the period from the item' }],
  newFiles: [],
  decisions: [],
  assumptions: [],
  couldNotDo: [],
  ...over,
});
const ran = (s: AgentSummary | undefined): TaskRun => ({
  turns: 3,
  inputTokens: 100,
  outputTokens: 10,
  costUsd: 0.01,
  durationMs: 5,
  toolCalls: { Edit: 1 },
  ...(s ? { summary: s } : {}),
});
/** An agent that makes `edit` in the clone and ends with `said`. */
const doing =
  (edit: (root: string) => void, said = summary()) =>
  (root: string): AgentSummary => {
    edit(root);
    return said;
  };
const ORIGINAL = 'line1\nsub.current_period_end\nline3\n';
const migrate = (root: string) =>
  writeFileSync(
    join(root, 'src/a.ts'),
    'line1\nconst a = 1;\nconst b = 2;\nsub.items.data[0].current_period_end\nline3\n',
  );

/**
 * A repository with one site error in src/a.ts and an error that was already there below it.
 * `agent` plays the session in the clone; `after` is what the compiler says once it is done.
 */
async function task(input: {
  agent: (root: string) => AgentSummary | undefined;
  after: FixDiagnostic[];
  tests?: TestResult[];
  /** The tests when the task starts: after the upgrade, before the agent. */
  startTests?: TestResult[];
}) {
  const root = repo({ 'src/a.ts': ORIGINAL, 'src/other.ts': 'export const x = 1;\n' });
  const siteError = diag('src/a.ts', 2, 2339, "Property 'current_period_end' does not exist");
  const preexisting = diag('src/a.ts', 3, 2304, "Cannot find name 'line3'.");
  const sites = [site('src/a.ts', 2, siteError)];
  let calls = 0;
  let testRuns = 0;
  const formatted = new Set<string>();
  const llm = await assistWithSdk({
    root,
    workspaces: ['.'],
    sites,
    pack,
    context: { from: '17.7.0', to: '23.0.0', includeDeprecated: false },
    model: 'claude-sonnet-5-5',
    maxCostUsd: 1,
    // Planning sees the baseline; the check after the task sees `after`.
    diagnostics: () => (calls++ < 1 ? [siteError, preexisting] : input.after),
    tests: async () =>
      // The end of the task first; the start only when something failed at the end.
      (testRuns++ === 0 ? input.tests : input.startTests) ?? [
        { workspace: '.', status: 'passed', output: '' },
      ],
    // Lint passes only on files the formatter has seen, as prettier --check would.
    lint: async (files) =>
      files.map((f) => ({
        tool: 'prettier',
        status: formatted.has(f) ? 'passed' : 'failed',
        command: 'prettier --check',
        files: 1,
        output: '',
      })),
    format: async (files) => {
      for (const f of files) formatted.add(f);
      return ['prettier'];
    },
    baselineTests: [{ workspace: '.', status: 'passed', output: '' }],
    baselineLint: [],
    affected: ['src/a.ts'],
    runner: async ({ root }) => ran(input.agent(root)),
  });
  return { root, sites, record: llm.tasks?.[0] };
}

describe('guard: what an SDK session may touch', () => {
  const root = repo({ 'src/a.ts': 'a\n', 'src/b.ts': 'b\n', 'node_modules/stripe/index.d.ts': '' });
  symlinkSync('/etc', join(root, 'escape'));
  const allowed = ['src/a.ts'];
  it("edits only the task's files, by relative or absolute path", () => {
    expect(guard(root, allowed, 'Edit', { file_path: join(root, 'src/a.ts') })).toBeUndefined();
    expect(guard(root, allowed, 'Edit', { file_path: 'src/a.ts' })).toBeUndefined();
    expect(guard(root, allowed, 'Edit', { file_path: join(root, 'src/b.ts') })).toMatch(
      /not one of this task's files/,
    );
    expect(guard(root, allowed, 'Write', { file_path: 'src/b.ts' })).toMatch(/not one of/);
  });
  it('creates new files, but not in node_modules or .git', () => {
    expect(guard(root, allowed, 'Write', { file_path: 'src/period.ts' })).toBeUndefined();
    expect(guard(root, allowed, 'Write', { file_path: 'node_modules/x.js' })).toMatch(/not one/);
    expect(guard(root, allowed, 'Write', { file_path: '.git/hooks/pre-commit' })).toMatch(/git/);
  });
  it('reads anywhere inside the clone, nothing outside it', () => {
    expect(
      guard(root, allowed, 'Read', { file_path: 'node_modules/stripe/index.d.ts' }),
    ).toBeUndefined();
    expect(guard(root, allowed, 'Grep', { pattern: 'x' })).toBeUndefined();
    expect(guard(root, allowed, 'Read', { file_path: '/etc/passwd' })).toMatch(/outside/);
    expect(guard(root, allowed, 'Glob', { pattern: '*', path: '..' })).toMatch(/outside/);
    expect(guard(root, allowed, 'Read', { file_path: 'escape/hosts' })).toMatch(/escapes/);
  });
  it('has no shell, web or subagents; the checks are the only extra tools', () => {
    for (const tool of ['Bash', 'WebFetch', 'WebSearch', 'Agent', 'NotebookEdit'])
      expect(guard(root, allowed, tool, { command: 'curl example.com' })).toMatch(/not available/);
    expect(guard(root, allowed, 'mcp__uptide__run_tests', {})).toBeUndefined();
    expect(guard(root, allowed, 'StructuredOutput', { changed: [] })).toBeUndefined();
    expect(guard(root, allowed, 'mcp__other__run', {})).toMatch(/not available/);
  });
});

describe('end-of-task gate', () => {
  it('accepts a migration that moved an old error down, and commits it', async () => {
    const { root, sites, record } = await task({
      agent: doing(migrate),
      after: [diag('src/a.ts', 5, 2304, "Cannot find name 'line3'.")],
    });
    expect(record).toMatchObject({ gate: 'accepted', fixed: 1, turns: 3, costUsd: 0.01 });
    expect(sites[0]).toMatchObject({ outcome: 'agent', reason: 'reads the period from the item' });
    expect(git(root, 'status', '--porcelain')).toBe('');
    expect(git(root, 'log', '-1', '--format=%s')).toBe('fix(stripe): subscription-period (agent)');
  });
  it('rejects and reverts an edit outside the allowed files', async () => {
    const { root, sites, record } = await task({
      agent: (r) => {
        migrate(r);
        writeFileSync(join(r, 'src/other.ts'), 'export const x = 2;\n');
        return summary();
      },
      after: [],
    });
    expect(record).toMatchObject({ gate: 'rejected', fixed: 0 });
    expect(record?.rejection).toMatch(/outside the task: src\/other\.ts/);
    expect(sites[0]?.outcome).toBe('manual');
    expect(sites[0]?.reason).toMatch(/^SDK agent rejected/);
    expect(git(root, 'status', '--porcelain')).toBe('');
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe(ORIGINAL);
  });
  it('allows a new file only when the agent declares it', async () => {
    const write = (root: string) => {
      migrate(root);
      writeFileSync(join(root, 'src/period.ts'), 'export const period = 1;\n');
    };
    const undeclared = await task({ agent: doing(write), after: [] });
    expect(undeclared.record?.rejection).toMatch(/did not declare: src\/period\.ts/);
    expect(git(undeclared.root, 'status', '--porcelain')).toBe('');
    const declared = await task({
      agent: doing(write, summary({ newFiles: ['src/period.ts'] })),
      after: [],
    });
    expect(declared.record?.gate).toBe('accepted');
  });
  it('rejects a new type error, a silenced compiler and a new test failure', async () => {
    const typed = await task({
      agent: doing(migrate),
      after: [diag('src/a.ts', 4, 2322, "Type 'number' is not assignable to type 'Date'.")],
    });
    expect(typed.record?.rejection).toMatch(/new type errors: src\/a\.ts:4 TS2322/);
    const silenced = await task({
      agent: doing((r) =>
        writeFileSync(join(r, 'src/a.ts'), '// @ts-ignore\nsub.current_period_end\n'),
      ),
      after: [],
    });
    expect(silenced.record?.rejection).toMatch(/silences the compiler/);
    const tested = await task({
      agent: doing(migrate),
      after: [],
      tests: [{ workspace: '.', status: 'failed', output: 'FAIL src/new.test.ts' }],
    });
    expect(tested.record?.rejection).toMatch(/tests fail/);
    // A failure already there when the task started (the upgrade itself) is not the agent's.
    const old = await task({
      agent: doing(migrate),
      after: [],
      startTests: [{ workspace: '.', status: 'failed', output: 'FAIL src/old.test.ts' }],
      tests: [{ workspace: '.', status: 'failed', output: 'FAIL src/old.test.ts' }],
    });
    expect(old.record?.gate).toBe('accepted');
  });
  it("keeps the site manual, in the agent's own words, when it changes nothing", async () => {
    const { sites, record } = await task({
      agent: () => summary({ changed: [], couldNotDo: ['the period needs a product decision'] }),
      after: [],
    });
    expect(record?.gate).toBe('no-change');
    expect(sites[0]?.reason).toMatch(/made no change; agent: the period needs a product decision/);
  });
});

describe('batched gate', () => {
  it('gates single-site tasks together, then one at a time when the batch fails', async () => {
    const root = repo({ 'src/a.ts': 'old a\n', 'src/b.ts': 'old b\n', 'src/c.ts': 'c\n' });
    // A compiler stand-in that reads the files: `old` is a site error, `BAD` a new one.
    const diagnostics = () =>
      ['src/a.ts', 'src/b.ts'].flatMap((file) => {
        const text = readFileSync(join(root, file), 'utf8');
        return [
          ...(text.includes('old') ? [diag(file, 1, 2339, `old in ${file}`)] : []),
          ...(text.includes('BAD') ? [diag(file, 2, 2322, 'bad')] : []),
        ];
      });
    const sites = ['a', 'b'].map((n) => ({
      ...site(`src/${n}.ts`, 1, diag(`src/${n}.ts`, 1, 2339, `old in src/${n}.ts`)),
      rule: n,
    }));
    const ran2: string[][] = [];
    const llm = await assistWithSdk({
      root,
      workspaces: ['.'],
      sites,
      pack,
      context: { from: '1.0.0', to: '2.0.0', includeDeprecated: false },
      model: 'claude-sonnet-5-5',
      maxCostUsd: 1,
      diagnostics,
      tests: async (files) => {
        ran2.push(files);
        return [{ workspace: '.', status: 'passed', output: '' }];
      },
      lint: async () => [],
      format: async () => [],
      baselineTests: [{ workspace: '.', status: 'passed', output: '' }],
      baselineLint: [],
      affected: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      runner: async ({ root, task }) => {
        const file = task.files[0] as string;
        writeFileSync(join(root, file), task.rule === 'a' ? 'new a\n' : 'new b\nBAD\n');
        return ran(summary({ changed: [{ file, what: `migrated ${file}` }] }));
      },
    });
    expect(llm.tasks?.map((t) => [t.rule, t.gate, t.batch])).toEqual([
      ['a', 'accepted', 2],
      ['b', 'rejected', 2],
    ]);
    expect(llm.tasks?.[1]?.rejection).toMatch(/new type errors: src\/b\.ts:2 TS2322/);
    expect(sites.map((s) => s.outcome)).toEqual(['agent', 'manual']);
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe('new a\n');
    expect(readFileSync(join(root, 'src/b.ts'), 'utf8')).toBe('old b\n');
    expect(git(root, 'log', '--format=%s', '-2')).toBe('fix(stripe): a (agent)\nbase');
    expect(git(root, 'status', '--porcelain')).toBe('');
    // Only the tests that can see the task's own file ran; c.ts never asked for any.
    expect(ran2).toEqual([['src/a.ts']]);
  });

  it('runs the start-of-task tests only to explain a failure, and restores the tree after', async () => {
    const { root, record } = await task({
      agent: doing(migrate),
      after: [],
      startTests: [{ workspace: '.', status: 'failed', output: 'FAIL src/old.test.ts' }],
      tests: [{ workspace: '.', status: 'failed', output: 'FAIL src/old.test.ts' }],
    });
    expect(record?.gate).toBe('accepted');
    expect(git(root, 'status', '--porcelain')).toBe('');
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toContain('sub.items.data[0]');
  });
});

describe('planTasks', () => {
  it('lets a task edit the repository declarations its site errors point at', () => {
    const d = {
      ...diag(
        'src/app.tsx',
        2,
        2322,
        "Type 'RefObject<HTMLInputElement | null>' is not assignable",
      ),
      relatedDeclarations: [
        { file: 'src/search.tsx', line: 3, endLine: 3, message: 'declared here' },
        { file: 'node_modules/@types/react/index.d.ts', line: 1, endLine: 1, message: 'x' },
      ],
    };
    const [task] = planTasks(
      [{ ...site('src/app.tsx', 2, d), rule: 'TS2322' }],
      {
        from: '18.2.0',
        to: '19.3.0',
        includeDeprecated: false,
        helpers: [{ name: 'h', file: 'src/h.ts', specifiers: {} }],
      },
      [d],
    );
    expect(task?.files).toEqual(['src/app.tsx', 'src/h.ts', 'src/search.tsx']);
  });
});

describe('taskPrompt', () => {
  it("gives a Stripe period task the pack's knowledge and decisions, and no code spelling", () => {
    const prompt = taskPrompt({
      pack: stripePack,
      context: {
        from: '17.7.0',
        to: '23.0.0',
        includeDeprecated: false,
        apiVersions: { from: '2026-07-29.dahlia', to: '2026-08-26.dahlia' },
      },
      task: {
        id: 'subscription-period',
        rule: 'subscription-period',
        files: ['pages/api/webhooks/stripe.ts'],
        sites: [
          site(
            'pages/api/webhooks/stripe.ts',
            2,
            diag('pages/api/webhooks/stripe.ts', 2, 2339, 'x'),
          ),
        ],
      },
      conventions: [],
    });
    expect(prompt).toMatch(
      /Webhook payloads follow the API version configured on the webhook endpoint/,
    );
    expect(prompt).toMatch(/reads both shapes/);
    expect(prompt).not.toMatch(/import \{ subscriptionPeriod \} from/);
  });
});

describe('--agent sdk', () => {
  it('refuses non-Anthropic providers before touching the repository', async () => {
    const root = repo({ 'package.json': '{}' });
    const services = {
      check: async () => {
        throw new Error('should not get this far');
      },
      install: async () => {},
      diagnostics: () => [],
      tests: async () => [],
    };
    for (const provider of ['openai', 'gemini'])
      await expect(
        fix({ cwd: root, only: 'zod', agent: 'sdk', provider }, services),
      ).rejects.toMatchObject({
        code: 'NO_FIXER',
        message: `--agent sdk runs on Anthropic models only; ${provider} keeps the default agent`,
      });
    expect(git(root, 'status', '--porcelain')).toBe('');
  });
});
