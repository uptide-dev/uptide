import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { git } from './process.js';
import { PublishError, publish } from './publish.js';
import type { FixReport } from './types.js';

// A real origin (a bare repository) and real git; only `gh` is faked. The case this covers:
// a closed PR does not delete its branch, so `uptide/<pkg>-<version>` is often already there.
const scratch = mkdtempSync(join(tmpdir(), 'uptide-publish-branch-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const BRANCH = 'uptide/stripe-23.0.0';
const APP = { name: 'uptide-app[bot]', email: '1234+uptide-app[bot]@users.noreply.github.com' };
const LEGACY = { name: 'uptide[bot]', email: 'uptide@users.noreply.github.com' };
const PERSON = { name: 'Alex Doe', email: 'alex@example.com' };
type Who = { name: string; email: string };

function run(cwd: string, who: Who, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: who.name,
      GIT_AUTHOR_EMAIL: who.email,
      GIT_COMMITTER_NAME: who.name,
      GIT_COMMITTER_EMAIL: who.email,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
    },
  }).trim();
}
function commit(cwd: string, who: Who, file: string, text: string): string {
  writeFileSync(join(cwd, file), text);
  run(cwd, who, 'add', file);
  run(cwd, who, 'commit', '--quiet', '-m', `edit ${file}`);
  return run(cwd, who, 'rev-parse', 'HEAD');
}

let origin: string;
let work: string;
let other: string;
/**
 * A verified run: a checkout of main made now, shallow like the Action's, and one commit by
 * the App's bot on BRANCH from it.
 */
function verifiedRun(): FixReport {
  run(other, PERSON, 'checkout', '--quiet', 'main');
  // Main moves on after any earlier branch was made, as it does between runs.
  commit(other, PERSON, 'README.md', `main at ${Date.now()}\n`);
  run(other, PERSON, 'push', '--quiet', 'origin', 'main');
  run(origin, PERSON, 'clone', '--quiet', '--depth', '1', `file://${origin}`, work);
  run(work, APP, 'checkout', '--quiet', '-b', BRANCH, 'main');
  const head = commit(work, APP, 'billing.ts', 'apiVersion: "2025-09-30"\n');
  run(work, APP, 'checkout', '--quiet', 'main');
  return {
    repo: work,
    package: 'stripe',
    target: '23.0.0',
    branch: BRANCH,
    head,
    verification: { passed: true },
    verifiedTree: run(work, APP, 'rev-parse', `${head}^{tree}`),
    prBody: join(work, '.git', 'pr-body.md'),
  } as FixReport;
}
/** Puts `branch` on origin with one commit by `who` on main, the way an earlier run left it. */
function onOrigin(branch: string, who: Who): string {
  run(other, who, 'fetch', '--quiet', 'origin');
  run(other, who, 'checkout', '--quiet', '-B', branch, 'origin/main');
  const sha = commit(other, who, 'billing.ts', `by ${who.name} on ${branch}\n`);
  run(other, who, 'push', '--quiet', '--force', 'origin', `HEAD:refs/heads/${branch}`);
  return sha;
}
const remoteHead = (branch: string): string =>
  run(origin, APP, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);

/** GitHub's compare of main...sha, from the bare origin itself. */
function compare(sha: string): string {
  const log = run(origin, APP, 'log', '--format=%an%x00%ae', sha, '--not', 'main');
  const commits = log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, email] = line.split('\u0000');
      return { commit: { author: { name, email } } };
    });
  return JSON.stringify({ total_commits: commits.length, commits });
}
/** `gh` as GitHub would answer it for `open` (head branch → PR number). */
function fakeGh(open: Record<string, number> = {}) {
  const calls: string[][] = [];
  const printed: string[] = [];
  let body = '## Upgrade stripe\n';
  const io = {
    git,
    print: (text: string) => void printed.push(text),
    readBody: () => body,
    writeBody: (_file: string, text: string) => {
      body = text;
    },
    command: async (_cwd: string, bin: string, args: string[]) => {
      calls.push([bin, ...args]);
      const ok = (output: string) => ({ code: 0, timeout: false, output });
      if (args[0] === 'repo')
        return ok(JSON.stringify({ defaultBranchRef: { name: 'main' }, nameWithOwner: 'o/app' }));
      if (args[0] === 'label') return ok('[{"name":"uptide"}]');
      if (args[0] === 'pr' && args[1] === 'list') {
        const head = args[args.indexOf('--head') + 1] ?? '';
        const n = open[head];
        return ok(
          n ? JSON.stringify([{ number: n, url: `https://github.com/o/app/pull/${n}` }]) : '[]',
        );
      }
      if (args[0] === 'pr' && args[1] === 'create') return ok('https://github.com/o/app/pull/50\n');
      const sha = /^repos\/o\/app\/compare\/main\.\.\.([0-9a-f]{40})$/.exec(args[1] ?? '')?.[1];
      if (args[0] === 'api' && sha) return ok(compare(sha));
      return ok('');
    },
  };
  return { io, calls, printed, body: () => body };
}
const created = (calls: string[][]) => calls.find((c) => c[1] === 'pr' && c[2] === 'create');
const headOf = (call: string[] | undefined) => call?.[call.indexOf('--head') + 1];

