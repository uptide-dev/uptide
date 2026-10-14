import { readFileSync, writeFileSync } from 'node:fs';
import { FALLBACK_IDENTITY } from '../action/github.js';
import { type ErrorCode, UptideError } from '../errors.js';
import { UPTIDE_COMMAND, uptideVersionInfo } from '../version.js';
import { noPackBlockers } from './no-pack.js';
import { command, git } from './process.js';
import type { FixReport } from './types.js';
import { assertVerifiedTree } from './verified-tree.js';

const count = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * Why a run may not reach GitHub, for opening a PR and for updating one alike; empty when it
 * may. Nothing overrides this list: not `--yes`, not `--no-llm`. A failed verification names
 * what failed, and a run produced by an Uptide checkout with uncommitted changes is not
 * reproducible from its recorded commit, so it is never published either. Neither is an upgrade
 * no pack analyzed, unless it is a minor or patch the repository's own build and tests verified
 * (no-pack.ts).
 */
export function publicationBlockers(
  report: FixReport,
  tool: { uptideDirty: boolean } = uptideVersionInfo(),
): string[] {
  const blockers: string[] = [];
  if (report.exportError) blockers.push(`export failed: ${report.exportError}`);
  const v = report.verification;
  if (report.verificationPending) blockers.push('verification has not run');
  else if (!v.passed && !report.exportError) {
    const failing = (v.tests ?? []).filter((t) => t.status === 'failed' || t.status === 'timeout');
    // What the upgrade introduced, apart from what was already broken (`fixVerdict`): on an
    // unhealthy baseline the pre-existing errors and failing runs are named, never blamed.
    const preexisting = v.baselineHealth?.typeErrors ?? v.baseline?.length ?? 0;
    const reasons = [
      ...(v.typesUnverified
        ? [`types not verified (type resolution failed: ${v.typesUnverified})`]
        : []),
      ...(v.newErrors?.length
        ? [
            `${count(v.newErrors.length, 'type error')} introduced by the upgrade${preexisting ? `, ${preexisting} pre-existing` : ''}`,
          ]
        : []),
      ...(v.lint ?? [])
        .filter((l) => l.status === 'failed')
        .map((l) => `lint (${l.tool}) fails on the edited files`),
      ...(v.build ?? [])
        .filter((b) => b.status === 'failed' || b.status === 'timeout')
        .map((b) => `build ${b.status === 'timeout' ? 'timed out' : 'failed'} in ${b.workspace}`),
      ...failing
        .filter((t) => !t.preexisting)
        .map((t) => `tests ${t.status === 'timeout' ? 'timed out' : 'failed'} in ${t.workspace}`),
      ...failing
        .filter((t) => t.preexisting)
        .map((t) => `tests in ${t.workspace} already failing before the upgrade`),
    ];
    blockers.push(
      `verification failed${reasons.length ? `: ${reasons.join(', ')}` : ' (files were left uncommitted)'}`,
    );
  }
  blockers.push(...noPackBlockers(report));
  if (report.sourceChanged?.length)
    blockers.push(`your checkout changed during the run (${report.sourceChanged.join('; ')})`);
  if (report.uptideDirty || tool.uptideDirty)
    blockers.push(
      'Uptide ran from a checkout with uncommitted changes; rerun from a committed build so the run is reproducible',
    );
  return blockers;
}

/**
 * Publishing stopped after the plan. `reason` is one short sentence Uptide composed, never
 * git's or GitHub's output: it is what the Action's job summary and run report say.
 */
export class PublishError extends UptideError {
  constructor(
    code: ErrorCode,
    readonly reason: string,
    message: string,
  ) {
    super(code, message);
  }
}

/**
 * The sentence for the report when `uptide pr` stopped: a `PublishError`'s own, or the one
 * for a branch whose tree is not the verified one. Undefined for anything else, which the
 * caller reports without a reason rather than with words Uptide did not compose.
 */
