import childProcess from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { resetSharedState } from '../../shared-state.js';
import { compileAgainstTargets } from './compile.js';
import { createTypescriptAdapter } from './index.js';

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  resetSharedState();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(main?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'uptide-ts7-lib-'));
  dirs.push(dir);
  const files = {
    'package.json': JSON.stringify({ name: 'app', devDependencies: { typescript: '7.0.2' } }),
    'node_modules/typescript/package.json': JSON.stringify({
      name: 'typescript',
      version: '7.0.2',
      main: main ?? 'missing.cjs',
    }),
    ...(main
      ? { [`node_modules/typescript/${main}`]: "module.exports = { version: '7.0.2' };" }
      : {}),
    'tsconfig.json': JSON.stringify({
      compilerOptions: { lib: ['es2023'], strict: true, types: [], noEmit: true },
      include: ['src'],
    }),
    'src/index.ts': 'export const owns = Object.hasOwn({ value: 1 }, "value");\n',
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return dir;
}

it.each([undefined, 'version.cjs'])(
  'resolves explicit es2023 libs with a TS 7-style install (%s)',
  async (main) => {
    const signal = await compileAgainstTargets({ dir: fixture(main) }, []);
    expect(signal.skipped).toBeUndefined();
    expect(signal.baselineErrors).toBe(0);
    expect(signal.diagnostics).toEqual([]);
    expect(signal.coverage.compiled).toBe(1);
    expect(signal.coverage.compilers?.[0]?.own).toBe(false);
  },
);

it("uses the repository's standard library when it ships one without a compiler API", async () => {
  const dir = fixture();
  const require = createRequire(import.meta.url);
  const libs = join(dirname(require.resolve('typescript/package.json')), 'lib');
  const ownLibs = join(dir, 'node_modules/typescript/lib');
  cpSync(libs, ownLibs, { recursive: true });
  writeFileSync(
    join(ownLibs, 'lib.es2023.d.ts'),
    '/// <reference lib="es2022" />\ninterface ObjectConstructor { repoMarker(): boolean }\n',
  );
  writeFileSync(
    join(dir, 'src/index.ts'),
    'export const owns = Object.hasOwn({}, "x"); Object.repoMarker();',
  );
  const signal = await compileAgainstTargets({ dir }, []);
  expect(signal.baselineErrors).toBe(0);
  expect(signal.skipped).toBeUndefined();
});

it.each([0, 2])(
  'reports an Uptide setup problem when the parent type-check has %i errors but Uptide has one',
  async (count) => {
    const dir = fixture();
    writeFileSync(
      join(dir, 'node_modules/typescript/package.json'),
      JSON.stringify({ name: 'typescript', version: '7.0.2', bin: { tsc: 'bin/tsc' } }),
    );
    writeFileSync(join(dir, 'src/index.ts'), 'export const value: string = 1;');
    vi.spyOn(childProcess, 'execFileSync').mockImplementation(() => {
      if (count === 0) return '';
      throw Object.assign(new Error('type-check failed'), {
        status: 2,
        stdout:
          'src/index.ts(1,14): error TS2322: mismatch\nsrc/index.ts(1,20): error TS2322: mismatch\n',
      });
    });
    const signal = await compileAgainstTargets({ dir }, []);
    expect(signal.skipped).toMatch(/Uptide setup problem.*parent.*1.*repo.*type-check.*\b[02]\b/);
    expect(signal.diagnostics).toEqual([]);
    expect(signal.baselineErrors).toBe(0);
    expect(signal.coverage.compiled).toBe(0);
  },
);

it('compares only checked parent files and preserves matching repository errors', async () => {
  const dir = fixture();
  writeFileSync(
    join(dir, 'node_modules/typescript/package.json'),
    JSON.stringify({ name: 'typescript', version: '7.0.2', bin: { tsc: 'bin/tsc' } }),
  );
  writeFileSync(join(dir, 'src/index.ts'), 'export const value: string = 1;');
  const run = vi.spyOn(childProcess, 'execFileSync').mockImplementation(() => {
    throw Object.assign(new Error('type-check failed'), {
      status: 2,
      stdout:
        'src/index.ts(1,14): error TS2322: mismatch\nsrc/other.ts(1,1): error TS2322: mismatch\n',
    });
  });
  const signal = await compileAgainstTargets({ dir }, [], { files: ['src/index.ts'] });
  expect(signal.skipped).toBeUndefined();
  expect(signal.baselineErrors).toBe(1);
  expect(run).toHaveBeenCalled();
});

