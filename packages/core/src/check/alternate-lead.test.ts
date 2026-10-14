import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTypescriptAdapter } from '../adapters/typescript/index.js';
import type { PackageFetcher, SurfaceCache } from '../domain/io.js';
import type { ApiSurface } from '../domain/surface.js';
import { definePack } from '../packs/contract.js';
import { check } from './check.js';
import { standInLeads } from './stand-ins.js';

process.env.UPTIDE_CACHE_DIR = mkdtempSync(join(tmpdir(), 'uptide-test-cache-'));

const adapter = createTypescriptAdapter({ now: () => new Date('2026-09-27T00:00:00.000Z') });
const source = 'https://example.com/router-dom/changelog';

function memoryCache(): SurfaceCache {
  const store = new Map<string, ApiSurface>();
  return {
    async get(k) {
      return store.get(`${k.package}@${k.version}`);
    },
    async set(k, s) {
      store.set(`${k.package}@${k.version}`, s);
    },
  };
}

/**
 * `router` as `react-router` is, and `router-dom` as `react-router-dom`: a release of the same
 * version that depends on it exactly and re-exports it. 2.0.0 makes `navigate` take options.
 */
function writePackage(dir: string, name: string, version: string): void {
  mkdirSync(dir, { recursive: true });
  const manifest: Record<string, unknown> = {
    name,
    version,
    main: 'index.js',
    types: 'index.d.ts',
  };
  if (name === 'router-dom') {
    manifest.dependencies = { router: version };
    // Named re-exports, as react-router-dom 6 lists what it takes from react-router.
    writeFileSync(join(dir, 'index.d.ts'), "export { navigate } from 'router';\n");
    writeFileSync(join(dir, 'index.js'), "module.exports = require('router');\n");
  } else {
    writeFileSync(
      join(dir, 'index.d.ts'),
      version === '1.0.0'
        ? 'export declare function navigate(to: string): void;\n'
        : 'export declare function navigate(to: string, options: { replace: boolean }): void;\n',
    );
    writeFileSync(join(dir, 'index.js'), 'exports.navigate = () => {};\n');
  }
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
}

/** A repository that declares only `router-dom`, installed hoisted (npm) or in a store (pnpm). */
function consumer(layout: 'hoisted' | 'store'): string {
  const repo = mkdtempSync(join(tmpdir(), 'uptide-alternate-lead-'));
  const dependencies = { 'router-dom': '1.0.0' };
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'consumer', version: '0.0.0', dependencies }),
  );
  if (layout === 'hoisted') {
    writePackage(join(repo, 'node_modules', 'router-dom'), 'router-dom', '1.0.0');
    writePackage(join(repo, 'node_modules', 'router'), 'router', '1.0.0');
  } else {
    // pnpm: the workspace sees router-dom only; router sits beside it in the store.
    const store = join(repo, 'node_modules', '.pnpm', 'router-dom@1.0.0', 'node_modules');
    writePackage(join(store, 'router-dom'), 'router-dom', '1.0.0');
    writePackage(join(store, 'router'), 'router', '1.0.0');
    symlinkSync(join(store, 'router-dom'), join(repo, 'node_modules', 'router-dom'));
  }
  writeFileSync(
    join(repo, 'package-lock.json'),
    JSON.stringify({
      name: 'consumer',
      lockfileVersion: 3,
      packages: {
        '': { name: 'consumer', dependencies },
        'node_modules/router-dom': { version: '1.0.0', dependencies: { router: '1.0.0' } },
        'node_modules/router': { version: '1.0.0' },
      },
    }),
  );
  writeFileSync(
    join(repo, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ['src'] }),
  );
  mkdirSync(join(repo, 'src'));
  writeFileSync(
    join(repo, 'src/index.ts'),
    "import { navigate } from 'router-dom';\nnavigate('/');\n",
  );
  return repo;
}

const pack = definePack({
  meta: { package: 'router', from: '^1', to: '^2', sources: [], maintainer: 'test' },
  rules: [],
  instructions: '',
  inventory: ['package.json'],
  releaseGroup: [{ name: 'router-dom', source }],
  alternateLeads: [{ name: 'router-dom', source }],
});

const fetcher: PackageFetcher = {
  async resolve(_name, requested) {
    return requested === 'latest' ? '2.0.0' : requested;
  },
  async versions() {
    return ['1.0.0', '2.0.0'];
  },
  async manifests(name) {
    return Object.fromEntries(
      ['1.0.0', '2.0.0'].map((v) => [
        v,
        name === 'router-dom' ? { dependencies: { router: v } } : {},
      ]),
    );
  },
  async fetch(name, version) {
    const dir = mkdtempSync(join(tmpdir(), 'uptide-target-'));
    writePackage(dir, name, version);
    return { name, version, dir };
  },
};

