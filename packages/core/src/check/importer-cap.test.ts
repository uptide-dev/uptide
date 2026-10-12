import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { PackageFetcher, SurfaceCache } from '../domain/io.js';
import type { CheckReport } from '../domain/report.js';
import type { ApiSurface } from '../domain/surface.js';

// The machine's free memory, as every memory reading in `check` sees it.
const machine = vi.hoisted(() => ({ freeBytes: 0 }));
vi.mock('./memory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./memory.js')>();
  return {
    ...actual,
    freeMemoryBytes: () => machine.freeBytes,
    memoryPolicy: (freeBytes?: number, cpus?: number, requested?: number, estimateMb?: number) =>
      actual.memoryPolicy(freeBytes ?? machine.freeBytes, cpus, requested, estimateMb),
  };
});

import { check } from './check.js';

const ROOT = resolve(import.meta.dirname, '../../../../fixtures');
const CONSUMER = join(ROOT, 'repos/synthetic-consumer');

const fetcher: PackageFetcher = {
  async resolve(name, requested) {
    if (name !== 'synthetic') throw new Error(`${name}: not found`);
    return requested === 'latest' ? '2.0.0' : requested;
  },
  async fetch(name, version) {
    const dir = mkdtempSync(join(tmpdir(), 'uptide-target-'));
    cpSync(join(ROOT, version === '2.0.0' ? 'synthetic-v2' : 'synthetic'), dir, {
      recursive: true,
    });
    return { name, version, dir };
  },
};

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

process.env.UPTIDE_CACHE_DIR = mkdtempSync(join(tmpdir(), 'uptide-test-cache-'));

/** The synthetic consumer, plus a wrapper of `synthetic`, a cheap importer and an expensive one. */
function consumer(): string {
  const dir = mkdtempSync(join(tmpdir(), 'uptide-importer-cap-'));
  cpSync(CONSUMER, dir, { recursive: true });
  const config = JSON.parse(readFileSync(join(dir, 'tsconfig.json'), 'utf8'));
  for (const key of Object.keys(config.compilerOptions.paths))
    config.compilerOptions.paths[key] = config.compilerOptions.paths[key].map((p: string) =>
      resolve(CONSUMER, p),
    );
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(config));
  writeFileSync(
    join(dir, 'src/wrapper.ts'),
    "import { parse } from 'synthetic';\nexport const item = parse('x');\n",
  );
  writeFileSync(
    join(dir, 'src/caller.ts'),
    "import { item } from './wrapper';\nexport const id = item.legacyId;\n",
  );
  // About 1 MB of source behind one importer: far more than 20% of the scoped program.
  writeFileSync(join(dir, 'src/heavy.ts'), `export const blob = '${'x'.repeat(1024 * 1024)}';\n`);
  writeFileSync(
    join(dir, 'src/heavy-caller.ts'),
    "import { item } from './wrapper';\nimport { blob } from './heavy';\nexport const both = [item.legacyId, blob];\n",
  );
  return dir;
}

const sites = (report: CheckReport): string[] =>
  report.packages
    .flatMap((p) => p.findings.map((f) => `${f.usage.file}:${f.usage.line} ${f.severity}`))
    .sort();

it('selects the same importers, and reports the same ones left out, whatever memory the machine reports', {
  timeout: 60_000,
}, async () => {
  const dir = consumer();
  const run = (gigabytes: number): Promise<CheckReport> => {
    machine.freeBytes = gigabytes * 1024 ** 3;
    return check({ cwd: dir, only: ['synthetic'], fetcher, cache: memoryCache(), runtime: false });
  };
  const small = await run(6);
  const large = await run(96);
  expect(small.importersNotAnalyzed).toEqual([
    {
      workspace: '.',
      files: ['src/heavy-caller.ts'],
      message: '1 importing file not analyzed (memory cap); findings in them may be missed',
    },
  ]);
  expect(large.importersNotAnalyzed).toEqual(small.importersNotAnalyzed);
  expect(sites(large)).toEqual(sites(small));
  // The cheap importer was compiled on both machines; the expensive one on neither.
  expect(sites(small)).toContain('src/caller.ts:2 breaking');
  expect(sites(small).some((s) => s.startsWith('src/heavy-caller.ts'))).toBe(false);
});
