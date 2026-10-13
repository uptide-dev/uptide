import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createTypescriptAdapter } from '../adapters/typescript/index.js';
import type { PackageFetcher, SurfaceCache } from '../domain/io.js';
import type { ApiSurface } from '../domain/surface.js';
import { check } from './check.js';

process.env.UPTIDE_CACHE_DIR = mkdtempSync(join(tmpdir(), 'uptide-test-cache-'));

const adapter = createTypescriptAdapter({ now: () => new Date('2026-09-27T00:00:00.000Z') });

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

/** `ui` as `react` is: untyped, typed by `@types/ui`, released with `ui-dom`, which nothing imports. */
const registry: Record<string, Record<string, { peerDependencies?: Record<string, string> }>> = {
  ui: { '1.0.0': {}, '2.0.0': {} },
  'ui-dom': {
    '1.0.0': { peerDependencies: { ui: '^1.0.0' } },
    '2.0.0': { peerDependencies: { ui: '^2.0.0' } },
  },
  '@types/ui': { '1.0.0': {}, '2.0.0': {} },
};

function writePackage(dir: string, name: string, version: string): void {
  mkdirSync(dir, { recursive: true });
  const manifest: Record<string, unknown> = { name, version, main: 'index.js' };
  const peers = registry[name]?.[version]?.peerDependencies;
  if (peers) manifest.peerDependencies = peers;
  if (name.startsWith('@types/')) {
    manifest.types = 'index.d.ts';
    writeFileSync(
      join(dir, 'index.d.ts'),
      version === '1.0.0'
        ? 'export declare function render(node: string): void;\n'
        : 'export declare function render(node: string, root: object): void;\n',
    );
  } else writeFileSync(join(dir, 'index.js'), 'exports.render = () => {};\n');
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
}

function consumer(): string {
  const repo = mkdtempSync(join(tmpdir(), 'uptide-companion-group-'));
  const dependencies = { ui: '1.0.0', 'ui-dom': '1.0.0', '@types/ui': '1.0.0' };
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'consumer', version: '0.0.0', dependencies }),
  );
  for (const [name, version] of Object.entries(dependencies))
    writePackage(join(repo, 'node_modules', name), name, version);
  writeFileSync(
    join(repo, 'package-lock.json'),
    JSON.stringify({
      name: 'consumer',
      lockfileVersion: 3,
      packages: {
        '': { name: 'consumer', dependencies },
        ...Object.fromEntries(
          Object.entries(dependencies).map(([name, version]) => [
            `node_modules/${name}`,
            { version },
          ]),
        ),
      },
    }),
  );
  writeFileSync(
    join(repo, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ['src'] }),
  );
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src/index.ts'), "import { render } from 'ui';\nrender('app');\n");
  return repo;
}

it('analyzes companions nothing imports at the versions the lead moves them to, in its group', async () => {
  // On a Next app (react-dom never imported, @types/react type-only) `check react` reported
  // react-dom and @types/react on their own at their installed versions, "up to date", while
  // react moved to 19: both were filtered out of react's group before it was analyzed.
  const fetched: string[] = [];
  const fetcher: PackageFetcher = {
    async resolve(_name, requested) {
      return requested === 'latest' ? '2.0.0' : requested;
    },
    async versions(name) {
      return Object.keys(registry[name] ?? {});
    },
    async manifests(name) {
      return registry[name] ?? {};
    },
    async fetch(name, version) {
      fetched.push(`${name}@${version}`);
      const dir = mkdtempSync(join(tmpdir(), 'uptide-target-'));
      writePackage(dir, name, version);
      return { name, version, dir };
    },
  };
  const result = await check({
    cwd: consumer(),
    only: ['ui'],
    adapter,
    fetcher,
    cache: memoryCache(),
    runtime: false,
  });
  expect(result.packages.map((p) => p.name)).toEqual(['ui']);
  const ui = result.packages[0];
  expect(ui?.target).toBe('2.0.0');
  expect(ui?.members).toEqual(
    expect.arrayContaining([
      { name: 'ui', installed: '1.0.0', target: '2.0.0' },
      { name: '@types/ui', installed: '1.0.0', target: '2.0.0' },
      { name: 'ui-dom', installed: '1.0.0', target: '2.0.0' },
    ]),
  );
  expect(ui?.members).toHaveLength(3);
  // Compiled against the upgrade `fix` makes: ui-dom linked at 2.0.0, @types/ui once.
  expect(fetched).toContain('ui-dom@2.0.0');
  expect(fetched.filter((f) => f === '@types/ui@2.0.0')).toHaveLength(1);
  expect(ui?.status).toBe('breaking');
});
