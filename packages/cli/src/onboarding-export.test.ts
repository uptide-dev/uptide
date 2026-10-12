import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as core from '@uptide/core/onboarding';
import { describe, expect, it } from 'vitest';

// `uptide/onboarding`: the generator the GitHub App imports, built by tsup.onboarding.config.ts.
const root = fileURLToPath(new URL('..', import.meta.url));
const dir = `${root}dist/onboarding`;
const built = existsSync(`${dir}/index.js`);

/** What the bundle may weigh. Raise it on purpose, in a reviewed change, never to make CI pass. */
const BUDGET = { js: 300 * 1024, dts: 32 * 1024 };

interface Metafile {
  inputs: Record<string, { imports: { path: string; external?: boolean }[] }>;
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
  const meta = built ? metafile(`${dir}/metafile-esm.json`) : { inputs: {} };
  const inputs = Object.keys(meta.inputs);

  it('bundles core onboarding with yaml and semver, and nothing of the engine', () => {
    expect(new Set(inputs.map(packageOf).filter(Boolean))).toEqual(new Set(['yaml', 'semver']));
    const own = inputs.filter((i) => !packageOf(i)).map((i) => i.replace(/^.*core\/src\//, ''));
    expect(own.length).toBeGreaterThan(0);
    for (const file of own)
      expect(file, file).toMatch(
        /^(onboarding\/[\w-]+\.ts|errors\.ts|workspaces\.ts|llm\/(config|pricing|types)\.ts)$/,
      );
  });

  it('imports only fs and path at run time, besides the builtins yaml itself needs', () => {
    for (const [input, { imports }] of Object.entries(meta.inputs))
      for (const { path, external } of imports)
        if (external)
          expect(path, `${input} imports ${path}`).toMatch(
            packageOf(input) === 'yaml' ? /^(node:)?(process|buffer)$/ : /^(node:)?(fs|path)$/,
          );
  });

  it('stays within its size budget', () => {
    expect(statSync(`${dir}/index.js`).size).toBeLessThanOrEqual(BUDGET.js);
    expect(statSync(`${dir}/index.d.ts`).size).toBeLessThanOrEqual(BUDGET.dts);
  });

  it('ships its own types, with nothing left to resolve', () => {
    const types = readFileSync(`${dir}/index.d.ts`, 'utf8');
    expect(types).not.toMatch(/^import /m);
    for (const name of [
      'generateOnboarding',
      'repoFacts',
      'OnboardingRefusal',
      'RepoSnapshot',
      'parseUptideConfig',
    ])
      expect(types).toMatch(new RegExp(`\\b${name}\\b`));
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
});
