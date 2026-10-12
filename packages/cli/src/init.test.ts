import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { run } from './cli.js';
import { slugOf } from './init.js';
import { fakeEngine, memoryIo, tempRepo } from './test-utils.js';

const WORKFLOW = '.github/workflows/uptide.yml';

/** A pnpm repository with an origin on GitHub, the way a clone looks. */
function clonedRepo(extra: Record<string, string> = {}): string {
  const root = tempRepo({
    'package.json': JSON.stringify({ name: 'shop', packageManager: 'pnpm@10.17.1' }),
    'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
    '.nvmrc': '22\n',
    ...extra,
  });
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
  git('init', '-q', '-b', 'trunk');
  git('remote', 'add', 'origin', 'git@github.com:acme/shop.git');
  return root;
}

describe('uptide init', () => {
  it('--dry-run prints both files and the pull request, and writes nothing', async () => {
    const cwd = clonedRepo();
    const io = memoryIo({ cwd });
    expect(await run(['init', '--dry-run'], io, fakeEngine())).toBe(0);
    const out = io.stdout();
    expect(out).toContain(`--- ${WORKFLOW} (new)\n# Uptide:`);
    expect(out).toContain('--- uptide.yml (new)\n# Uptide settings');
    expect(out).toContain('--- pull request: Add Uptide');
    expect(out).toContain('Checks out `trunk`');
    expect(out).toContain('cache: pnpm');
    expect(existsSync(join(cwd, WORKFLOW))).toBe(false);
    expect(existsSync(join(cwd, 'uptide.yml'))).toBe(false);
    expect(io.stderr()).toContain('not released yet');
  });

  it('writes the files the App would propose, without committing', async () => {
    const cwd = clonedRepo();
    const io = memoryIo({ cwd });
    expect(await run(['init'], io, fakeEngine())).toBe(0);
    expect(io.stdout()).toBe(`${WORKFLOW}: created\nuptide.yml: created\n`);
    expect(io.stderr()).toContain('gh secret set ANTHROPIC_API_KEY');
    const workflow = parse(readFileSync(join(cwd, WORKFLOW), 'utf8'));
    expect(workflow.name).toBe('Uptide');
    // The schedule comes from the origin's owner/name, as the App derives it.
    const { generateOnboarding, repoFacts, snapshotFromDisk } = await import('@uptide/core');
    const expected = generateOnboarding(
      repoFacts(snapshotFromDisk(cwd, { slug: 'acme/shop', defaultBranch: 'trunk' })),
    );
    for (const file of expected.files)
      expect(readFileSync(join(cwd, file.path), 'utf8')).toBe(file.content);
    expect(execFileSync('git', ['-C', cwd, 'rev-list', '--all'], { encoding: 'utf8' })).toBe('');
  }, 20_000);

  it('keeps an existing uptide.yml and writes the workflow from its settings', async () => {
    const settings = "version: 1\nschedule: '7 5 * * 2'\nllm:\n  enabled: false\n";
    const cwd = clonedRepo({ 'uptide.yml': settings });
    const io = memoryIo({ cwd });
    expect(await run(['init'], io, fakeEngine())).toBe(0);
    expect(io.stdout()).toContain('uptide.yml: exists: kept, its settings are used');
    expect(readFileSync(join(cwd, 'uptide.yml'), 'utf8')).toBe(settings);
    const workflow = readFileSync(join(cwd, WORKFLOW), 'utf8');
    expect(workflow).toContain("- cron: '7 5 * * 2'");
    expect(workflow).not.toContain('ANTHROPIC_API_KEY');
  });

  it('never replaces a workflow that differs without --force, and is quiet when nothing changed', async () => {
    const cwd = clonedRepo({ [WORKFLOW]: 'name: mine\n' });
    const io = memoryIo({ cwd });
    expect(await run(['init'], io, fakeEngine())).toBe(2);
    expect(io.stderr()).toContain(`${WORKFLOW} exists and differs`);
    expect(readFileSync(join(cwd, WORKFLOW), 'utf8')).toBe('name: mine\n');
    expect(existsSync(join(cwd, 'uptide.yml'))).toBe(false);
    expect(await run(['init', '--force'], memoryIo({ cwd }), fakeEngine())).toBe(0);
    const again = memoryIo({ cwd });
    expect(await run(['init'], again, fakeEngine())).toBe(0);
    expect(again.stdout()).toContain(`${WORKFLOW}: unchanged`);
  });

  it('refuses with the reason and writes nothing when the files would not work', async () => {
    const cwd = tempRepo({ 'package.json': '{"name":"shop"}', 'bun.lockb': '' });
    const io = memoryIo({ cwd });
    expect(await run(['init'], io, fakeEngine())).toBe(2);
    expect(io.stderr()).toContain('uptide init: nothing generated');
    expect(io.stderr()).toContain('Bun is not supported yet');
    expect(existsSync(join(cwd, WORKFLOW))).toBe(false);
  });

  it('reports an invalid uptide.yml instead of overwriting it', async () => {
    const cwd = clonedRepo({ 'uptide.yml': 'version: 1\nmaxOpenPrs: lots\n' });
    const io = memoryIo({ cwd });
    expect(await run(['init'], io, fakeEngine())).toBe(2);
    expect(io.stderr()).toContain('line 2: maxOpenPrs must be a whole number');
  });

  it('--json says what would be written', async () => {
    const cwd = clonedRepo();
    const io = memoryIo({ cwd });
    await run(['init', '--dry-run', '--json'], io, fakeEngine());
    const result = JSON.parse(io.stdout());
    expect(result.written).toBe(false);
    expect(result.files.map((f: { path: string; action: string }) => [f.path, f.action])).toEqual([
      [WORKFLOW, 'create'],
      ['uptide.yml', 'create'],
    ]);
    expect(result.prTitle).toBe('Add Uptide');
  });

  it('reads owner/name from GitHub remotes', () => {
    expect(slugOf('git@github.com:acme/shop.git')).toBe('acme/shop');
    expect(slugOf('https://github.com/acme/shop')).toBe('acme/shop');
    expect(slugOf('https://github.com/acme/shop.js.git')).toBe('acme/shop.js');
    expect(slugOf('https://gitlab.com/acme/shop.git')).toBeUndefined();
    expect(slugOf(undefined)).toBeUndefined();
  });
});

