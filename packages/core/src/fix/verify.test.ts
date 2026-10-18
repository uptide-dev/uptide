import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { git } from './process.js';
import { isolatedPnpmWorkspace } from './test-fixture.js';
import {
  diagnostics,
  excludeArtifacts,
  lineMoves,
  moved,
  newDiagnostics,
  typeChecker,
  typeResolutionFailure,
  untrackedFiles,
} from './verify.js';

const scratch = mkdtempSync(join(tmpdir(), 'uptide-verify-tests-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const isolatedWorkspace = () => isolatedPnpmWorkspace(scratch);

it('resolves each workspace types from its own node_modules under the isolated pnpm layout', () => {
  const root = isolatedWorkspace();
  const baseline = diagnostics(root, ['packages/a', 'packages/b']);
  expect(baseline).toEqual([]);
  expect(typeResolutionFailure(root, baseline)).toBeUndefined();
});

it('calls a baseline that cannot see installed, declared types a resolution failure', () => {
  const root = isolatedWorkspace();
  const at = (file: string, code: number, message: string) => ({
    file,
    line: 1,
    column: 1,
    code,
    message,
  });
  const failure = typeResolutionFailure(root, [
    at('packages/a/tsconfig.json', 2688, "Cannot find type definition file for 'node'."),
    at(
      'packages/b/index.ts',
      2591,
      "Cannot find name 'Buffer'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.",
    ),
    at(
      'packages/b/index.ts',
      2307,
      "Cannot find module 'node:crypto' or its corresponding type declarations.",
    ),
  ]);
  expect(failure).toBe('3 baseline errors cannot see @types/node, which is declared and installed');
  // A package that is genuinely missing is the repository's own error, not ours.
  expect(
    typeResolutionFailure(root, [
      at(
        'packages/a/index.ts',
        2307,
        "Cannot find module 'left-pad' or its corresponding type declarations.",
      ),
    ]),
  ).toBeUndefined();
});

it('identifies diagnostics by start location, code and related location, never wording', () => {
  const d = {
    file: 'app.ts',
    line: 5,
    column: 10,
    code: 2322,
    message: 'short',
    relatedLocations: [{ file: 'props.ts', line: 3, column: 3 }],
  };
  expect(
    newDiagnostics([d], [{ ...d, message: 'short\n  TypeScript expanded its explanation' }]),
  ).toEqual([]);
  for (const changed of [
    { ...d, code: 2345 },
    { ...d, line: 6 },
    { ...d, column: 11 },
    { ...d, file: 'other.ts' },
    { ...d, relatedLocations: [{ file: 'props.ts', line: 4, column: 3 }] },
  ])
    expect(newDiagnostics([d], [changed])).toEqual([changed]);
  expect(newDiagnostics([d], [d, d])).toEqual([d]);
});

it('re-checks a workspace only when a file its program reads changed, and sees every change', () => {
  const root = realpathSync(mkdtempSync(join(scratch, 'incremental-')));
  const write = (file: string, text: string) => {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  write('package.json', '{"name":"mono"}');
  for (const name of ['a', 'b']) {
    write(`packages/${name}/package.json`, JSON.stringify({ name }));
    write(`packages/${name}/tsconfig.json`, JSON.stringify({ compilerOptions: { strict: true } }));
    write(`packages/${name}/src/index.ts`, 'export const n: number = 1;\n');
  }
  write('packages/b/src/use.ts', "import { n } from './index';\nexport const m: number = n;\n");
  const checker = typeChecker(root, ['packages/a', 'packages/b']);
  expect(checker.check()).toEqual([]);
  // An edit in b: b's program changes, and an error that follows from it in another file shows.
  write('packages/b/src/index.ts', "export const n: string = 'x';\n");
  const after = checker.check();
  expect(after.map((d) => [d.file, d.line, d.code])).toEqual([['packages/b/src/use.ts', 2, 2322]]);
  expect(after).toEqual(diagnostics(root, ['packages/a', 'packages/b']));
  // A new file is part of the program at the next check.
  write('packages/a/src/new.ts', 'export const k: number = "no";\n');
  expect(checker.check().map((d) => d.file)).toEqual([
    'packages/a/src/new.ts',
    'packages/b/src/use.ts',
  ]);
  // Reverted, as a rejected task is: the errors go with it.
  write('packages/b/src/index.ts', 'export const n: number = 1;\n');
  rmSync(join(root, 'packages/a/src/new.ts'));
  expect(checker.check()).toEqual([]);
  // Nothing changed: the last result, not a new program.
  const again = checker.check();
  expect(again).toEqual([]);
  checker.clear();
  write('packages/a/src/index.ts', 'export const n: number = "wrong";\n');
  expect(checker.check()).toEqual(diagnostics(root, ['packages/a', 'packages/b']));
  expect(checker.check().map((d) => d.file)).toEqual(['packages/a/src/index.ts']);
});

it('reports a file under a workspace tsconfig that does not include it, from the root program', () => {
  const root = realpathSync(mkdtempSync(join(scratch, 'unclaimed-')));
  const write = (file: string, text: string) => {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  write('package.json', '{"name":"mono"}');
  write(
    'tsconfig.json',
    JSON.stringify({ compilerOptions: { strict: true }, include: ['packages/**/*'] }),
  );
  // foo's tsconfig claims src/ only: scripts/ has no check but the root's (UPT-82 review).
  write('packages/foo/package.json', '{"name":"foo"}');
  write(
    'packages/foo/tsconfig.json',
    JSON.stringify({ compilerOptions: { strict: true }, include: ['src'] }),
  );
  write('packages/foo/src/index.ts', 'export const a: number = "src";\n');
  write('packages/foo/scripts/x.ts', 'export const b: number = "script";\n');
  // bar's tsconfig does not parse: its files stay the root's too.
  write('packages/bar/package.json', '{"name":"bar"}');
  write('packages/bar/tsconfig.json', '{ not json');
  write('packages/bar/src/y.ts', 'export const c: number = "broken config";\n');
  expect(diagnostics(root, ['.']).map((d) => [d.file, d.code])).toEqual([
    ['packages/bar/src/y.ts', 2322],
    ['packages/foo/scripts/x.ts', 2322],
    ['packages/foo/src/index.ts', 2322],
  ]);
});

it('matches a pre-existing error that an added line moved down, never one on an edited line', () => {
  const before = 'import a from "a";\nconst x = 1;\nfoo.bar;\n';
  const after = 'import a from "a";\nimport { s } from "@/lib/stripe";\nconst x = s;\nfoo.bar;\n';
  const moves = lineMoves([['f.ts', before, after]]);
  expect(moves.get('f.ts')).toEqual(
    new Map([
      [1, 1],
      [3, 4],
      [4, 5],
    ]),
  );
  const at = (line: number, code = 2339) => ({ file: 'f.ts', line, column: 5, code, message: 'm' });
  expect(newDiagnostics([at(3)], [at(4)], moves)).toEqual([]);
  expect(newDiagnostics([at(3)], [at(4)])).toEqual([at(4)]);
  // The edited line has no counterpart: an error there after the edit is the edit's.
  expect(newDiagnostics([at(2)], [at(3)], moves)).toEqual([at(3)]);
  expect(moved(at(2), moves)).toEqual(at(2));
});

it('finds an explicit lib newer than the target with a TS 7-style install (UPT-100)', () => {
  // TypeScript 7 ships no compiler API and no lib files, so the bundled compiler serves the
  // standard library; `lib: ["ES2023"]` under `target: "ES2022"` names a lib the target's
  // default does not load.
  const root = realpathSync(mkdtempSync(join(scratch, 'ts7-lib-')));
  const files = {
    'package.json': JSON.stringify({ name: 'app', devDependencies: { typescript: '7.0.2' } }),
    'node_modules/typescript/package.json': JSON.stringify({
      name: 'typescript',
      version: '7.0.2',
    }),
    'tsconfig.json': JSON.stringify({
      compilerOptions: { target: 'ES2022', lib: ['ES2023'], strict: true, types: [] },
      include: ['src'],
    }),
    'src/index.ts': 'export const owns = Object.hasOwn({ value: 1 }, "value");\n',
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  expect(diagnostics(root, ['.'])).toEqual([]);
});

it('hides test artifacts of a project in a subdirectory, names with pattern characters included', () => {
  const top = realpathSync(mkdtempSync(join(scratch, 'artifacts-')));
  git(top, 'init', '-q');
  const root = join(top, 'app');
  mkdirSync(join(root, 'reports'), { recursive: true });
  const files = ['test report[1].xml', 'reports/#junit!.xml'];
  for (const file of files) writeFileSync(join(root, file), '<testsuites/>');
  expect(untrackedFiles(root).sort()).toEqual([...files].sort());
  excludeArtifacts(root, files);
  for (const file of files) writeFileSync(join(root, file), '<testsuites/>');
  writeFileSync(join(root, 'test report1.xml'), 'not an artifact');
  expect(untrackedFiles(root)).toEqual(['test report1.xml']);
});