export function publicationFailureReason(error: unknown): string | undefined {
  if (error instanceof PublishError) return error.reason;
  if (error instanceof UptideError && error.code === 'VERIFIED_TREE_MISMATCH')
    return 'the branch no longer holds the verified tree';
  return undefined;
}

interface PublishIO {
  git: typeof git;
  command: typeof command;
  print: (text: string) => void;
  /** The PR description as stored; the file by default. */
  readBody?: (file: string) => string;
  /** Writes the description back when publishing adds to it; the file by default. */
  writeBody?: (file: string, body: string) => void;
}
/** GitHub's own limit for a PR body. */
export const GITHUB_BODY_LIMIT = 65_536;
/** The commit `origin` has for the branch, or undefined when it has none (or cannot be asked). */
function remoteBranchHead(
  cwd: string,
  branch: string,
  io: Pick<PublishIO, 'git'>,
): string | undefined {
  try {
    const line = io.git(cwd, 'ls-remote', '--heads', 'origin', `refs/heads/${branch}`);
    return /^([0-9a-f]{40})\s/.exec(line)?.[1];
  } catch {
    return undefined;
  }
}
const defaults: PublishIO = { git, command, print: console.log };

/** How many numbered alternatives (`<branch>-2` …) are tried before giving up. */
const MAX_SUFFIX = 20;
/** A GitHub App's bot user, with the noreply address GitHub gives it. */
const APP_BOT = /^(\d+)\+([a-z0-9-]+\[bot\])@users\.noreply\.github\.com$/;
const identityKey = (name: string, email: string): string => `${name}\u0000${email}`;
/**
 * Who counts as Uptide when deciding whether a branch on origin may be overwritten: the legacy
 * `uptide[bot]`, and the App's bot when it authored this run's own commits (the Action commits
 * as it). A person's identity never counts, not even the one running Uptide locally: a commit
 * someone made by hand on an Uptide branch is theirs.
 */
function uptideAuthors(
  cwd: string,
  head: string,
  against: string | undefined,
  io: Pick<PublishIO, 'git'>,
): Set<string> {
  const authors = new Set([identityKey(FALLBACK_IDENTITY.name, FALLBACK_IDENTITY.email)]);
  let own = '';
  try {
    own = io.git(
      cwd,
      'log',
      '--format=%an%x00%ae',
      ...(against ? [head, '--not', against] : ['-1', head]),
    );
  } catch {}
  for (const line of own.split('\n')) {
    const [name = '', email = ''] = line.split('\u0000');
    if (APP_BOT.exec(email)?.[2] === name) authors.add(identityKey(name, email));
  }
  return authors;
}
/**
 * The authors of the commits `origin` has at `remoteHead` beyond `base` that are not Uptide's,
 * by name, as GitHub compares them: a checkout (the Action's is shallow) may not hold the
 * history between. Undefined when that cannot be read, or GitHub lists only part of it: such
 * a branch is treated as someone else's.
 */
