import { existsSync, readFileSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ts } from 'ts-morph';
import type { ProgressListener } from '../domain/progress.js';
import type { MigrationPack, PackContext } from '../packs/types.js';
import { git } from './process.js';
import { commit, safeFile } from './settle.js';
import { formatFiles, lintFiles } from './style.js';
import type {
  AgentSummary,
  AgentTaskRecord,
  FixDiagnostic,
  FixReport,
  FixSite,
  LintResult,
  TestResult,
} from './types.js';
import { markPreexisting, newDiagnosticsAcrossShifts, unplacedKey } from './verify.js';

/**
 * Experimental (`--agent sdk`): assisted fixes run as Claude Agent SDK sessions in the
 * temporary clone, one task per pack rule over every file that rule touches, judged once at
 * the end of each task. Anthropic only; the patch agent (assisted.ts) stays the default.
 */

/** One unit of work: a pack rule and the sites it has across a group of files. */
export interface AgentTask {
  id: string;
  rule: string;
  sites: FixSite[];
  /** Repository-relative files the agent may edit; new files it declares are also allowed. */
  files: string[];
}
/** One session's result, from the SDK or from a test double. */
export interface TaskRun {
  summary?: AgentSummary;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  toolCalls: Record<string, number>;
  stop?: string;
}
/** The checks the agent can call, bound to the task: Uptide's own judges, not a shell. */
export interface TaskChecks {
  types(): string;
  lint(): Promise<string>;
  tests(): Promise<string>;
}
export type TaskRunner = (input: {
  root: string;
  task: AgentTask;
  prompt: string;
  model: string;
  maxBudgetUsd: number;
  maxTurns: number;
  checks: TaskChecks;
}) => Promise<TaskRun>;

export interface SdkAssistInput {
  root: string;
  workspaces: string[];
  sites: FixSite[];
  pack: MigrationPack;
  context: PackContext;
  model: string;
  maxCostUsd: number;
  diagnostics: () => FixDiagnostic[];
  /** Tests on these repository-relative files, as the run's `services.tests`. */
  tests: (files: string[]) => Promise<TestResult[]>;
  lint?: (files: string[], baseline?: LintResult[]) => Promise<LintResult[]>;
  /** The repository's formatter, run on the edited files before lint, as `settle` does. */
  format?: (files: string[]) => Promise<string[]>;
  baselineTests: TestResult[];
  baselineLint: LintResult[];
  /** Files with sites before the agent ran: what the tests relate to. */
  affected: string[];
  onProgress?: ProgressListener;
  /** Injected by tests; the Agent SDK otherwise. */
  runner?: TaskRunner;
}

/**
 * Sites the rules left manual, one task per rule: a rule's sites share one change. The files
 * are the sites', the placed helpers', and the repository declarations the compiler links to
 * a site's error: a `RefObject<T | null>` error is fixed in the prop type it names.
 */
export function planTasks(
  sites: FixSite[],
  context: PackContext,
  diagnostics: FixDiagnostic[] = [],
): AgentTask[] {
  const byRule = new Map<string, FixSite[]>();
  for (const site of sites) {
    if (site.outcome !== 'manual') continue;
    const rule = site.rule ?? 'other';
    byRule.set(rule, [...(byRule.get(rule) ?? []), site]);
  }
  const helpers = (context.helpers ?? []).map((h) => h.file);
  const declarations = (site: FixSite) => {
    const u = site.finding.usage;
    return diagnostics
      .filter((d) => d.file === u.file && (d.line === u.line || d.message === u.compileError))
      .flatMap((d) => (d.relatedDeclarations ?? []).map((r) => r.file))
      .filter((f) => !f.split(/[\\/]/).includes('node_modules'));
  };
  return [...byRule].map(([rule, list]) => ({
    id: rule,
    rule,
    sites: list,
    files: [
      ...new Set([...list.flatMap((s) => [s.finding.usage.file, ...declarations(s)]), ...helpers]),
    ].sort(),
  }));
}

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);
export const CHECK_TOOLS = ['check_types', 'run_lint', 'run_tests'].map((n) => `mcp__uptide__${n}`);

