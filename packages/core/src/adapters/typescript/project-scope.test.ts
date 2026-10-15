import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileAgainstTarget } from './compile.js';
import { projectScope } from './project-scope.js';

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'uptide-project-scope-')));
  const dir = join(root, 'repo');
  const write = (file: string, text: string | object) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), typeof text === 'string' ? text : JSON.stringify(text));
  };
  write('repo/package.json', { name: 'consumer', dependencies: { widget: '1.0.0' } });
  write('repo/node_modules/widget/package.json', {
    name: 'widget',
    version: '1.0.0',
    types: 'index.d.ts',
  });
  write('repo/node_modules/widget/index.d.ts', 'export declare function read(): { item: string };');
  write('target/package.json', { name: 'widget', version: '2.0.0', types: 'index.d.ts' });
  write('target/index.d.ts', 'export declare function read(): { item?: string };');
  const source = "import { read } from 'widget';\nexport const value: string = read().item;\n";
  const options = { strict: true, module: 'ESNext', moduleResolution: 'Bundler', types: [] };
  const compile = (files: string[], workspace = dir) =>
    compileAgainstTarget(
      { dir: workspace, root: dir, rootFiles: files.map((f) => join(workspace, f)) },
      'widget',
      join(root, 'target'),
      { files },
    );
  return { root, dir, write, source, options, compile };
}

describe('repository compile projects', () => {
  it('honors inherited include/exclude and explicit files, even outside include', async () => {
    const f = fixture();
    f.write('repo/tsconfig.base.json', {
      compilerOptions: f.options,
      include: ['src'],
      exclude: ['src/excluded.ts'],
    });
    f.write('repo/tsconfig.json', { extends: './tsconfig.base.json', files: ['explicit.ts'] });
    for (const file of ['src/main.ts', 'src/excluded.ts', 'explicit.ts', 'examples/demo.ts'])
      f.write(`repo/${file}`, f.source);
    const signal = await f.compile([
      'src/main.ts',
      'src/excluded.ts',
      'explicit.ts',
      'examples/demo.ts',
    ]);
    expect(signal.diagnostics.map((d) => d.file).sort()).toEqual(['explicit.ts', 'src/main.ts']);
    expect(signal.coverage.skipped).toEqual([
      { reason: 'outside the TypeScript project', count: 2 },
    ]);
  });

  it('includes an excluded file imported by a project root', async () => {
    const f = fixture();
    f.write('repo/tsconfig.json', {
      compilerOptions: f.options,
      include: ['src'],
      exclude: ['examples'],
    });
    f.write('repo/src/main.ts', "import '../examples/demo';");
    f.write('repo/examples/demo.ts', f.source);
    const signal = await f.compile(['examples/demo.ts']);
    expect(signal.diagnostics.map((d) => d.file)).toEqual(['examples/demo.ts']);
  });

  it('follows recursive project references and custom config names with their own options', async () => {
    const f = fixture();
    f.write('repo/tsconfig.json', { files: [], references: [{ path: './projects.json' }] });
    f.write('repo/projects.json', {
      files: [],
      references: [
        { path: './strict/config.json' },
        { path: './loose/config.json' },
        { path: './tsconfig.json' },
      ],
    });
    f.write('repo/strict/config.json', { compilerOptions: f.options, files: ['main.ts'] });
    f.write('repo/loose/config.json', {
      compilerOptions: { ...f.options, strict: false },
      files: ['main.ts'],
    });
    f.write('repo/strict/main.ts', f.source);
    f.write('repo/loose/main.ts', f.source);
    f.write('repo/examples/demo.ts', f.source);
    const signal = await f.compile(['strict/main.ts', 'loose/main.ts', 'examples/demo.ts']);
    expect(signal.diagnostics.map((d) => d.file)).toEqual(['strict/main.ts']);
    expect(signal.coverage.compiled).toBe(2);
    expect(signal.coverage.skipped).toEqual([
      { reason: 'outside the TypeScript project', count: 1 },
    ]);
  });

  it('uses independent workspace configs and does not synthesize a project for an uncovered workspace', async () => {
    const f = fixture();
    f.write('repo/packages/a/tsconfig.json', { compilerOptions: f.options, include: ['src'] });
    f.write('repo/packages/b/tsconfig.json', {
      compilerOptions: { ...f.options, strict: false },
      include: ['src'],
    });
    for (const name of ['a', 'b', 'c']) {
      f.write(`repo/packages/${name}/package.json`, { name });
      f.write(`repo/packages/${name}/src/main.ts`, f.source);
      f.write(`repo/packages/${name}/examples/demo.ts`, f.source);
    }
    const a = await f.compile(['src/main.ts', 'examples/demo.ts'], join(f.dir, 'packages/a'));
    const b = await f.compile(['src/main.ts'], join(f.dir, 'packages/b'));
    const c = await f.compile(['src/main.ts'], join(f.dir, 'packages/c'));
    expect(a.diagnostics.map((d) => d.file)).toEqual(['src/main.ts']);
    expect(b.diagnostics).toEqual([]);
    expect(c.diagnostics).toEqual([]);
    expect(c.coverage.skipped).toEqual([{ reason: 'outside the TypeScript project', count: 1 }]);
  });

  it('applies the root project file selection to a workspace without a config', async () => {
    const f = fixture();
    f.write('repo/tsconfig.json', { compilerOptions: f.options, include: ['packages/*/src'] });
    f.write('repo/packages/a/package.json', { name: 'a' });
    f.write('repo/packages/a/src/main.ts', f.source);
    f.write('repo/packages/a/examples/demo.ts', f.source);
    const signal = await f.compile(['src/main.ts', 'examples/demo.ts'], join(f.dir, 'packages/a'));
    expect(signal.diagnostics.map((d) => d.file)).toEqual(['src/main.ts']);
    expect(signal.coverage.skipped).toEqual([
      { reason: 'outside the TypeScript project', count: 1 },
    ]);
  });

  it('reports a file once when two projects both compile it', async () => {
    const f = fixture();
    f.write('repo/tsconfig.json', { compilerOptions: f.options, include: ['src'] });
    f.write('repo/tsconfig.build.json', { extends: './tsconfig.json' });
    f.write('repo/src/main.ts', f.source);
    const signal = await f.compile(['src/main.ts']);
    expect(signal.diagnostics.map((d) => d.file)).toEqual(['src/main.ts']);
    expect(signal.coverage.compiled).toBe(1);
    expect(signal.coverage.total).toBe(1);
  });

  it('preserves importer-based compilation when no tsconfig exists and reports that fallback', async () => {
    const f = fixture();
    f.write('repo/examples/demo.ts', f.source);
    expect(projectScope({ dir: f.dir }).projects).toEqual([]);
    const signal = await f.compile(['examples/demo.ts']);
    expect(signal.diagnostics.map((d) => d.file)).toEqual(['examples/demo.ts']);
    expect(signal.coverage.noTsconfig).toBe(true);
  });
});