/** What `check` reports for `router`, with the code importing from `from`. */
async function checkRouter(cwd: string, asked: string, from: string, packs = [pack]) {
  writeFileSync(join(cwd, 'src/index.ts'), `import { navigate } from '${from}';\nnavigate('/');\n`);
  const result = await check({
    cwd,
    only: [asked],
    packs,
    adapter,
    fetcher,
    cache: memoryCache(),
    runtime: false,
  });
  return result.packages;
}

/** The same repository with the lead declared as well: what a stand-in must match. */
function declaring(cwd: string): string {
  for (const file of ['package.json', 'package-lock.json']) {
    const json = JSON.parse(readFileSync(join(cwd, file), 'utf8'));
    const deps = file === 'package.json' ? json.dependencies : json.packages[''].dependencies;
    deps.router = '1.0.0';
    writeFileSync(join(cwd, file), JSON.stringify(json));
  }
  return cwd;
}

const summary = (p: Awaited<ReturnType<typeof checkRouter>>[number] | undefined) => ({
  status: p?.status,
  installed: p?.installed,
  target: p?.target,
  members: p?.members,
  findings: p?.findings.map((f) => [f.severity, f.change.path, f.usage.file, f.usage.line]),
});

describe('a lead declared only through its alternate lead', () => {
  it.each([
    ['router', 'hoisted'],
    ['router-dom', 'hoisted'],
    ['router', 'store'],
    ['router-dom', 'store'],
  ] as const)(
    'check %s (%s install) analyzes the pack lead, the alternate moving with it',
    async (asked, layout) => {
      const packages = await checkRouter(consumer(layout), asked, 'router-dom');
      expect(packages.map((p) => p.name)).toEqual(['router']);
      const router = packages[0];
      expect(router).toMatchObject({ installed: '1.0.0', target: '2.0.0' });
      expect(router?.undeclared).toEqual({ via: 'router-dom' });
      expect(router?.members).toEqual(
        expect.arrayContaining([
          { name: 'router', installed: '1.0.0', target: '2.0.0' },
          { name: 'router-dom', installed: '1.0.0', target: '2.0.0' },
        ]),
      );
      expect(router?.notes).toContain(
        'router is installed through router-dom, which this workspace declares instead: fix declares router 2.0.0 beside it',
      );
      // Analyzed, not skipped: in a store the lead is found beside the alternate's own copy.
      expect(router?.status).toBe('safe');
      if (layout === 'hoisted') {
        // Exactly what the same repository gets when it declares the lead itself.
        const declared = await checkRouter(declaring(consumer(layout)), 'router', 'router-dom');
        expect(summary(router)).toEqual(summary(declared[0]));
      }
    },
  );

  it('reports the breaking call when the code imports the lead, asked for by the alternate', async () => {
    const packages = await checkRouter(consumer('hoisted'), 'router-dom', 'router');
    expect(packages.map((p) => [p.name, p.status])).toEqual([['router', 'breaking']]);
    expect(summary(packages[0]).findings).toEqual([['breaking', 'navigate', 'src/index.ts', 2]]);
  });

  it('leaves the alternate alone without a pack that names it', async () => {
    const packages = await checkRouter(consumer('hoisted'), 'router-dom', 'router-dom', []);
    expect(packages.map((p) => p.name)).toEqual(['router-dom']);
  });
});

describe('standInLeads', () => {
  it('finds the lead hoisted and in the store, only when asked and undeclared', () => {
    for (const layout of ['hoisted', 'store'] as const) {
      const repo = consumer(layout);
      const declared = { '.': { 'router-dom': '1.0.0' } };
      expect(standInLeads(repo, ['.'], declared, [pack], ['router'])['.']?.router).toMatchObject({
        via: 'router-dom',
        version: '1.0.0',
      });
      expect(standInLeads(repo, ['.'], declared, [pack], ['other'])).toEqual({});
      expect(
        standInLeads(
          repo,
          ['.'],
          { '.': { router: '1.0.0', 'router-dom': '1.0.0' } },
          [pack],
          ['router'],
        ),
      ).toEqual({});
      expect(
        standInLeads(repo, ['.'], { '.': { 'router-dom': 'workspace:*' } }, [pack], ['router']),
      ).toEqual({});
    }
  });
});