async function otherAuthors(
  cwd: string,
  repository: string,
  base: string,
  remoteHead: string,
  uptide: Set<string>,
  io: Pick<PublishIO, 'command'>,
): Promise<string[] | undefined> {
  const compared = await io.command(cwd, 'gh', [
    'api',
    `repos/${repository}/compare/${encodeURIComponent(base)}...${remoteHead}`,
  ]);
  if (compared.code) return undefined;
  try {
    const { total_commits: total, commits } = JSON.parse(compared.output) as {
      total_commits?: number;
      commits?: { commit?: { author?: { name?: string; email?: string } } }[];
    };
    if (!Array.isArray(commits) || total !== commits.length) return undefined;
    const others = new Set<string>();
    for (const { commit } of commits) {
      const { name = '', email = '' } = commit?.author ?? {};
      if (!uptide.has(identityKey(name, email))) others.add(name || email || 'unknown');
    }
    return [...others];
  } catch {
    return undefined;
  }
}
interface OpenPr {
  number: number;
  url: string;
}
/** The open PR whose head is `branch`; undefined when there is none, or the answer is unreadable. */
async function openPullRequest(
  cwd: string,
  nameWithOwner: string,
  branch: string,
  io: Pick<PublishIO, 'command'>,
): Promise<OpenPr | undefined> {
  const existing = await io.command(cwd, 'gh', [
    'pr',
    'list',
    '--repo',
    nameWithOwner,
    '--head',
    branch,
    '--state',
    'open',
    '--json',
    'number,url',
  ]);
  try {
    // An answer that cannot be read means no PR is known: one is created, as before.
    if (!existing.code) return (JSON.parse(existing.output.trim() || '[]') as OpenPr[])[0];
  } catch {}
  return undefined;
}
/** Where the verified commit goes on origin, and what is there now. */
interface BranchChoice {
  branch: string;
  /** What origin has on the branch: the lease a forced push is checked against. */
  remoteHead?: string;
  open?: OpenPr;
  /** The branch named after the run, when it was left alone, and whose commits it holds. */
  passedOver?: { branch: string; authors: string[] };
}
/**
 * The branch to publish on. A closed PR does not delete its branch, so `uptide/<pkg>-<version>`
 * may already be on origin. It is reused when it is free, already at the verified commit, or
 * holds only Uptide's commits beyond the base (an open Uptide PR is then updated, else a new
 * one opened); a branch with anyone else's commit is never overwritten, and the next free
 * `<branch>-<n>` is used instead, by the same rules.
 */
async function chooseBranch(
  cwd: string,
  repos: { own: string; target: string; base: string },
  branch: string,
  head: string,
  against: string | undefined,
  io: Pick<PublishIO, 'git' | 'command'>,
): Promise<BranchChoice> {
  let uptide: Set<string> | undefined;
  let passedOver: BranchChoice['passedOver'];
  for (let n = 1; n <= MAX_SUFFIX; n++) {
    const candidate = n === 1 ? branch : `${branch}-${n}`;
    const remoteHead = remoteBranchHead(cwd, candidate, io);
    const choice = (more: Omit<BranchChoice, 'branch' | 'passedOver'> = {}): BranchChoice => ({
      branch: candidate,
      ...more,
      ...(passedOver ? { passedOver } : {}),
    });
    if (!remoteHead) return choice();
    const open = await openPullRequest(cwd, repos.target, candidate, io);
    const ours = { remoteHead, ...(open ? { open } : {}) };
    if (remoteHead === head) return choice(ours);
    uptide ??= uptideAuthors(cwd, head, against, io);
    const others = await otherAuthors(cwd, repos.own, repos.base, remoteHead, uptide, io);
    if (others && !others.length) return choice(ours);
    passedOver ??= { branch: candidate, authors: others ?? [] };
  }
  throw new PublishError(
    'PUBLICATION_FAILED',
    'the branch exists with commits from someone else, and so do its numbered alternatives',
    `${branch} and ${branch}-2 to ${branch}-${MAX_SUFFIX} all exist on origin with commits from someone else; nothing was pushed`,
  );
}
/** One sentence for a refused push, from git's own words; never the words themselves. */
function pushFailure(output: string): string {
  if (/stale info|fetch first|non-fast-forward/.test(output))
    return 'the branch on GitHub changed while it was being published';
  if (/protected branch|GH006|GH013/.test(output)) return 'a rule on GitHub protects the branch';
  if (/\b403\b|denied|not allowed/i.test(output)) return 'the token may not push to the repository';
  return 'GitHub refused the push';
}
export interface PublishTarget {
  /** `owner/name` the PR will be opened on. */
  nameWithOwner: string;
  base: string;
  /** The parent, when the repository is a fork of one. */
  parent?: string;
}
/**
 * Before a `--pr` run clones anything: `gh` must be signed in and the target repository must
 * resolve. The target is the repository `origin` names, a fork included; its parent only when
 * asked for by name. Says where the PR will go so the user can object before any work.
 */
