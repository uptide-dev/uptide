import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '@uptide/core/onboarding';
import { describe, expect, it } from 'vitest';

// `uptide/onboarding` and `uptide/onboarding/node`: the generator the GitHub App imports,
// built by tsup.onboarding.config.ts. The packed tarball is tested by smoke/onboarding.mjs.
const root = fileURLToPath(new URL('..', import.meta.url));
const dir = `${root}dist/onboarding`;
const built = existsSync(`${dir}/index.js`);

/** What the bundle may weigh. Raise it on purpose, in a reviewed change, never to make CI pass. */
const BUDGET = { js: 120 * 1024, dts: 32 * 1024 };

interface Metafile {
  inputs: Record<string, { imports: { path: string; external?: boolean }[] }>;
  outputs: Record<string, { imports: { path: string; external?: boolean }[] }>;
}
const metafile = (path: string): Metafile => JSON.parse(readFileSync(path, 'utf8'));
const packageOf = (input: string): string | undefined => {
  const rest = input.split('node_modules/').at(-1);
  if (rest === input || !rest) return undefined;
  const parts = rest.split('/');
  return (parts[0]?.startsWith('@') ? parts.slice(0, 2) : parts.slice(0, 1)).join('/');
};

// `turbo run test` builds first; a bare `vitest` on a fresh clone has no dist yet.
describe.skipIf(!built)('uptide/onboarding', () => {
  const meta = built ? metafile(`${dir}/metafile-esm.json`) : { inputs: {}, outputs: {} };
  const inputs = Object.keys(meta.inputs);
  /** An entry's output files, following its chunks, and what they import from outside. */
  const reach = (entry: string) => {
    const files = new Set<string>();
    const external = new Set<string>();
    const visit = (file: string) => {
      if (files.has(file)) return;
      files.add(file);
      for (const i of meta.outputs[file]?.imports ?? [])
        if (i.external) external.add(i.path);
        else visit(i.path);
    };
    visit(`dist/onboarding/${entry}.js`);
    return { files: [...files], external: [...external].sort() };
  };

  it('bundles core onboarding with semver, and nothing of the engine', () => {
    // yaml is a dependency, not inlined: its CommonJS build calls require("process").
    expect(new Set(inputs.map(packageOf).filter(Boolean))).toEqual(new Set(['semver']));
    const own = inputs.filter((i) => !packageOf(i)).map((i) => i.replace(/^.*core\/src\//, ''));
    expect(own.length).toBeGreaterThan(0);
    for (const file of own)
      expect(file, file).toMatch(/^(onboarding\/[\w-]+\.ts|errors\.ts|glob\.ts|llm\/types\.ts)$/);
  });

  it('keeps the pure entry off the file system: only yaml comes from outside', () => {
    expect(reach('index').external).toEqual(['yaml']);
    // Only the node entry reads the disk.
    expect(reach('node').external).toEqual(['fs', 'path', 'yaml']);
    const pure = reach('index')
      .files.map((f) => readFileSync(`${root}${f}`, 'utf8'))
      .join('\n');
    // No Node globals either; semver's own `typeof process` guard is the one mention of one.
    expect(pure).not.toMatch(/\bBuffer\b|\brequire\(|__dirname|__filename/);
  });

  it('stays within its size budget', () => {
    const bytes = reach('index').files.reduce((n, f) => n + statSync(`${root}${f}`).size, 0);
    expect(bytes).toBeLessThanOrEqual(BUDGET.js);
    expect(statSync(`${dir}/index.d.ts`).size).toBeLessThanOrEqual(BUDGET.dts);
  });

  it('ships its own types, importing only its own files', () => {
    const types = readFileSync(`${dir}/index.d.ts`, 'utf8');
    for (const [, from] of types.matchAll(/^(?:import|export) .* from '([^']+)'/gm))
      expect(from, from).toMatch(/^\.\//);
    for (const name of [
      'generateOnboarding',
      'repoFacts',
      'OnboardingRefusal',
      'RepoSnapshot',
      'parseUptideConfig',
      'WORKFLOW_PATH',
    ])
      expect(types).toMatch(new RegExp(`\\b${name}\\b`));
    expect(types).not.toMatch(/\b(loadUptideConfig|snapshotFromDisk)\b/);
    const node = readFileSync(`${dir}/node.d.ts`, 'utf8');
    for (const name of ['loadUptideConfig', 'snapshotFromDisk'])
      expect(node).toMatch(new RegExp(`\\b${name}\\b`));
  });

  it('bundles no package the CLI bundle does not, so THIRD-PARTY-NOTICES covers it', () => {
    const cli = new Set(
      Object.keys(metafile(`${root}dist/metafile-esm.json`).inputs).map(packageOf),
    );
    for (const pkg of inputs.map(packageOf).filter(Boolean)) expect(cli.has(pkg), pkg).toBe(true);
  });

  it('resolves as uptide/onboarding and writes the same files as the engine', async () => {
    const published = (await import(
      /* @vite-ignore */ import.meta.resolve('uptide/onboarding')
    )) as typeof core;
    expect(fileURLToPath(import.meta.resolve('uptide/onboarding'))).toBe(`${dir}/index.js`);
    const snapshot = {
      slug: 'acme/shop',
      defaultBranch: 'main',
      files: {
        'package.json': '{"name":"shop","packageManager":"pnpm@10.17.1"}',
        'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
      },
    };
    expect(published.generateOnboarding(published.repoFacts(snapshot))).toEqual(
      core.generateOnboarding(core.repoFacts(snapshot)),
    );
    expect(() => published.repoFacts({ defaultBranch: 'main', files: {} })).toThrow(
      published.OnboardingRefusal,
    );
  });

  it('reads the disk through uptide/onboarding/node', async () => {
    const pure = (await import(
      /* @vite-ignore */ import.meta.resolve('uptide/onboarding')
    )) as typeof core;
    const node = (await import(
      /* @vite-ignore */ import.meta.resolve('uptide/onboarding/node')
    )) as typeof import('@uptide/core/onboarding/node');
    const repo = mkdtempSync(join(tmpdir(), 'uptide-onboarding-'));
    writeFileSync(join(repo, 'package.json'), '{"name":"shop","packageManager":"pnpm@10.17.1"}');
    writeFileSync(join(repo, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
    writeFileSync(join(repo, 'uptide.yml'), 'version: 1\nmaxCost: 3\n');
    expect(node.loadUptideConfig(repo)?.config.maxCost).toBe(3);
    const snapshot = node.snapshotFromDisk(repo, { slug: 'acme/shop', defaultBranch: 'main' });
    expect(pure.generateOnboarding(pure.repoFacts(snapshot)).files.map((f) => f.path)).toContain(
      pure.WORKFLOW_PATH,
    );
  });
});
