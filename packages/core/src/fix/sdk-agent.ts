import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ts } from 'ts-morph';
import type { ProgressListener } from '../domain/progress.js';
import { modelCapabilities } from '../llm/capabilities.js';
import { packDecisions } from '../packs/decisions.js';
import type { MigrationPack, PackContext } from '../packs/types.js';
import { git } from './process.js';
import { commit, followedText, safeFile } from './settle.js';
import { formatFiles, lintFiles } from './style.js';
import { isTestFile, testEditObjection } from './test-edits.js';
import type {
  AgentSummary,
  AgentTaskRecord,
  FixDiagnostic,
  FixReport,
  FixSite,
  LintResult,
  TestResult,
} from './types.js';
import { gitLineMoves, markPreexisting, newDiagnostics, unplacedKey } from './verify.js';

/**
 * The Anthropic default: assisted fixes run as Claude Agent SDK sessions in the
 * temporary clone, one session for the package's manual sites, judged once at
 * the end of each task. Other providers use the patch agent (assisted.ts).
 */

/** One session: the package's manual sites, over their editable files. */
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
  unreportedCostUsd?: number;
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
  /** The agent's own `run_tests`, when it may run less than the gate; the gate runs `tests`. */
  checkTests?: (files: string[]) => Promise<TestResult[]>;
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
  /** Repository-wide fallback or verification feedback, after the site session. */
  task?: AgentTask;
  feedback?: string;
}

/**
 * Sites the rules left manual share one session, avoiding per-rule prompts and repeated checks. The files
 * are the sites', the placed helpers', and the repository declarations the compiler links to
 * a site's error: a `RefObject<T | null>` error is fixed in the prop type it names.
 */