describe('publishing when the branch already exists on origin', () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(scratch, 'case-'));
    origin = join(dir, 'origin.git');
    work = join(dir, 'work');
    other = join(dir, 'other');
    run(dir, PERSON, 'init', '--quiet', '--bare', '--initial-branch=main', origin);
    run(dir, PERSON, 'clone', '--quiet', origin, other);
    run(other, PERSON, 'checkout', '--quiet', '-b', 'main');
    commit(other, PERSON, 'billing.ts', 'apiVersion: "2024-06-20"\n');
    run(other, PERSON, 'push', '--quiet', 'origin', 'main');
  });

  it('opens the PR on the branch when origin does not have it', async () => {
    const report = verifiedRun();
    const gh = fakeGh();
    expect(await publish(report, true, gh.io, { cwd: work })).toBe(
      'https://github.com/o/app/pull/50',
    );
    expect(remoteHead(BRANCH)).toBe(report.head);
    expect(headOf(created(gh.calls))).toBe(BRANCH);
  });

  it.each([
    ['the App bot', APP],
    ['the legacy uptide[bot]', LEGACY],
  ])(
    'replaces a branch left by a closed PR when %s made every commit on it, and opens a new PR',
    async (_, who) => {
      const stale = onOrigin(BRANCH, who);
      const report = verifiedRun();
      const gh = fakeGh();
      expect(await publish(report, true, gh.io, { cwd: work })).toBe(
        'https://github.com/o/app/pull/50',
      );
      expect(remoteHead(BRANCH)).toBe(report.head);
      expect(headOf(created(gh.calls))).toBe(BRANCH);
      expect(gh.body()).toBe('## Upgrade stripe\n');
      expect(gh.printed.join('\n')).toContain(
        `${BRANCH} is on origin at ${stale.slice(0, 12)} with Uptide's commits only; replacing it`,
      );
    },
  );

  it('updates the open Uptide PR on the branch instead of opening a second one', async () => {
    onOrigin(BRANCH, APP);
    const report = verifiedRun();
    const gh = fakeGh({ [BRANCH]: 41 });
    expect(await publish(report, true, gh.io, { cwd: work })).toBe(
      'https://github.com/o/app/pull/41',
    );
    expect(remoteHead(BRANCH)).toBe(report.head);
    expect(created(gh.calls)).toBeUndefined();
    expect(gh.calls).toContainEqual([
      'gh',
      'pr',
      'edit',
      '41',
      '--repo',
      'o/app',
      '--body-file',
      report.prBody,
    ]);
  });

  it("never overwrites someone else's commit: publishes on the next free numbered branch and says so in the PR", async () => {
    const theirs = onOrigin(BRANCH, PERSON);
    // A branch that is Uptide's on top of a person's commit is still theirs.
    run(other, APP, 'checkout', '--quiet', '-B', `${BRANCH}-2`, `origin/${BRANCH}`);
    commit(other, APP, 'billing.ts', 'on top\n');
    run(other, APP, 'push', '--quiet', 'origin', `HEAD:refs/heads/${BRANCH}-2`);
    const second = remoteHead(`${BRANCH}-2`);
    const report = verifiedRun();
    const gh = fakeGh({ [BRANCH]: 41 });
    expect(await publish(report, true, gh.io, { cwd: work })).toBe(
      'https://github.com/o/app/pull/50',
    );
    expect(remoteHead(BRANCH)).toBe(theirs);
    expect(remoteHead(`${BRANCH}-2`)).toBe(second);
    expect(remoteHead(`${BRANCH}-3`)).toBe(report.head);
    expect(headOf(created(gh.calls))).toBe(`${BRANCH}-3`);
    expect(gh.calls.some((c) => c[2] === 'edit')).toBe(false);
    expect(gh.body()).toBe(
      `> Published on \`${BRANCH}-3\`: \`${BRANCH}\` already exists with commits from someone else (Alex Doe), and Uptide never overwrites them.\n\n## Upgrade stripe\n`,
    );
    // Run again: the numbered branch is now Uptide's own, at the verified commit, with its PR.
    const again = fakeGh({ [BRANCH]: 41, [`${BRANCH}-3`]: 50 });
    expect(await publish(report, true, again.io, { cwd: work })).toBe(
      'https://github.com/o/app/pull/50',
    );
    expect(created(again.calls)).toBeUndefined();
    expect(again.calls.some((c) => c.includes('push'))).toBe(false);
  });

  it('pushes over nothing it did not read: a commit that lands after the check fails the push, with the reason', async () => {
    onOrigin(BRANCH, APP);
    const report = verifiedRun();
    const gh = fakeGh();
    const io = {
      ...gh.io,
      git: (cwd: string, ...args: string[]) => {
        if (args[0] === 'push') onOrigin(BRANCH, PERSON);
        return git(cwd, ...args);
      },
    };
    const error = await publish(report, true, io, { cwd: work }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PublishError);
    expect(error).toMatchObject({
      code: 'PUBLICATION_FAILED',
      reason: 'the branch on GitHub changed while it was being published',
    });
    expect(remoteHead(BRANCH)).not.toBe(report.head);
    expect(created(gh.calls)).toBeUndefined();
  });
});
