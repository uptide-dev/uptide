import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNpmFetcher } from '../../fetch/npm-fetcher.js';
import { compileAgainstTargets } from './compile.js';
import { consumerCompilerDir } from './compiler.js';

/**
 * `typescript` as the upgraded package: both sides compile the workspace's projects whole,
 * the installed side with the repository's compiler and the target side with the target's.
 */
const devCompiler = dirname(createRequire(import.meta.url).resolve('typescript/package.json'));

function repo(files: Record<string, string>, compiler: string | undefined = devCompiler): string {
  const dir = mkdtempSync(join(tmpdir(), 'uptide-compiler-upgrade-'));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  if (compiler) {
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    symlinkSync(compiler, join(dir, 'node_modules', 'typescript'), 'dir');
  }
  return dir;
}

const project = {
  'package.json': JSON.stringify({ name: 'app', devDependencies: { typescript: '5.9.3' } }),
  'tsconfig.json': JSON.stringify({
    compilerOptions: { target: 'es2020', module: 'commonjs', baseUrl: '.', noEmit: true },
    include: ['src'],
  }),
  // Nothing imports `typescript`: every file is judged by the compiler all the same.
  'src/a.ts': 'module Legacy { export const x = 1; }\nexport const y = Legacy.x;\n',
  // A project the root tsconfig never names is still built.
  'tools/tsconfig.json': JSON.stringify({
    compilerOptions: { module: 'commonjs', noEmit: true },
    include: ['*.ts'],
  }),
  'tools/b.ts': 'export function f(a, b?: string) { return b.length + a; }\n',
};

describe('compiling a TypeScript upgrade', () => {
  it('compiles every project of the workspace, not only files importing the package', async () => {
    // The same compiler on both sides: nothing is new, and every file was compiled.
    const signal = await compileAgainstTargets({ dir: repo(project) }, [
      { name: 'typescript', dir: devCompiler },
    ]);
    expect(signal.skipped).toBeUndefined();
    expect(signal.diagnostics).toEqual([]);
    expect(signal.coverage.compiled).toBe(2);
    expect(signal.coverage.compilers?.every((c) => c.own)).toBe(true);
  });

  it('never falls back to the bundled compiler when the repository installs none', async () => {
    const dir = repo(project, undefined);
    const signal = await compileAgainstTargets({ dir }, [{ name: 'typescript', dir: devCompiler }]);
    // A machine may have a TypeScript in a folder above the temp directory, which Node would
    // find too; either way it is an installed one, never the bundled compiler.
    if (consumerCompilerDir(dir) === undefined)
      expect(signal.skipped).toMatch(/installs no TypeScript/);
    else expect(signal.coverage.compilers?.every((c) => c.own)).toBe(true);
    expect(signal.diagnostics).toEqual([]);
  });

  it('says so, and compiles nothing, when the target has no JavaScript API (TypeScript 7)', async () => {
    const seven = mkdtempSync(join(tmpdir(), 'uptide-ts7-'));
    writeFileSync(
      join(seven, 'package.json'),
      JSON.stringify({ name: 'typescript', version: '7.0.2', main: 'version.cjs' }),
    );
    writeFileSync(join(seven, 'version.cjs'), "module.exports = { version: '7.0.2' };\n");
    const signal = await compileAgainstTargets({ dir: repo(project) }, [
      { name: 'typescript', dir: seven },
    ]);
    expect(signal.skipped).toMatch(/typescript 7\.0\.2 has no JavaScript compiler API/);
    expect(signal.diagnostics).toEqual([]);
  });
});

describe.skipIf(!process.env.UPTIDE_NETWORK)('compiling against TypeScript 6.0.3', () => {
  it('reports what the target compiler rejects, from its own diagnostics', async () => {
    const six = await createNpmFetcher().fetch('typescript', '6.0.3');
    const signal = await compileAgainstTargets({ dir: repo(project) }, [
      { name: 'typescript', dir: six.dir },
    ]);
    const codes = signal.diagnostics.map((d) => `${d.file}:${d.line} TS${d.code}`);
    expect(codes).toContain('src/a.ts:1 TS1540');
    // strict is on by default in 6.0: the nested project's untyped parameter.
    expect(codes).toContain('tools/b.ts:1 TS7006');
    // The tsconfig's own deprecation (baseUrl, TS5101) is the pack's finding, not a compile one.
    expect(signal.diagnostics.some((d) => d.file.endsWith('.json'))).toBe(false);
    expect(signal.coverage.compilers?.map((c) => c.version)).toEqual(['5.9.3', '6.0.3']);
  });
});
