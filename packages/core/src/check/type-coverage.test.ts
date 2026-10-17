import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTypescriptAdapter } from '../adapters/typescript/index.js';
import type { PackageFetcher, SurfaceCache } from '../domain/io.js';
import type { PackageReport } from '../domain/report.js';
import type { ApiSurface } from '../domain/surface.js';
import { check } from './check.js';
import { filesImporting } from './importers.js';
import { LOW_TYPE_COVERAGE, lowTypeCoverage } from './verdict.js';

const ROOT = resolve(import.meta.dirname, '../../../../fixtures');
const JS_HEAVY = join(ROOT, 'repos/js-heavy-consumer');

process.env.UPTIDE_CACHE_DIR = mkdtempSync(join(tmpdir(), 'uptide-test-cache-'));

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

const adapter = createTypescriptAdapter({ now: () => new Date('2026-09-27T00:00:00.000Z') });

async function synthetic(cwd: string): Promise<PackageReport> {
  const result = await check({ cwd, adapter, fetcher, cache: memoryCache(), runtime: false });
  return result.packages.find((p) => p.name === 'synthetic') as PackageReport;
}

it('lists the files that import a package, JavaScript included, and nothing else', () => {
  expect(filesImporting(JS_HEAVY, ['synthetic'])).toEqual([
    'src/api.js',
    'src/checked.js',
    'src/generated/schema.ts',
    'src/legacy/admin.js',
    'src/legacy/billing.js',
    'src/legacy/search.js',
    'src/orders.js',
    'src/reports.js',
    'src/types.ts',
    'src/users.js',
    'src/version.ts',
  ]);
  expect(filesImporting(JS_HEAVY, ['synthetic'], [join(JS_HEAVY, 'src/legacy')])).toHaveLength(8);
});

it('calls coverage low below the threshold only', () => {
  expect(LOW_TYPE_COVERAGE).toBe(0.5);
  expect(lowTypeCoverage({ checked: 3, affected: 10 })).toBe('types cover 3 of 10 affected files');
  expect(lowTypeCoverage({ checked: 5, affected: 10 })).toBeUndefined();
  expect(lowTypeCoverage({ checked: 0, affected: 0 })).toBeUndefined();
  expect(lowTypeCoverage(undefined)).toBeUndefined();
});

describe('a JS-heavy workspace (UPT-12)', () => {
  it('states the type coverage and does not present the compile as proof', async () => {
    const pkg = await synthetic(JS_HEAVY);
    // Two .ts files and the one under // @ts-check. Not the seven plain .js files, nor the .ts
    // file the tsconfig excludes: a TypeScript extension is not a type-check.
    expect(pkg.typeCoverage).toEqual({ checked: 3, affected: 11 });
    expect(pkg.verdict?.lowTypeCoverage).toBe('types cover 3 of 11 affected files');
    expect(pkg.verdict?.summary).toMatch(
      / · types cover 3 of 11 affected files: the compile result is not proof, tests and build decide$/,
    );
    expect(pkg.verdict?.summary).not.toMatch(/compiled against|new type error/);
    // Breaking-site detection still ran on the JavaScript: flagged, never on the compiler's word.
    const js = pkg.findings.filter(
      (f) => f.usage.file.endsWith('.js') && f.usage.file !== 'src/checked.js',
    );
    expect(new Set(js.map((f) => f.usage.file)).size).toBe(7);
    for (const f of js) expect(f.usage.checked).toBe(false);
  });

  it('says nothing extra once the repository checks its JavaScript', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'uptide-js-heavy-'));
    cpSync(JS_HEAVY, cwd, { recursive: true });
    const tsconfig = JSON.parse(readFileSync(join(cwd, 'tsconfig.json'), 'utf8')) as {
      compilerOptions: Record<string, unknown>;
    };
    tsconfig.compilerOptions.checkJs = true;
    tsconfig.compilerOptions.paths = { synthetic: [join(ROOT, 'synthetic/dist/index.d.ts')] };
    writeFileSync(join(cwd, 'tsconfig.json'), JSON.stringify(tsconfig));
    const pkg = await synthetic(cwd);
    // Every file but the excluded one.
    expect(pkg.typeCoverage).toEqual({ checked: 10, affected: 11 });
    expect(pkg.verdict?.lowTypeCoverage).toBeUndefined();
    expect(pkg.verdict?.summary).not.toMatch(/types cover/);
  });
});
