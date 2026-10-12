import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  generateOnboarding,
  type Onboarding,
  OnboardingRefusal,
  parseUptideConfig,
  repoFacts,
  snapshotFromDisk,
  UPTIDE_CONFIG_FILE,
  WORKFLOW_PATH,
} from '@uptide/core';
import { CliError, EXIT } from './errors.js';

/** What `init` does with one generated file. */
export interface InitFile {
  path: string;
  content: string;
  /** `kept`: an existing uptide.yml is the input, never rewritten. */
  action: 'create' | 'update' | 'unchanged' | 'kept';
}

export interface InitResult {
  root: string;
  files: InitFile[];
  prTitle: string;
  prBody: string;
  /** Set when the existing uptide.yml was read; its settings are kept. */
  configFrom?: string;
}

/** Git, read-only; undefined when it fails (not a repository, no origin). */
type Git = (root: string, ...args: string[]) => string | undefined;
const git: Git = (root, ...args) => {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
};

/** `owner/name` of a GitHub remote URL, https or ssh. */
export function slugOf(url: string | undefined): string | undefined {
  const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url ?? '');
  return m ? `${m[1]}/${m[2]}` : undefined;
}

/** The repository as the App would see it: root, slug and default branch from git. */
function locate(cwd: string, run: Git): { root: string; slug?: string; defaultBranch: string } {
  const root = run(cwd, 'rev-parse', '--show-toplevel') ?? resolve(cwd);
  const slug = slugOf(run(root, 'remote', 'get-url', 'origin'));
  const defaultBranch =
    run(root, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')?.replace(/^origin\//, '') ||
    run(root, 'branch', '--show-current') ||
    'main';
  return { root, ...(slug ? { slug } : {}), defaultBranch };
}

/** Generate the onboarding files for the repository around `cwd`, and say what writing would do. */
export function planInit(cwd: string, run: Git = git): InitResult {
  const repo = locate(cwd, run);
  const configPath = join(repo.root, UPTIDE_CONFIG_FILE);
  const existingConfig = existsSync(configPath)
    ? parseUptideConfig(readFileSync(configPath, 'utf8'), UPTIDE_CONFIG_FILE)
    : undefined;
  let onboarding: Onboarding;
  try {
    onboarding = generateOnboarding(repoFacts(snapshotFromDisk(repo.root, repo)), {
      ...(existingConfig ? { config: existingConfig.given } : {}),
    });
  } catch (err) {
    if (err instanceof OnboardingRefusal)
      throw new CliError(`uptide init: nothing generated for ${repo.root}`, {
        why: err.message,
      });
    throw err;
  }
  const files = onboarding.files.map((file): InitFile => {
    const target = join(repo.root, file.path);
    if (!existsSync(target)) return { ...file, action: 'create' };
    if (file.path === UPTIDE_CONFIG_FILE) return { ...file, action: 'kept' };
    return {
      ...file,
      action: readFileSync(target, 'utf8') === file.content ? 'unchanged' : 'update',
    };
  });
  return {
    root: repo.root,
    files,
    prTitle: onboarding.prTitle,
    prBody: onboarding.prBody,
    ...(existingConfig ? { configFrom: UPTIDE_CONFIG_FILE } : {}),
  };
}

/** Write what `planInit` produced. An existing workflow that differs needs `force`. */
export function writeInit(result: InitResult, force: boolean): void {
  const changed = result.files.find((f) => f.action === 'update');
  if (changed && !force)
    throw new CliError(`${changed.path} exists and differs from what uptide init generates`, {
      why: 'It may hold your own changes. Nothing was written.',
      next: 'uptide init --dry-run   (compare), then: uptide init --force',
      exitCode: EXIT.error,
    });
  for (const file of result.files) {
    if (file.action !== 'create' && file.action !== 'update') continue;
    const target = join(result.root, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }
}

export const INIT_NEXT = `Next:
  1. Review the files, then commit them on a branch and open a pull request.
  2. Add the repository secret ANTHROPIC_API_KEY for assisted fixes:
       gh secret set ANTHROPIC_API_KEY
     Without it Uptide applies rule-based fixes only. llm.enabled: false in ${UPTIDE_CONFIG_FILE} turns the LLM off.
  The workflow runs once ${WORKFLOW_PATH} is on the default branch: on its schedule, and when started from the Actions tab.
`;