describe('uptide.yml in list, check and fix', () => {
  const settings = (root: string, text: string) => writeFileSync(join(root, 'uptide.yml'), text);
  /** Committed, as fix starts only from a clean tree. */
  const committed = (root: string, text: string) => {
    settings(root, text);
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        stdio: 'ignore',
      });
    git('add', 'uptide.yml');
    git('commit', '-qm', 'settings');
  };

  it('fix takes maxCost, llm and executor from uptide.yml, and flags win', async () => {
    const { pnpmGitRepo } = await import('./test-utils.js');
    const cwd = pnpmGitRepo();
    committed(cwd, 'version: 1\nmaxCost: 4\nllm:\n  enabled: false\nexecutor: sdk\n');
    const engine = fakeEngine();
    const io = memoryIo({ cwd, env: { ANTHROPIC_API_KEY: 'k' } });
    expect(await run(['fix', 'zod'], io, engine)).toBe(0);
    expect(engine.calls.at(-1)).toMatchObject({ maxCostUsd: 4, llm: false, agent: 'sdk' });
    expect(io.stderr()).toContain('Settings: uptide.yml');
    expect(io.stderr()).toContain('assisted fixes off (llm.enabled: false in uptide.yml)');
    await run(
      ['fix', 'zod', '--llm', '--max-cost', '2', '--agent', 'patch'],
      memoryIo({ cwd, env: { ANTHROPIC_API_KEY: 'k' } }),
      engine,
    );
    expect(engine.calls.at(-1)).toMatchObject({ maxCostUsd: 2, llm: true });
    expect(engine.calls.at(-1)).not.toHaveProperty('agent');
  });

  it('fix uses the provider uptide.yml names, below flags and environment', async () => {
    const { pnpmGitRepo } = await import('./test-utils.js');
    const cwd = pnpmGitRepo();
    committed(cwd, 'version: 1\nllm:\n  provider: openai\n');
    const engine = fakeEngine();
    await run(['fix', 'zod'], memoryIo({ cwd, env: { OPENAI_API_KEY: 'k' } }), engine);
    expect(engine.calls.at(-1)).toMatchObject({ provider: 'openai' });
    await run(['fix', 'zod', '--provider', 'anthropic'], memoryIo({ cwd }), engine);
    expect(engine.calls.at(-1)).toMatchObject({ provider: 'anthropic' });
  });

  it('a named package outside packages is still checked, and said', async () => {
    const { npmRepo } = await import('./test-utils.js');
    const cwd = npmRepo({ '.git/HEAD': '' });
    settings(cwd, 'version: 1\npackages:\n  deny: [stripe]\n');
    const engine = fakeEngine();
    const io = memoryIo({ cwd });
    await run(['check', 'zod', 'stripe'], io, engine);
    expect(engine.calls[0]).toMatchObject({ only: ['zod', 'stripe'] });
    expect(io.stderr()).toContain(
      'stripe: outside packages in uptide.yml; included because it was named.',
    );
  });

  it('list leaves out what packages excludes', async () => {
    const { npmRepo } = await import('./test-utils.js');
    const cwd = npmRepo({ '.git/HEAD': '' });
    settings(cwd, "version: 1\npackages:\n  allow: ['zod']\n");
    let request: unknown;
    const engine = fakeEngine({
      list: async (r) => {
        request = r;
        return {
          repo: cwd,
          workspaces: ['.'],
          packages: [],
          groups: [],
          failures: [],
          timing: { totalMs: 1 },
        };
      },
    });
    expect(await run(['list', '--json'], memoryIo({ cwd }), engine)).toBe(0);
    expect(request).toMatchObject({ packages: { allow: ['zod'], deny: [] } });
  });

  it('--config names another file, and a bad one stops the run', async () => {
    const { npmRepo } = await import('./test-utils.js');
    const cwd = npmRepo({ '.git/HEAD': '', 'ci/uptide.yml': 'version: 1\nmaxOpenPrs: 0\n' });
    const io = memoryIo({ cwd });
    expect(await run(['check', 'zod', '--config', 'ci/uptide.yml'], io, fakeEngine())).toBe(2);
    expect(io.stderr()).toContain('maxOpenPrs must be at least 1 and at most 50');
  });
});