it('does not treat a failed parent checker as a clean baseline', async () => {
  const dir = fixture();
  writeFileSync(
    join(dir, 'node_modules/typescript/package.json'),
    JSON.stringify({ name: 'typescript', version: '7.0.2', bin: { tsc: 'bin/tsc' } }),
  );
  vi.spyOn(childProcess, 'execFileSync').mockImplementation(() => {
    throw new Error('failed');
  });
  const signal = await compileAgainstTargets({ dir }, []);
  expect(signal.skipped).toMatch(/Uptide setup problem.*parent type-check could not be verified/);
  expect(signal.baselineErrors).toBe(0);
});

it('runs the installed parent checker without writing build output into the repo', async () => {
  const dir = fixture();
  const require = createRequire(import.meta.url);
  writeFileSync(
    join(dir, 'node_modules/typescript/package.json'),
    JSON.stringify({ name: 'typescript', version: '7.0.2', bin: { tsc: 'tsc.cjs' } }),
  );
  writeFileSync(
    join(dir, 'node_modules/typescript/tsc.cjs'),
    `require(${JSON.stringify(require.resolve('typescript/bin/tsc'))});`,
  );
  const signal = await compileAgainstTargets({ dir }, []);
  expect(signal.skipped).toBeUndefined();
  expect(signal.baselineErrors).toBe(0);
});

it('loads bundled libs first referenced by the target overlay', async () => {
  const dir = fixture();
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { lib: ['es2020'], strict: true, types: [], moduleResolution: 'node' },
      include: ['src'],
    }),
  );
  writeFileSync(
    join(dir, 'src/index.ts'),
    'import { owns } from "widget"; export const value: string = owns({}, "x");',
  );
  const installed = join(dir, 'node_modules/widget');
  const target = join(dir, 'target');
  for (const pkg of [installed, target]) {
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({ name: 'widget', version: '1.0.0', types: 'index.d.ts' }),
    );
  }
  writeFileSync(
    join(installed, 'index.d.ts'),
    'export declare function owns(object: object, key: string): string;',
  );
  writeFileSync(
    join(target, 'index.d.ts'),
    '/// <reference lib="es2023" />\nexport declare const owns: typeof Object.hasOwn;',
  );
  const signal = await compileAgainstTargets({ dir }, [{ name: 'widget', dir: target }]);
  expect(signal.baselineErrors).toBe(0);
  expect(signal.diagnostics.map((d) => d.code)).toContain(2322);
});

it('rejects a nonzero parent exit without parseable diagnostics', async () => {
  const dir = fixture();
  writeFileSync(
    join(dir, 'node_modules/typescript/package.json'),
    JSON.stringify({ name: 'typescript', version: '7.0.2', bin: { tsc: 'bin/tsc' } }),
  );
  vi.spyOn(childProcess, 'execFileSync').mockImplementation(() => {
    throw Object.assign(new Error('failed'), { status: 1, stdout: '' });
  });
  const signal = await compileAgainstTargets({ dir }, []);
  expect(signal.skipped).toMatch(/Uptide setup problem/);
});

it('uses direct tsc with scripts off and identifies the checker in report notes', async () => {
  const dir = fixture();
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'app',
      devDependencies: { typescript: '7.0.2' },
      scripts: { typecheck: 'node side-effect.cjs', pretypecheck: 'node side-effect.cjs' },
    }),
  );
  writeFileSync(join(dir, 'side-effect.cjs'), 'throw new Error("package scripts must not run");');
  writeFileSync(
    join(dir, 'node_modules/typescript/package.json'),
    JSON.stringify({
      name: 'typescript',
      version: '7.0.2',
      bin: { tsc: 'bin/tsc' },
    }),
  );
  const run = vi.spyOn(childProcess, 'execFileSync').mockReturnValue('');
  const adapter = createTypescriptAdapter();
  await adapter.compileAgainstMany?.({ dir }, []);
  expect(run).toHaveBeenCalledExactlyOnceWith(
    process.execPath,
    [
      join(dir, 'node_modules/typescript/bin/tsc'),
      '--project',
      join(dir, 'tsconfig.json'),
      '--noEmit',
      '--pretty',
      'false',
      '--tsBuildInfoFile',
      expect.any(String),
    ],
    expect.objectContaining({ cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }),
  );
  expect(await adapter.repoWarnings?.({ dir })).toContain(
    'Parent type-check: ran node_modules/typescript/bin/tsc --project tsconfig.json directly (no package scripts).',
  );
  adapter.forgetRepo?.({ dir });
  expect(await adapter.repoWarnings?.({ dir })).toEqual([]);
});