/**
 * Whether a tool call stays inside the task: a reason to deny it, or undefined to allow.
 * Reads anywhere in the clone (dependency declarations included), edits only to the task's
 * files, new files anywhere outside `.git` and `node_modules`, and Uptide's three checks.
 * Every other tool, the shell included, is denied.
 */
export function guard(
  root: string,
  allowed: readonly string[],
  tool: string,
  input: Record<string, unknown>,
): string | undefined {
  // StructuredOutput is how the session hands back its summary (`outputFormat`).
  if (CHECK_TOOLS.includes(tool) || tool === 'StructuredOutput') return undefined;
  if (!READ_TOOLS.has(tool) && tool !== 'Edit' && tool !== 'Write')
    return `${tool} is not available in this task`;
  const raw = input.file_path ?? input.path ?? '.';
  if (typeof raw !== 'string') return `${tool} needs a path`;
  const rel = relative(root, resolve(root, raw));
  if (rel.startsWith('..') || isAbsolute(rel)) return `${raw} is outside the repository`;
  const parts = rel.split(/[\\/]/);
  if (parts.includes('.git')) return 'git metadata is off limits';
  // A symlink inside the clone must not lead out of it.
  if (rel && existsSync(join(root, rel)))
    try {
      safeFile(root, rel);
    } catch (err) {
      return (err as Error).message;
    }
  if (READ_TOOLS.has(tool)) return undefined;
  if (allowed.includes(rel)) return undefined;
  if (tool === 'Write' && !existsSync(join(root, rel)) && !parts.includes('node_modules'))
    return undefined;
  return `${rel} is not one of this task's files (${allowed.join(', ')}); say what it needs in couldNotDo`;
}

/** Paths changed in the working tree since the last commit, repository-relative. */
function changedPaths(root: string): { modified: string[]; added: string[] } {
  const list = (...args: string[]) =>
    git(root, ...args)
      .split('\n')
      .filter(Boolean);
  return {
    modified: list('diff', '--name-only', '--no-renames', 'HEAD'),
    added: list('ls-files', '--others', '--exclude-standard'),
  };
}
// The patch gate's own refusals: silencing the compiler is not a migration.
const ESCAPES = /@ts-ignore|@ts-nocheck|@ts-expect-error|\bas any\b|\bas unknown as\b/;

/**
 * What a task's own edits must satisfy before anything runs: only the task's files plus the
 * new files the agent declared, and no compiler escape hatches. Returns why not, or undefined.
 */
export function editRules(
  root: string,
  task: AgentTask,
  summary: AgentSummary | undefined,
): string | undefined {
  const { modified, added } = changedPaths(root);
  const outside = modified.filter((f) => !task.files.includes(f));
  if (outside.length) return `edited files outside the task: ${outside.join(', ')}`;
  const declared = new Set(summary?.newFiles ?? []);
  const undeclared = added.filter((f) => !declared.has(f) && !task.files.includes(f));
  if (undeclared.length) return `created files it did not declare: ${undeclared.join(', ')}`;
  const diff = git(root, 'diff', '--no-color', '-U0', 'HEAD');
  const addedLines = [
    ...diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')),
    ...added.flatMap((f) => readFileSync(join(root, f), 'utf8').split('\n')),
  ];
  const silenced = addedLines.find((l) => ESCAPES.test(l));
  if (silenced) return `silences the compiler: ${silenced.replace(/^\+/, '').trim()}`;
  return undefined;
}

/**
 * Single-site rules share one gate, run after all of them; a rule with several sites has its
 * own. Fewer type and test runs for the many one-line changes a zod or React upgrade has.
 */
export function batches(tasks: AgentTask[]): AgentTask[][] {
  const singles = tasks.filter((t) => t.sites.length === 1);
  return [
    ...tasks.filter((t) => t.sites.length > 1).map((t) => [t]),
    ...(singles.length ? [singles] : []),
  ];
}