export async function publishTarget(
  cwd: string,
  repo?: string,
  io: Pick<PublishIO, 'git' | 'command'> = defaults,
): Promise<PublishTarget> {
  const auth = await io.command(cwd, 'gh', ['auth', 'status']);
  if (auth.code)
    throw new UptideError(
      'PUBLICATION_REFUSED',
      `--pr needs GitHub CLI signed in: ${auth.output.trim().split('\n').at(-1) ?? 'gh auth status failed'}; run \`gh auth login\``,
    );
  const remote = io.git(cwd, 'remote', 'get-url', 'origin');
  const slug = /github\.com[:/]([^/]+)\/([^/\s]+?)(?:\.git)?$/.exec(remote);
  const owner = slug?.[1];
  // A classic token lists its scopes; a private repository needs `repo` among them.
  const scopes = /Token scopes: (.*)$/m.exec(auth.output)?.[1];
  const lacksRepoScope = scopes !== undefined && !/'repo'/.test(scopes);
  let own: Awaited<ReturnType<typeof viewRepository>>;
  try {
    own = await viewRepository(cwd, remote, io);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UptideError(
      'PUBLICATION_REFUSED',
      [
        `--pr cannot reach ${remote} with the GitHub token: ${firstLine(message.replace(/^cannot resolve target repository: /, ''))}`,
        'Likely causes, and what fixes each:',
        `  the token lacks the \`repo\` scope${lacksRepoScope ? ` (it does: its scopes are ${scopes})` : ''}: gh auth refresh -h github.com -s repo`,
        ...(owner
          ? [
              `  ${owner} enforces SSO and the token is not authorized for it: https://github.com/orgs/${owner}/sso`,
            ]
          : []),
        '  the account has no access to the repository: ask for it, or run from a fork you own',
        'Nothing was cloned or changed.',
      ].join('\n'),
    );
  }
  // Publishing pushes a branch to origin: reading it is not enough.
  if (own.viewerPermission && !['WRITE', 'MAINTAIN', 'ADMIN'].includes(own.viewerPermission))
    throw new UptideError(
      'PUBLICATION_REFUSED',
      [
        `--pr needs push access to ${own.nameWithOwner ?? remote}; this account has ${own.viewerPermission.toLowerCase()} access only.`,
        'What fixes it:',
        '  ask for write access to the repository, or',
        `  fork it and run from the fork (gh repo fork ${own.nameWithOwner ?? ''} --clone), then \`${UPTIDE_COMMAND} pr --repo ${own.nameWithOwner ?? '<owner/name>'}\` opens the PR upstream`,
        ...(owner
          ? [
              `  if you do have write access through ${owner}, authorize the token for its SSO: https://github.com/orgs/${owner}/sso`,
            ]
          : []),
        `Nothing was cloned or changed. Without --pr the migration still runs, and \`${UPTIDE_COMMAND} pr\` publishes it later.`,
      ].join('\n'),
    );
  const target = repo ? await viewRepository(cwd, repo, io) : own;
  if (!target.defaultBranchRef?.name || !target.nameWithOwner)
    throw new UptideError('PUBLICATION_REFUSED', 'target repository has no default branch');
  return {
    nameWithOwner: target.nameWithOwner,
    base: target.defaultBranchRef.name,
    ...(own.isFork && own.parent?.nameWithOwner ? { parent: own.parent.nameWithOwner } : {}),
  };
}
async function viewRepository(
  cwd: string,
  target: string,
  io: Pick<PublishIO, 'command'>,
): Promise<{
  defaultBranchRef?: { name: string };
  nameWithOwner?: string;
  isFork?: boolean;
  parent: { nameWithOwner: string } | null;
  viewerPermission?: string;
}> {
  const metadata = await io.command(cwd, 'gh', [
    'repo',
    'view',
    target,
    '--json',
    'defaultBranchRef,nameWithOwner,isFork,parent,viewerPermission',
  ]);
  if (metadata.code) throw new Error(`cannot resolve target repository: ${metadata.output}`);
  const parsed = JSON.parse(metadata.output) as {
    defaultBranchRef?: { name: string };
    nameWithOwner?: string;
    isFork?: boolean;
    viewerPermission?: string;
    parent?: { nameWithOwner?: string; name?: string; owner?: { login?: string } } | null;
  };
  // gh names the parent by owner and name, not as one string.
  const parent = parsed.parent
    ? (parsed.parent.nameWithOwner ??
      (parsed.parent.owner?.login && parsed.parent.name
        ? `${parsed.parent.owner.login}/${parsed.parent.name}`
        : undefined))
    : undefined;
  return { ...parsed, parent: parent ? { nameWithOwner: parent } : null };
}
const firstLine = (text: string): string => text.trim().split('\n')[0] ?? '';
/** The `uptide` label exists, or was created; never a reason to stop. */
async function ensureLabel(
  cwd: string,
  nameWithOwner: string,
  io: Pick<PublishIO, 'command'>,
): Promise<{ ok: true } | { ok: false; step: 'read' | 'created'; output: string }> {
  const labels = await io.command(cwd, 'gh', [
    'label',
    'list',
    '--repo',
    nameWithOwner,
    '--search',
    'uptide',
    '--json',
    'name',
  ]);
  if (labels.code) return { ok: false, step: 'read', output: labels.output };
  let names: { name: string }[] = [];
  try {
    names = JSON.parse(labels.output.trim() || '[]') as { name: string }[];
  } catch {
    return { ok: false, step: 'read', output: labels.output };
  }
  if (names.some((l) => l.name === 'uptide')) return { ok: true };
  const label = await io.command(cwd, 'gh', [
    'label',
    'create',
    'uptide',
    '--repo',
    nameWithOwner,
    '--description',
    'Verified dependency migration proposed by Uptide',
    '--color',
    '2563EB',
  ]);
  return label.code ? { ok: false, step: 'created', output: label.output } : { ok: true };
}
export interface PublishOptions {
  /**
   * The repository the run belongs to, when publishing a stored run from the user's checkout:
   * the branch is a ref there, not checked out. Default: the run's own clone, checked out.
   */
  cwd?: string;
  /** `owner/name` to open the PR on. Default: the repository `origin` points at, a fork included. */
  repo?: string;
  /** A draft PR; the default. */
  draft?: boolean;
}
/** No writes before the concrete publication plan and explicit --yes gate. */
export async function publish(
  report: FixReport,
  yes = false,
  io: PublishIO = defaults,
  options: PublishOptions = {},
): Promise<string> {
  if (report.exportError) throw new UptideError('VERIFIED_TREE_MISMATCH', report.exportError);
  const cwd = options.cwd ?? report.repo;
  const branch = report.branch;
  if (!/^uptide\//.test(branch))
    throw new Error('publication branch does not match the verified migration');
  if (report.verification.passed) assertVerifiedTree(cwd, report, io.git);
  const blockers = publicationBlockers(report, { uptideDirty: false });
  if (blockers.length)
    throw new UptideError(
      'PUBLICATION_REFUSED',
      `cannot publish an unverified migration: ${blockers.join('; ')}`,
    );
  if (options.cwd) {
    // A stored run: the branch must still be the verified commit.
    const at = io.git(cwd, 'rev-parse', branch);
    if (report.head && at !== report.head)
      throw new PublishError(
        'RUN_STALE',
        'the branch moved after it was verified',
        `${branch} is at ${at.slice(0, 12)}, not the verified ${report.head.slice(0, 12)}; run \`${UPTIDE_COMMAND} verify --branch ${branch}\` first`,
      );
  } else if (io.git(cwd, 'branch', '--show-current') !== branch)
    throw new Error('publication branch does not match the verified migration');
  const head = io.git(cwd, 'rev-parse', branch);
  const remote = io.git(cwd, 'remote', 'get-url', 'origin');
  // The PR goes to the repository `origin` names, a fork included; never to a fork's parent
  // unless asked by name.
  const own = await viewRepository(cwd, remote, io);
  const target = options.repo ? await viewRepository(cwd, options.repo, io) : own;
  const { defaultBranchRef, nameWithOwner } = target;
  if (!defaultBranchRef?.name || !nameWithOwner)
    throw new Error('target repository has no default branch');
  const base = report.prBase ?? defaultBranchRef.name;
  // Against the remote's base when it is fetched, else the local branch of that name.
  const against = [`origin/${base}`, base].find((ref) => {
    try {
      io.git(cwd, 'rev-parse', '--verify', '--quiet', ref);
      return true;
    } catch {
      return false;
    }
  });
  const commits = against
    ? io.git(cwd, 'log', '--oneline', `${against}..${branch}`)
    : '(base not fetched)';
  const stat = against ? io.git(cwd, 'diff', '--stat', `${against}...${branch}`) : '';
  io.print(
    `Publication plan\nBranch: ${branch}\nTarget remote: ${remote}\nOpening the PR on: ${nameWithOwner}${own.isFork && own.parent?.nameWithOwner ? ` (a fork of ${own.parent.nameWithOwner}; pass --repo ${own.parent.nameWithOwner} to open it there)` : ''}\nBase: ${base}\nCommits:\n${commits}\nDiffstat:\n${stat}`,
  );
  // The description is checked before anything is pushed: GitHub refuses a longer one, and a
  // refusal after the push leaves a branch with no PR.
  const body = (io.readBody ?? ((file: string) => readFileSync(file, 'utf8')))(report.prBody);
  const assertFits = (text: string): void => {
    if (text.length > GITHUB_BODY_LIMIT)
      throw new PublishError(
        'PUBLICATION_REFUSED',
        'the description is longer than GitHub accepts',
        `the PR description is ${text.length.toLocaleString('en-US')} characters; GitHub accepts ${GITHUB_BODY_LIMIT.toLocaleString('en-US')}. Nothing was pushed. \`${UPTIDE_COMMAND} pr --branch ${branch}\` renders it again within the limit`,
      );
  };
  assertFits(body);
  if (!yes) throw new Error('publication requires --yes; nothing pushed');
  if (io.git(cwd, 'rev-parse', branch) !== head)
    throw new Error('HEAD changed after publication planning');
  // The label is a convenience. A token that cannot read or create labels (no triage right,
  // an organization's SSO not authorized for it) must not cost a verified run its PR.
  const labelled = await ensureLabel(cwd, nameWithOwner, io);
  if (!labelled.ok)
    io.print(
      `Warning: the \`uptide\` label could not be ${labelled.step} (${firstLine(labelled.output)}); opening the PR without it.`,
    );
  const onOrigin = await chooseBranch(
    cwd,
    { own: own.nameWithOwner ?? nameWithOwner, target: nameWithOwner, base },
    branch,
    head,
    against,
    io,
  );
  if (onOrigin.passedOver) {
    const { branch: left, authors } = onOrigin.passedOver;
    const whose = authors.length
      ? `commits from someone else (${authors.join(', ')})`
      : 'commits Uptide could not attribute';
    io.print(
      `${left} exists on origin with ${whose}; it is left as it is. Publishing on ${onOrigin.branch}.`,
    );
    // Said in the PR itself, so a reviewer looking for the usual branch knows where this went.
    const noted = `> Published on \`${onOrigin.branch}\`: \`${left}\` already exists with ${whose}, and Uptide never overwrites them.\n\n${body}`;
    assertFits(noted);
    (io.writeBody ?? ((file: string, text: string) => writeFileSync(file, text)))(
      report.prBody,
      noted,
    );
  }
  const published = onOrigin.branch;
  // Idempotent: a branch already on the remote at the verified commit is not pushed again.
  if (onOrigin.remoteHead === head)
    io.print(`${published} is already on origin at ${head.slice(0, 12)}; not pushed again.`);
  else {
    assertVerifiedTree(cwd, report, io.git);
    if (io.git(cwd, 'rev-parse', branch) !== head)
      throw new Error('HEAD changed after publication planning');
    if (onOrigin.remoteHead)
      io.print(
        `${published} is on origin at ${onOrigin.remoteHead.slice(0, 12)} with Uptide's commits only; replacing it with the verified ${head.slice(0, 12)}.`,
      );
    try {
      io.git(
        cwd,
        'push',
        '--set-upstream',
        // Only over what was just read: a commit pushed since is never lost.
        ...(onOrigin.remoteHead
          ? [`--force-with-lease=refs/heads/${published}:${onOrigin.remoteHead}`]
          : []),
        'origin',
        `${head}:refs/heads/${published}`,
      );
    } catch (error) {
      const output = error instanceof Error ? error.message : String(error);
      throw new PublishError('PUBLICATION_FAILED', pushFailure(output), output);
    }
  }
  // ...and a PR already open for the branch gets this description instead of a second PR.
  const open = onOrigin.open;
  if (open) {
    let edited = await io.command(cwd, 'gh', [
      'pr',
      'edit',
      String(open.number),
      '--repo',
      nameWithOwner,
      '--body-file',
      report.prBody,
    ]);
    // `gh pr edit` fails on repositories where GitHub retired classic projects; REST does not.
    if (edited.code && /projectCards|Projects \(classic\)/.test(edited.output))
      edited = await io.command(cwd, 'gh', [
        'api',
        '--method',
        'PATCH',
        `repos/${nameWithOwner}/pulls/${open.number}`,
        '--field',
        `body=@${report.prBody}`,
        '--silent',
      ]);
    if (edited.code)
      throw new PublishError(
        'PUBLICATION_FAILED',
        'the open pull request could not be updated',
        `cannot update the description of ${open.url}: ${edited.output}`,
      );
    io.print(`A pull request is already open for ${published}: its description was updated.`);
    return open.url;
  }
  const create = (label: boolean) =>
    io.command(cwd, 'gh', [
      'pr',
      'create',
      '--repo',
      nameWithOwner,
      ...(options.draft === false ? [] : ['--draft']),
      '--base',
      base,
      ...(label ? ['--label', 'uptide'] : []),
      '--title',
      report.mode === 'pin'
        ? `Pin the Stripe API version to ${report.apiVersion ?? ''}`.trim()
        : `Upgrade ${report.package} to ${report.target}`,
      '--body-file',
      report.prBody,
      '--head',
      own.nameWithOwner && own.nameWithOwner !== nameWithOwner
        ? `${own.nameWithOwner.split('/')[0]}:${published}`
        : published,
    ]);
  let result = await create(labelled.ok);
  if (result.code && labelled.ok && /label/i.test(result.output)) {
    // The label exists but this token may not apply it: the PR matters, the label does not.
    io.print(
      `Warning: the \`uptide\` label could not be applied (${firstLine(result.output)}); opening the PR without it.`,
    );
    result = await create(false);
  }
  if (result.code)
    throw new PublishError(
      'PUBLICATION_FAILED',
      'GitHub did not open the pull request',
      `gh pr create failed: ${result.output}`,
    );
  const url = result.output.match(/https:\/\/[^\s]+\/pull\/\d+/g)?.at(-1);
  if (!url)
    throw new PublishError(
      'PUBLICATION_FAILED',
      'GitHub did not return a pull request',
      `gh did not return a pull request URL: ${result.output}`,
    );
  return url;
}
