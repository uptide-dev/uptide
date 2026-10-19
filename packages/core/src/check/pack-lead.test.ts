import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTypescriptAdapter } from '../adapters/typescript/index.js';
import type { PackageFetcher, SurfaceCache } from '../domain/io.js';
import type { ApiSurface } from '../domain/surface.js';
import { fromChecked } from '../run-report/build.js';
import { check } from './check.js';

process.env.UPTIDE_CACHE_DIR = mkdtempSync(join(tmpdir(), 'uptide-test-cache-'));

const adapter = createTypescriptAdapter({ now: () => new Date('2026-10-19T00:00:00.000Z') });

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

type Manifest = {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

/**
 * uptide-demo/alanagoyal's shape (UPT-117): react and react-dom pinned at 18.2.0, typed by
 * @types/react and @types/react-dom 18, openai 4; latest react 19.3.1 and openai 7.39.0.
 */
const registry: Record<string, Record<string, Manifest>> = {
  react: { '18.2.0': {}, '19.3.1': {} },
  'react-dom': {
    '18.2.0': { peerDependencies: { react: '^18.2.0' } },
    '19.3.1': { peerDependencies: { react: '^19.3.1' } },
  },
  '@types/react': { '18.2.62': {}, '19.3.0': {} },
  '@types/react-dom': {
    '18.2.19': { dependencies: { '@types/react': '^18' } },
    '19.3.0': { peerDependencies: { '@types/react': '^19.3.0' } },
  },
  openai: { '4.104.0': {}, '7.39.0': {} },
};

const declarations: Record<string, (major: number) => string> = {
  '@types/react': () =>
    'export declare function useState<S>(initial: S): [S, (next: S) => void];\n',
  // react-dom 19 removed `render`: the compiler confirms the break at the call site.
  '@types/react-dom': (major) =>
    major < 19
      ? 'export declare function render(element: unknown, root: Element | null): void;\n'
      : 'export declare const version: string;\n',
  openai: (major) =>
    major < 5
      ? 'export default class OpenAI { constructor(opts?: { apiKey?: string; httpAgent?: unknown }); }\n'
      : 'export default class OpenAI { constructor(opts?: { apiKey?: string; fetchOptions?: unknown }); }\n',
};

function writePackage(dir: string, name: string, version: string): void {
  mkdirSync(dir, { recursive: true });
  const manifest: Record<string, unknown> = { name, version, main: 'index.js' };
  Object.assign(manifest, registry[name]?.[version] ?? {});
  const major = Number(version.split('.')[0]);
  const types = declarations[name];
  if (types) {
    manifest.types = 'index.d.ts';
    writeFileSync(join(dir, 'index.d.ts'), types(major));
  }
  if (!name.startsWith('@types/')) writeFileSync(join(dir, 'index.js'), 'module.exports = {};\n');
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
}

function alanagoyal(source: string): string {
  const repo = mkdtempSync(join(tmpdir(), 'uptide-pack-lead-'));
  const dependencies = { openai: '4.104.0', react: '18.2.0', 'react-dom': '18.2.0' };
  const devDependencies = { '@types/react': '18.2.62', '@types/react-dom': '18.2.19' };
  const all = { ...dependencies, ...devDependencies };
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'alanagoyal', version: '0.1.0', dependencies, devDependencies }),
  );
  for (const [name, version] of Object.entries(all))
    writePackage(join(repo, 'node_modules', name), name, version);
  writeFileSync(
    join(repo, 'package-lock.json'),
    JSON.stringify({
      name: 'alanagoyal',
      lockfileVersion: 3,
      packages: {
        '': { name: 'alanagoyal', dependencies, devDependencies },
        ...Object.fromEntries(
          Object.entries(all).map(([name, version]) => [
            `node_modules/${name}`,
            { version, ...(name in devDependencies ? { dev: true } : {}) },
          ]),
        ),
      },
    }),
  );
  writeFileSync(
    join(repo, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, lib: ['es2022', 'dom'] },
      include: ['src'],
    }),
  );
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src/index.ts'), source);
  return repo;
}

const latest: Record<string, string> = {
  react: '19.3.1',
  'react-dom': '19.3.1',
  '@types/react': '19.3.0',
  '@types/react-dom': '19.3.0',
  openai: '7.39.0',
};

const fetcher: PackageFetcher = {
  async resolve(name, requested) {
    return requested === 'latest' ? (latest[name] ?? requested) : requested;
  },
  async versions(name) {
    return Object.keys(registry[name] ?? {});
  },
  async manifests(name) {
    return registry[name] ?? {};
  },
  async fetch(name, version) {
    const dir = mkdtempSync(join(tmpdir(), 'uptide-pack-lead-target-'));
    writePackage(dir, name, version);
    return { name, version, dir };
  },
};

const REACT_APP = [
  "import { useState } from 'react';",
  "import { render } from 'react-dom';",
  'const [count] = useState(0);',
  "render(String(count), document.getElementById('root'));",
  '',
].join('\n');

describe('the pack of a group (UPT-117)', () => {
  // The Action names every used dependency, react before react-dom: react-dom's plan absorbed
  // react's group with react-dom first, so the group was reported as react-dom and the react
  // pack, looked up by that name, was never found ("no pack", tier generic).
  it.each([[['react', 'react-dom']], [['react-dom', 'react']]])(
    'reports react 18 → 19 under the react pack when asked for %j',
    async (only) => {
      const result = await check({
        cwd: alanagoyal(REACT_APP),
        only,
        adapter,
        fetcher,
        cache: memoryCache(),
        runtime: false,
      });
      expect(result.packages.map((p) => p.name)).toEqual(['react']);
      const react = result.packages[0];
      expect(react).toMatchObject({ installed: '18.2.0', target: '19.3.1', tier: 'verified' });
      expect(react?.members?.map((m) => m.name).sort()).toEqual([
        '@types/react',
        '@types/react-dom',
        'react',
        'react-dom',
      ]);
      expect(react?.findings.some((f) => f.severity === 'breaking')).toBe(true);
      // What the dashboard reads: the row's breaking list is the pack's answer.
      expect(fromChecked(react as NonNullable<typeof react>).analysis).toBe('pack');
    },
  );

  // openai has no group: its pack is a candidate, and the Action runs verified packs only.
  it('runs the openai pack on 4 → 7 only where candidates are allowed', async () => {
    const source = "import OpenAI from 'openai';\nexport const client = new OpenAI({});\n";
    const run = (allowCandidate: boolean) =>
      check({
        cwd: alanagoyal(source),
        only: ['openai'],
        allowCandidate,
        adapter,
        fetcher,
        cache: memoryCache(),
        runtime: false,
      });
    const verifiedOnly = (await run(false)).packages.find((p) => p.name === 'openai');
    expect(verifiedOnly).toMatchObject({ installed: '4.104.0', target: '7.39.0', tier: 'generic' });
    const withCandidate = (await run(true)).packages.find((p) => p.name === 'openai');
    expect(withCandidate?.tier).toBe('verified');
  });
});