/** Facts about how this repository writes imports, for the agent to follow. Not orders. */
export function conventions(root: string, workspaces: string[], files: string[]): string[] {
  const facts: string[] = [];
  for (const workspace of workspaces) {
    const path = join(root, workspace, 'tsconfig.json');
    if (!existsSync(path)) continue;
    const { config } = ts.readConfigFile(path, ts.sys.readFile);
    const o = (config?.compilerOptions ?? {}) as Record<string, unknown>;
    const parts = [
      o.module && `module ${o.module}`,
      o.moduleResolution && `moduleResolution ${o.moduleResolution}`,
      o.baseUrl && `baseUrl ${o.baseUrl}`,
      o.paths && `paths ${Object.keys(o.paths as object).join(', ')}`,
      o.allowImportingTsExtensions && 'allowImportingTsExtensions',
      config?.extends && `extends ${config.extends}`,
    ].filter(Boolean);
    if (parts.length) facts.push(`${join(workspace, 'tsconfig.json')}: ${parts.join('; ')}`);
  }
  const styles = { js: 0, ts: 0, none: 0, alias: 0 };
  for (const file of files) {
    if (!existsSync(join(root, file))) continue;
    for (const [, spec = ''] of readFileSync(join(root, file), 'utf8').matchAll(
      /from\s+['"]([^'"]+)['"]/g,
    )) {
      if (/^[@~#]\//.test(spec)) styles.alias++;
      else if (!spec.startsWith('.')) continue;
      else if (spec.endsWith('.js')) styles.js++;
      else if (/\.tsx?$/.test(spec)) styles.ts++;
      else styles.none++;
    }
  }
  facts.push(
    `imports in the task's files: ${styles.none} relative without extension, ${styles.js} ending in .js, ${styles.ts} ending in .ts, ${styles.alias} through a path alias`,
  );
  return facts;
}

const SUMMARY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['changed', 'newFiles', 'decisions', 'assumptions', 'couldNotDo'],
  properties: {
    changed: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'what'],
        properties: { file: { type: 'string' }, what: { type: 'string' } },
      },
    },
    newFiles: { type: 'array', items: { type: 'string' } },
    decisions: { type: 'array', items: { type: 'string' } },
    assumptions: { type: 'array', items: { type: 'string' } },
    couldNotDo: { type: 'array', items: { type: 'string' } },
  },
};