export function planTasks(
  sites: FixSite[],
  context: PackContext,
  diagnostics: FixDiagnostic[] = [],
): AgentTask[] {
  const manual = sites.filter((site) => site.outcome === 'manual');
  if (!manual.length) return [];
  const rule = [...new Set(manual.map((site) => site.rule ?? 'other'))].join(', ');
  const helpers = (context.helpers ?? []).map((h) => h.file);
  const declarations = (site: FixSite) => {
    const u = site.finding.usage;
    return diagnostics
      .filter((d) => d.file === u.file && (d.line === u.line || d.message === u.compileError))
      .flatMap((d) => (d.relatedDeclarations ?? []).map((r) => r.file))
      .filter((f) => !f.split(/[\\/]/).includes('node_modules'));
  };
  return [
    {
      id: rule,
      rule,
      sites: manual,
      files: [
        ...new Set([
          ...manual.flatMap((s) => [s.finding.usage.file, ...declarations(s)]),
          ...helpers,
        ]),
      ].sort(),
    },
  ];
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
  // Check existing ancestors too: a new file can otherwise follow a symlink out of the clone.
  if (rel)
    try {
      let existing = resolve(root, rel);
      while (existing !== root && !lstatSync(existing, { throwIfNoEntry: false }))
        existing = dirname(existing);
      if (existing !== root) {
        const actual = realpathSync(safeFile(root, relative(root, existing)));
        const resolvedParts = relative(realpathSync(root), actual).split(/[\\/]/);
        if (resolvedParts.includes('.git')) return 'git metadata is off limits';
        if (!READ_TOOLS.has(tool) && resolvedParts.includes('node_modules'))
          return 'node_modules is read-only';
      }
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

/** The agent's declared new files as `git status` names them: `./a.ts` and `/abs/a.ts` are `a.ts`. */
export function declaredFiles(root: string, summary: AgentSummary | undefined): string[] {
  return (summary?.newFiles ?? []).map((f) =>
    relative(root, resolve(root, f)).split('\\').join('/'),
  );
}

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
  const declared = new Set(declaredFiles(root, summary));
  const undeclared = added.filter((f) => !declared.has(f) && !task.files.includes(f));
  if (undeclared.length) return `created files it did not declare: ${undeclared.join(', ')}`;
  for (const file of [...modified, ...added].filter(isTestFile)) {
    const objection = testEditObjection(
      file,
      added.includes(file) ? '' : git(root, 'show', `HEAD:${file}`),
      existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8') : '',
      summary?.changed.find((change) => change.file === file)?.what,
    );
    if (objection) return objection;
  }
  const diff = git(root, 'diff', '--no-color', '-U0', 'HEAD');
  const addedLines = [
    ...diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')),
    ...added.flatMap((f) => readFileSync(join(root, f), 'utf8').split('\n')),
  ];
  if (inputProtected(task)) {
    const protectedEdit = [...modified, ...added].find(
      (file) => protectedFile(file) && !isTestFile(file),
    );
    if (protectedEdit) return `verification configuration is read-only: ${protectedEdit}`;
  }
  const silenced = addedLines.find(
    (l) => ESCAPES.test(l) || (inputProtected(task) && /\bany\b/.test(l)),
  );
  if (silenced) return `silences the compiler: ${silenced.replace(/^\+/, '').trim()}`;
  return undefined;
}

/** Feedback protects verification inputs; test expectations have a separate review guard. */
export function protectedFile(file: string): boolean {
  return /(?:^|\/)(?:__tests__|tests?|specs?|fixtures?|__fixtures__)(?:\/|$)|\.(?:test|spec)\.|(?:^|\/)(?:package\.json|.*lock.*|tsconfig[^/]*|[^/]*(?:vitest|jest|eslint|biome)[^/]*|uptide\.ya?ml)$/.test(
    file,
  );
}
const inputProtected = (task: AgentTask) => task.id.startsWith('verification-');

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
  const ruleIds = [...new Set(task.sites.map((s) => s.rule ?? task.rule))];
  const rules = pack.rules.filter((r) => ruleIds.includes(r.id));
  const sources = (pack as { meta?: { sources?: { title: string; url: string }[] } }).meta?.sources;
  const changelog = (pack.reviewSections?.(context, ruleIds) ?? []).flatMap((s) => [
    `${s.title}:`,
    ...s.lines,
    ...(s.lists ?? []).flatMap((l) => [l.summary, ...l.items.map((i) => `  - ${i}`)]),
  ]);
  const decisions = packDecisions(pack, context, ruleIds) ?? [];
  const site = (s: FixSite) => {
    const u = s.finding.usage;
    const c = s.finding.change;
    return [
      `- ${u.file}:${u.line}:${u.column} \`${u.snippet.trim()}\``,
      u.compileError && `  compiler: TS${u.compileCode ?? ''} ${u.compileError}`,
      `  change: ${c.path} (${c.kind}, rule ${s.rule ?? task.rule})${c.after ? `, now ${c.after}` : ''}`,
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
    `Upgrade ${pack.name} from ${context.from} to ${context.to} in this repository: the dependency is already installed at the new version. Your task covers these upgrade rules: ${task.rule}.`,
    '',
    'Sites Uptide found for this change:',
    ...task.sites.map(site),
    '',
    `Files you may edit: ${task.files.join(', ')}. You may create new files; list each one in newFiles. Edits anywhere else are refused.`,
    ...rules.flatMap((rule) => ['', `What the pack knows about ${rule.id}: ${rule.guide}`]),
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
    "Read independent files together and make related edits together. Check types and lint before running tests: check_types shows errors new since the task started and those left in the task's files; run_lint first formats the changed files; run_tests checks the task's files. Finish edits, including comments, before the final checks, and repeat tests only after further edits. These are the repository's own checks and the same judges your edits face when you finish. There is no shell, no network, no installs and no git: say in couldNotDo what would need them. Do not silence the compiler (@ts-ignore, @ts-expect-error, as any, as unknown as). Keep behaviour the same except where the upgrade changes it; where data the code relied on may now be missing, handle that explicitly rather than letting it pass silently.",
    '',
    'For every choice between options in a rule guide, include in decisions what you chose, why, the alternatives and what the owner should confirm. Name the affected files and number of calls. Do not bury choices only in assumptions or couldNotDo.',
    'Finish with the structured summary: what you changed, the decisions you made and the assumptions behind them, and anything you could not do.',
  ].join('\n');
}

const tail = (text: string, max: number) => (text.length > max ? `…${text.slice(-max)}` : text);

/** One task that ran and left a commit, waiting for its gate. */
interface Pending {
  start: string;
  task: AgentTask;
  run: TaskRun;
  record: AgentTaskRecord;
  said: string;
  before: FixDiagnostic[];
  after: FixDiagnostic[];
  touched: string[];
}

/**
 * Runs the session and gates its edits: no new type errors, lint failures or related-test
 * failures compared with its start. Rejected edits are restored together.
 * Returns the report's llm block.
 */
export async function assistWithSdk(input: SdkAssistInput): Promise<FixReport['llm']> {
  const { root, workspaces, pack, context } = input;
  const runner = input.runner ?? sdkRunner;
  let current = input.diagnostics();
  const tasks = input.task ? [input.task] : planTasks(input.sites, context, current);
  const records: AgentTaskRecord[] = [];
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
  const testCache = new Map<string, TestResult[]>();
  const runTests = async (start: string, files: string[], check = false) => {
    const run = (check && input.checkTests) || input.tests;
    const key = () => {
      const hash = createHash('sha256')
        .update(JSON.stringify([start, [...new Set(files)].sort(), run === input.tests]))
        .update(git(root, 'diff', '--binary', start));
      for (const file of list('ls-files', '--others', '--exclude-standard').sort())
        hash.update(JSON.stringify([file, readFileSync(join(root, file)).toString('base64')]));
      return hash.digest('hex');
    };
    const before = key();
    const cached = testCache.get(before);
    if (cached) return cached;
    const results = await run(files);
    // Test commands can generate or rewrite files; only reuse a result for an unchanged tree.
    if (key() === before) testCache.set(before, results);
    return results;
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
  /**
   * The tests with the pack's follow-ups for `sites` in place (a test asserting the constant a
   * site changed), put back afterwards: `fix` applies and reports them itself, after the agent.
   */
  const withFollowUps = async <T>(sites: FixSite[], work: (files: string[]) => Promise<T>) => {
    const edits = sites.flatMap(
      (s) => pack.followUps?.({ root, workspaces, finding: s.finding, context }) ?? [],
    );
    const saved = new Map<string, string>();
    for (const name of new Set(edits.map((e) => e.file))) {
      const file = safeFile(root, name);
      const text = readFileSync(file, 'utf8');
      const followed = followedText(
        text,
        edits.filter((e) => e.file === name),
      );
      if (followed === undefined) continue;
      saved.set(file, text);
      writeFileSync(file, followed);
    }
    try {
      return await work(edits.map((e) => e.file));
    } finally {
      for (const [file, text] of saved) writeFileSync(file, text);
    }
  };
  /** Why the work since `start` cannot stay, or undefined. Only what it can affect runs. */
  const judge = async (
    start: string,
    before: FixDiagnostic[],
    after: FixDiagnostic[],
    files: string[],
    sites: FixSite[],
  ) => {
    // An error a line move explains is the old one (`gitLineMoves`): lines the batch edited stay put.
    const fresh = newDiagnostics(before, after, gitLineMoves(root, start));
    if (fresh.length)
      return `new type errors: ${fresh
        .slice(0, 5)
        .map((d) => `${d.file}:${d.line} TS${d.code}`)
        .join(', ')}${fresh.length > 5 ? ` and ${fresh.length - 5} more` : ''}`;
    const changed = since(start);
    const failedLint = (await lint(changed)).filter((l) => l.status === 'failed');
    if (failedLint.length) return `lint fails: ${failedLint.map((l) => l.tool).join(', ')}`;
    const related = [...new Set([...files, ...changed])];
    // A test file the parent already failed is not the batch's, whatever scope ran it here; the
    // start alone cannot say so when a build in the test script fails on the error being fixed.
    let tests = markPreexisting(
      await withFollowUps(sites, (followed) => runTests(start, [...related, ...followed])),
      input.baselineTests,
      { anyCommand: true },
    );
    // A failure the batch did not cause was there at its start: run the same tests there, once.
    if (tests.some((t) => (t.status === 'failed' || t.status === 'timeout') && !t.preexisting))
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
    p.record.diffs = Object.fromEntries(
      p.touched.map((file) => [
        file,
        git(root, 'diff', '--no-ext-diff', '--unified=3', p.start, '--', file),
      ]),
    );
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
      s.diff = p.record.diffs[u.file] || Object.values(p.record.diffs).filter(Boolean).join('\n');
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

  for (const task of tasks) {
    const share = input.maxCostUsd;
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
        const fresh = newDiagnostics(before, now, gitLineMoves(root, taskStart));
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
        const results = await runTests(
          taskStart,
          [...new Set([...task.files, ...since(taskStart)])],
          true,
        );
        if (!results.length) return 'no tests relate to these files';
        return [
          "Tests related to the task's files. A failure may predate the task: the gate compares with the start.",
          ...results.map((t) => `${t.workspace}: ${t.status}\n${tail(t.output, 3000)}`),
        ].join('\n');
      },
    };
    const prompt = [
      taskPrompt({
        pack,
        context,
        task,
        conventions: conventions(root, workspaces, task.files),
      }),
      input.feedback ?? '',
      'Never weaken or skip tests. Only static expected values in existing exact assertions may change for changed upgrade behavior; explain why for each test file in changed.what. Such edits are flagged as Tests changed: review. Never introduce any or TypeScript suppression directives.',
    ].join('\n\n');
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
        unreportedCostUsd: share,
        durationMs: 0,
        toolCalls: {},
      };
    }
    const { modified, added } = changedPaths(root);
    const declared = declaredFiles(root, run.summary);
    const discardedFiles = run.summary ? added.filter((file) => !declared.includes(file)) : [];
    // Only declared additions enter the gate; scratch files must not forfeit otherwise valid edits.
    for (const file of discardedFiles) rmSync(join(root, file));
    const touched = [...modified, ...added.filter((file) => !discardedFiles.includes(file))];
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
      ...(discardedFiles.length ? { discardedFiles } : {}),
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
    const pending: Pending = {
      start: taskStart,
      task,
      run,
      record,
      said,
      before,
      after: current,
      touched,
    };
    const verdict = await judge(
      taskStart,
      before,
      current,
      [...new Set([...task.files, ...touched])],
      task.sites,
    );
    if (verdict) {
      reset(taskStart);
      current = before;
      refuse(pending, verdict);
    } else accept(pending);
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
    unreportedCostUsd: records.reduce((sum, r) => sum + (r.unreportedCostUsd ?? 0), 0),
    agent: 'sdk',
    tasks: records,
  };
}

/** The Claude Agent SDK: an optional peer, external to the bundle, loaded only here. */
const loadSdk = () => import('@anthropic-ai/claude-agent-sdk');

/** Whether the default may use the SDK; without it the default is the patch agent. */
export async function sdkInstalled(): Promise<boolean> {
  try {
    await loadSdk();
    return true;
  } catch {
    return false;
  }
}

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
    sdk = await loadSdk();
  } catch {
    throw new Error(
      '--agent sdk needs @anthropic-ai/claude-agent-sdk installed next to uptide (npm install -g @anthropic-ai/claude-agent-sdk), or use --agent patch',
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
        effort: modelCapabilities('anthropic', model).defaultEffort,
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
          // What each covers: docs/privacy.md, "Agent SDK executor".
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
