import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as onboarding from '@uptide/core/onboarding';
import * as report from '@uptide/core/run-report';
import { describe, expect, it } from 'vitest';

// The library entries of the published package, built by tsup.libs.config.ts.
// The packed tarball is tested by smoke/onboarding.mjs.
const root = fileURLToPath(new URL('..', import.meta.url));

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

/** What each library may contain and import. Budgets move on purpose, in review, never to pass CI. */
const LIBRARIES: Record<
  string,
  {
    /** Packages inlined into the bundle. */
    packages: string[];
    own: RegExp;
    /** Per entry: everything it imports at run time, following its chunks. */
    external: Record<string, string[]>;
    budget: { js: number; dts: number };
    /** Per entry: names its types must declare. */
    types: Record<string, string[]>;
  }
> = {
  onboarding: {
    // yaml is a dependency, not inlined: its CommonJS build calls require("process").
    packages: ['semver'],
    own: /^(onboarding\/[\w-]+\.ts|credentials\.ts|errors\.ts|glob\.ts|llm\/types\.ts)$/,
    // The pure entry stays off the file system; only the node entry reads the disk.
    external: { index: ['yaml'], node: ['fs', 'path', 'yaml'] },
    budget: { js: 120 * 1024, dts: 32 * 1024 },
    types: {
      index: [
        'generateOnboarding',
        'repoFacts',
        'OnboardingRefusal',
        'RepoSnapshot',
        'parseUptideConfig',
        'WORKFLOW_PATH',
      ],
      node: ['loadUptideConfig', 'snapshotFromDisk'],
    },
  },
  report: {
    packages: [],
    own: /^(run-report\/(index|schema|safe|summary)\.ts|credentials\.ts|onboarding\/validate\.ts)$/,
    // Pure: no file, network or process access at all.
    external: { index: [] },
    // The declarations carry the schema as a literal type: each field costs its JSON twice.
    budget: { js: 24 * 1024, dts: 20 * 1024 },
    types: {
      index: ['RunReport', 'Upgrade', 'RUN_REPORT_SCHEMA', 'reportProblems', 'assertSafeReport'],
    },
  },
};

for (const [name, spec] of Object.entries(LIBRARIES)) {
  const dir = `${root}dist/${name}`;
  const built = existsSync(`${dir}/index.js`);
  // `turbo run test` builds first; a bare `vitest` on a fresh clone has no dist yet.
  describe.skipIf(!built)(`uptide/${name}`, () => {
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
      visit(`dist/${name}/${entry}.js`);
      return { files: [...files], external: [...external].sort() };
    };

    it(`bundles core's ${name} code${spec.packages.length ? ` with ${spec.packages.join(' and ')}` : ''}, and nothing of the engine`, () => {
      expect(new Set(inputs.map(packageOf).filter(Boolean))).toEqual(new Set(spec.packages));
      const own = inputs.filter((i) => !packageOf(i)).map((i) => i.replace(/^.*core\/src\//, ''));
      expect(own.length).toBeGreaterThan(0);
      for (const file of own) expect(file, file).toMatch(spec.own);
    });

    it('imports at run time only what each entry is allowed to', () => {
      for (const [entry, external] of Object.entries(spec.external))
        expect(reach(entry).external, entry).toEqual(external);
    });

    it('keeps its main entry free of Node globals', () => {
      const code = reach('index')
        .files.map((f) => readFileSync(`${root}${f}`, 'utf8'))
        .join('\n');
      // semver's own `typeof process` guard is the one mention of one.
      expect(code).not.toMatch(/\bBuffer\b|\brequire\(|__dirname|__filename/);
    });

    it('stays within its size budget', () => {
      const bytes = reach('index').files.reduce((n, f) => n + statSync(`${root}${f}`).size, 0);
      expect(bytes).toBeLessThanOrEqual(spec.budget.js);
      expect(statSync(`${dir}/index.d.ts`).size).toBeLessThanOrEqual(spec.budget.dts);
    });

    it('ships its own types, importing only its own files', () => {
      for (const [entry, names] of Object.entries(spec.types)) {
        const types = readFileSync(`${dir}/${entry}.d.ts`, 'utf8');
        for (const [, from] of types.matchAll(/^(?:import|export) .* from '([^']+)'/gm))
          expect(from, from).toMatch(/^\.\//);
        for (const type of names) expect(types).toMatch(new RegExp(`\\b${type}\\b`));
      }
    });

    it('bundles no package the CLI bundle does not, so THIRD-PARTY-NOTICES covers it', () => {
      const cli = new Set(
        Object.keys(metafile(`${root}dist/metafile-esm.json`).inputs).map(packageOf),
      );
      for (const pkg of inputs.map(packageOf).filter(Boolean)) expect(cli.has(pkg), pkg).toBe(true);
    });
  });
}

describe.skipIf(!existsSync(`${root}dist/onboarding/index.js`))('uptide/onboarding', () => {
  it('resolves as uptide/onboarding and writes the same files as the engine', async () => {
    const published = (await import(
      /* @vite-ignore */ import.meta.resolve('uptide/onboarding')
    )) as typeof onboarding;
    expect(fileURLToPath(import.meta.resolve('uptide/onboarding'))).toBe(
      `${root}dist/onboarding/index.js`,
    );
    const snapshot = {
      slug: 'acme/shop',
      defaultBranch: 'main',
      files: {
        'package.json': '{"name":"shop","packageManager":"pnpm@10.17.1"}',
        'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
      },
    };
    expect(published.generateOnboarding(published.repoFacts(snapshot))).toEqual(
      onboarding.generateOnboarding(onboarding.repoFacts(snapshot)),
    );
    expect(() => published.repoFacts({ defaultBranch: 'main', files: {} })).toThrow(
      published.OnboardingRefusal,
    );
    const types = readFileSync(`${root}dist/onboarding/index.d.ts`, 'utf8');
    expect(types).not.toMatch(/\b(loadUptideConfig|snapshotFromDisk)\b/);
  });

  it('reads the disk through uptide/onboarding/node', async () => {
    const pure = (await import(
      /* @vite-ignore */ import.meta.resolve('uptide/onboarding')
    )) as typeof onboarding;
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

describe.skipIf(!existsSync(`${root}dist/report/index.js`))('uptide/report', () => {
  it('resolves as uptide/report and uptide/report/schema.json, the engine schema', async () => {
    const published = (await import(
      /* @vite-ignore */ import.meta.resolve('uptide/report')
    )) as typeof report;
    expect(published.RUN_REPORT_SCHEMA_ID).toBe('uptide.run/v1');
    expect(published.RUN_REPORT_SCHEMA).toEqual(report.RUN_REPORT_SCHEMA);
    const file = fileURLToPath(import.meta.resolve('uptide/report/schema.json'));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(
      JSON.parse(JSON.stringify(report.RUN_REPORT_SCHEMA)),
    );
    expect(published.reportProblems({ schema: 'uptide.run/v1' })).toContain(
      'engineVersion is required',
    );
  });
});