/** The task as context: findings, changelog, decisions and conventions. No code spellings. */
export function taskPrompt(input: {
  pack: MigrationPack;
  context: PackContext;
  task: AgentTask;
  conventions: string[];
}): string {
  const { pack, context, task } = input;
  const rule = pack.rules.find((r) => r.id === task.rule) as
    | ((typeof pack.rules)[number] & { summary?: string })
    | undefined;
  const sources = (pack as { meta?: { sources?: { title: string; url: string }[] } }).meta?.sources;
  const changelog = (pack.reviewSections?.(context, [task.rule]) ?? []).flatMap((s) => [
    `${s.title}:`,
    ...s.lines,
    ...(s.lists ?? []).flatMap((l) => [l.summary, ...l.items.map((i) => `  - ${i}`)]),
  ]);
  const decisions = pack.decisions?.(context, [task.rule]) ?? [];
  const site = (s: FixSite) => {
    const u = s.finding.usage;
    const c = s.finding.change;
    return [
      `- ${u.file}:${u.line}:${u.column} \`${u.snippet.trim()}\``,
      u.compileError && `  compiler: TS${u.compileCode ?? ''} ${u.compileError}`,
      `  change: ${c.path} (${c.kind})${c.after ? `, now ${c.after}` : ''}`,
      `  why: ${s.finding.reason}`,
      ...(s.finding.details ?? []).map((d) => `  note: ${d}`),
    ]
      .filter(Boolean)
      .join('\n');
  };
  const helpers = (context.helpers ?? []).map(
    (h) =>
      `- ${h.name} in ${h.file} (${Object.entries(h.specifiers)
        .map(([w, s]) => `${w}: ${s}`)
        .join('; ')})`,
  );
  return [
    `Upgrade ${pack.name} from ${context.from} to ${context.to} in this repository: the dependency is already installed at the new version. Your task is one change the upgrade needs: ${task.rule}${rule?.summary ? `, ${rule.summary}` : ''}.`,
    '',
    'Sites Uptide found for this change:',
    ...task.sites.map(site),
    '',
    `Files you may edit: ${task.files.join(', ')}. You may create new files; list each one in newFiles. Edits anywhere else are refused.`,
    ...(rule?.guide ? ['', `What the pack knows about this change: ${rule.guide}`] : []),
    ...(changelog.length ? ['', 'Changelog entries:', ...changelog] : []),
    ...(sources?.length ? ['', 'Sources:', ...sources.map((s) => `- ${s.title}: ${s.url}`)] : []),
    ...(decisions.length
      ? [
          '',
          "Decisions that belong to the repository's owner. Make a reasonable choice, and say which in decisions:",
          ...decisions,
        ]
      : []),
    ...(helpers.length
      ? ['', 'Helpers already in the repository, which you may use:', ...helpers]
      : []),
    '',
    'Repository conventions Uptide detected; follow what the code already does:',
    ...input.conventions.map((c) => `- ${c}`),
    '',
    "Check your work with check_types (errors new since the task started, and those left in the task's files), run_lint (which first formats the changed files with the repository's formatter) and run_tests: they are the repository's own type-check, lint and tests, and the same judges your edits face when you finish. There is no shell, no network, no installs and no git: say in couldNotDo what would need them. Do not silence the compiler (@ts-ignore, @ts-expect-error, as any, as unknown as). Keep behaviour the same except where the upgrade changes it; where data the code relied on may now be missing, handle that explicitly rather than letting it pass silently.",
    '',
    'Finish with the structured summary: what you changed, the decisions you made and the assumptions behind them, and anything you could not do.',
  ].join('\n');
}

const tail = (text: string, max: number) => (text.length > max ? `…${text.slice(-max)}` : text);

/** One task that ran and left a commit, waiting for its gate. */
interface Pending {
  task: AgentTask;
  run: TaskRun;
  record: AgentTaskRecord;
  said: string;
  before: FixDiagnostic[];
  after: FixDiagnostic[];
  touched: string[];
  commit: string;
}

/**
 * Runs every task and gates each batch once it has run (`batches`): types no worse than at
 * the batch's start, lint on what it changed, and the tests related to its files no worse than
 * at its start. A rejected batch of several is retried one task at a time from its start.
 * Returns the report's llm block.
 */
export async function assistWithSdk(input: SdkAssistInput): Promise<FixReport['llm']> {
  const { root, workspaces, pack, context } = input;
  const runner = input.runner ?? sdkRunner;
  let current = input.diagnostics();
  const tasks = planTasks(input.sites, context, current);
  const records: AgentTaskRecord[] = [];
  let spent = 0;
  let started = 0;
  const format = input.format ?? ((files) => formatFiles(root, files));
  // Formatting is the repository's tool's job, not the agent's: lint judges formatted files.
  const lint = async (files: string[]) => {
    await format(files);
    return (input.lint ?? ((f, b) => lintFiles(root, f, b)))(files, input.baselineLint);
  };
  const list = (...args: string[]) =>
    git(root, ...args)
      .split('\n')
      .filter(Boolean);
  const head = () => git(root, 'rev-parse', 'HEAD');
  /** What differs from `base`, committed or not. */
  const since = (base: string) => [
    ...new Set([
      ...list('diff', '--name-only', '--no-renames', base),
      ...list('ls-files', '--others', '--exclude-standard'),
    ]),
  ];
  const reset = (to: string) => {
    // The clone is the run's own: nothing in it is the user's until the run is delivered.
    git(root, 'reset', '--hard', '--quiet', to);
    git(root, 'clean', '-fd', '--quiet');
  };
  /** The tests related to `files`, as they ran at commit `at`, with the work tree put back. */
  const testsAt = async (at: string, files: string[]) => {
    const added = list('diff', '--name-only', '--diff-filter=A', at, 'HEAD');
    git(root, 'checkout', '--quiet', at, '--', '.');
    for (const file of added) rmSync(join(root, file), { force: true });
    try {
      return await input.tests(files);
    } finally {
      git(root, 'checkout', '--quiet', 'HEAD', '--', '.');
    }
  };
  /** Why the work since `start` cannot stay, or undefined. Only what it can affect runs. */
  const judge = async (
    start: string,
    before: FixDiagnostic[],
    after: FixDiagnostic[],
    files: string[],
  ) => {
    const fresh = newDiagnosticsAcrossShifts(before, after);
    if (fresh.length)
      return `new type errors: ${fresh
        .slice(0, 5)
        .map((d) => `${d.file}:${d.line} TS${d.code}`)
        .join(', ')}${fresh.length > 5 ? ` and ${fresh.length - 5} more` : ''}`;
    const changed = since(start);
    const failedLint = (await lint(changed)).filter((l) => l.status === 'failed');
    if (failedLint.length) return `lint fails: ${failedLint.map((l) => l.tool).join(', ')}`;
    const related = [...new Set([...files, ...changed])];
    let tests = await input.tests(related);
    // A failure the batch did not cause was there at its start: run the same tests there, once.
    if (tests.some((t) => t.status === 'failed' || t.status === 'timeout'))
      tests = markPreexisting(tests, await testsAt(start, related));
    const failing = tests.filter(
      (t) => t.status !== 'passed' && t.status !== 'missing' && !t.preexisting,
    );
    if (failing.length)
      return `tests fail: ${failing.map((t) => `${t.workspace} (${t.status})`).join(', ')}`;
    return undefined;
  };
  const accept = (p: Pending) => {
    p.record.gate = 'accepted';
    const left = new Set(p.after.map(unplacedKey));
    for (const s of p.task.sites) {
      const u = s.finding.usage;
      // A site with a compiler error is fixed when that error is gone, wherever the edit was
      // (a prop type in another file); one without, when its file changed.
      const own = p.before.find(
        (d) => d.file === u.file && (d.line === u.line || d.message === u.compileError),
      );
      const stillThere = own ? left.has(unplacedKey(own)) : !p.touched.includes(u.file);
      if (stillThere) {
        s.reason = `SDK agent left this site${p.said ? `; agent: ${p.said}` : ''}`;
        continue;
      }
      s.outcome = 'agent';
      s.reason =
        p.run.summary?.changed.find((c) => c.file === u.file)?.what ?? 'migrated by the SDK agent';
      s.editedFiles = p.touched;
      p.record.fixed++;
    }
  };
  const refuse = (p: Pending, why: string) => {
    p.record.gate = 'rejected';
    p.record.rejection = why;
    for (const s of p.task.sites)
      s.reason = `SDK agent rejected: ${why}${p.said ? `; agent: ${p.said}` : ''}`;
  };
  const show = (d: FixDiagnostic) => `${d.file}:${d.line}:${d.column} TS${d.code} ${d.message}`;

  for (const batch of batches(tasks)) {
    const batchStart = head();
    const batchBefore = current;
    const pending: Pending[] = [];
    for (const task of batch) {
      const share = (input.maxCostUsd - spent) / (tasks.length - started++);
      if (share < 0.02) {
        for (const s of task.sites) s.reason = `${s.reason}; not attempted: --max-cost reached`;
        continue;
      }
      // ponytail: about a cent a turn on Sonnet with a warm cache; measure before tuning.
      const maxTurns = Math.max(10, Math.min(60, Math.round(share * 100)));
      const before = current;
      const taskStart = head();
      const checks: TaskChecks = {
        types: () => {
          const now = input.diagnostics();
          const fresh = newDiagnosticsAcrossShifts(before, now);
          const left = now.filter((d) => task.files.includes(d.file));
          return [
            `${fresh.length} new type error(s) since the task started`,
            ...fresh.slice(0, 40).map(show),
            `${left.length} error(s) in the task's files`,
            ...left.slice(0, 40).map(show),
          ].join('\n');
        },
        lint: async () => {
          const results = await lint(since(taskStart));
          if (!results.length) return 'no lint configured for these files, or nothing changed';
          return results.map((r) => `${r.tool}: ${r.status}\n${tail(r.output, 2000)}`).join('\n');
        },
        tests: async () => {
          const results = await input.tests([...new Set([...task.files, ...since(taskStart)])]);
          if (!results.length) return 'no tests relate to these files';
          return [
            "Tests related to the task's files. A failure may predate the task: the gate compares with the start.",
            ...results.map((t) => `${t.workspace}: ${t.status}\n${tail(t.output, 3000)}`),
          ].join('\n');
        },
      };
      const prompt = taskPrompt({
        pack,
        context,
        task,
        conventions: conventions(root, workspaces, task.files),
      });
      let run: TaskRun;
      let error: string | undefined;
      try {
        run = await runner({
          root,
          task,
          prompt,
          model: input.model,
          maxBudgetUsd: share,
          maxTurns,
          checks,
        });
      } catch (err) {
        error = (err as Error).message;
        run = {
          turns: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          durationMs: 0,
          toolCalls: {},
        };
      }
      spent += run.costUsd;
      const { modified, added } = changedPaths(root);
      const touched = [...modified, ...added];
      const rejection = error ?? (touched.length ? editRules(root, task, run.summary) : undefined);
      const record: AgentTaskRecord = {
        id: task.id,
        rule: task.rule,
        files: task.files,
        sites: task.sites.length,
        fixed: 0,
        ...run,
        gate: error ? 'error' : !touched.length ? 'no-change' : rejection ? 'rejected' : 'accepted',
        ...(rejection ? { rejection } : {}),
        ...(batch.length > 1 ? { batch: batch.length } : {}),
      };
      records.push(record);
      const said = run.summary
        ? [...run.summary.couldNotDo, ...run.summary.decisions].join('; ')
        : (run.stop ?? '');
      if (rejection || !touched.length) {
        reset(taskStart);
        for (const s of task.sites)
          s.reason = `SDK agent ${rejection ? `rejected: ${rejection}` : 'made no change'}${said ? `; agent: ${said}` : ''}`;
        continue;
      }
      commit(
        root,
        `fix(${pack.name}): ${task.rule} (agent)`,
        touched.map((f) => join(root, f)),
      );
      current = input.diagnostics();
      pending.push({ task, run, record, said, before, after: current, touched, commit: head() });
    }
    if (!pending.length) continue;
    const files = (list: Pending[]) => [
      ...new Set(list.flatMap((p) => [...p.task.files, ...p.touched])),
    ];
    const verdict = await judge(batchStart, batchBefore, current, files(pending));
    if (!verdict) {
      for (const p of pending) accept(p);
      continue;
    }
    reset(batchStart);
    current = batchBefore;
    if (pending.length === 1) {
      refuse(pending[0] as Pending, verdict);
      continue;
    }
    // The batch failed together: each task again from the batch's start, gated alone.
    for (const p of pending) {
      const start = head();
      const before = current;
      try {
        git(root, 'cherry-pick', '--allow-empty', p.commit);
      } catch {
        git(root, 'cherry-pick', '--abort');
        refuse(p, 'its edits depend on a task the gate rejected');
        continue;
      }
      const after = input.diagnostics();
      const why = await judge(start, before, after, files([p]));
      if (why) {
        reset(start);
        refuse(p, why);
        continue;
      }
      current = after;
      accept({ ...p, before, after });
    }
  }
  const sum = (key: 'inputTokens' | 'outputTokens' | 'costUsd') =>
    records.reduce((n, r) => n + r[key], 0);
  return {
    provider: 'anthropic',
    model: input.model,
    available: true,
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    costUsd: sum('costUsd'),
    agent: 'sdk',
    tasks: records,
  };
}

/** The Claude Agent SDK, loaded only here: an optional peer the user installs. */
const sdkRunner: TaskRunner = async ({
  root,
  task,
  prompt,
  model,
  maxBudgetUsd,
  maxTurns,
  checks,
}) => {
  let sdk: typeof import('@anthropic-ai/claude-agent-sdk');
  try {
    sdk = await import('@anthropic-ai/claude-agent-sdk');
  } catch {
    throw new Error(
      '--agent sdk needs @anthropic-ai/claude-agent-sdk installed next to uptide (npm install -g @anthropic-ai/claude-agent-sdk)',
    );
  }
  const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
  const server = sdk.createSdkMcpServer({
    name: 'uptide',
    tools: [
      sdk.tool(
        'check_types',
        "The repository's type-check: errors new since the task started, and those in the task's files",
        {},
        async () => text(checks.types()),
      ),
      sdk.tool('run_lint', "The repository's lint on the files changed so far", {}, async () =>
        text(await checks.lint()),
      ),
      sdk.tool('run_tests', "The repository's tests related to the changed files", {}, async () =>
        text(await checks.tests()),
      ),
    ],
  });
  const started = Date.now();
  const toolCalls: Record<string, number> = {};
  let result: Extract<SDKMessage, { type: 'result' }> | undefined;
  try {
    for await (const message of sdk.query({
      prompt,
      options: {
        cwd: root,
        model,
        maxTurns,
        maxBudgetUsd,
        // Only these tools exist in the session: no shell, no web, no subagents.
        tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write'],
        allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', ...CHECK_TOOLS],
        permissionMode: 'dontAsk',
        mcpServers: { uptide: server },
        hooks: {
          PreToolUse: [
            {
              hooks: [
                async (hook) => {
                  const { tool_name, tool_input } = hook as {
                    tool_name: string;
                    tool_input: unknown;
                  };
                  toolCalls[tool_name] = (toolCalls[tool_name] ?? 0) + 1;
                  const reason = guard(
                    root,
                    task.files,
                    tool_name,
                    (tool_input ?? {}) as Record<string, unknown>,
                  );
                  return reason
                    ? {
                        hookSpecificOutput: {
                          hookEventName: 'PreToolUse' as const,
                          permissionDecision: 'deny' as const,
                          permissionDecisionReason: reason,
                        },
                      }
                    : {};
                },
              ],
            },
          ],
        },
        // Nothing from the clone or this machine configures the session: no settings, hooks or CLAUDE.md.
        settingSources: [],
        persistSession: false,
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        outputFormat: { type: 'json_schema', schema: SUMMARY_SCHEMA },
        // Replaces the environment: the key reaches the SDK process and nothing else does.
        env: {
          PATH: process.env.PATH ?? '',
          HOME: process.env.HOME ?? '',
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
          // Telemetry, error reports, surveys and updates off; the two switches it leaves out too.
          // What each covers: docs/privacy.md, "Experimental: fix --agent sdk".
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          DISABLE_FEEDBACK_COMMAND: '1',
          CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
          CLAUDE_AGENT_SDK_CLIENT_APP: 'uptide',
        },
      },
    }))
      if (message.type === 'result') result = message;
  } catch (err) {
    // An error result (the budget reached) is emitted, then thrown: keep what it cost.
    if (!result) throw err;
  }
  if (!result) throw new Error('the SDK session ended without a result');
  const usage = result.usage as unknown as Record<string, number | undefined>;
  return {
    turns: result.num_turns,
    inputTokens:
      (usage.input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0),
    outputTokens: usage.output_tokens ?? 0,
    costUsd: result.total_cost_usd,
    durationMs: Date.now() - started,
    toolCalls,
    ...(result.subtype !== 'success'
      ? { stop: result.subtype }
      : result.structured_output
        ? { summary: result.structured_output as AgentSummary }
        : {}),
  };
};
