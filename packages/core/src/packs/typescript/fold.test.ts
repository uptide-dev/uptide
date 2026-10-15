import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import type { Finding } from '../../domain/report.js';
import { foldTypesDefault } from './fold.js';

/** A compiler-only finding as `check` reports it: the code as its path, the message at the site. */
const error = (file: string, line: number, code: number, message: string): Finding =>
  ({
    change: {
      package: 'typescript',
      from: '5.9.3',
      to: '6.0.3',
      path: `TS${code}`,
      kind: 'type',
      severity: 'breaking',
      source: 'types',
      confidence: 1,
    },
    usage: {
      file,
      line,
      column: 1,
      endLine: line,
      endColumn: 1,
      symbolPath: `TS${code}`,
      access: 'read',
      snippet: '',
      via: 'inferred',
      compileError: message,
      compileCode: code,
    },
    severity: 'breaking',
    confidence: 1,
    fixability: 'unknown',
    reason: 'compile error not attributed to a known API change',
  }) as Finding;

it('folds the `types` default errors into one finding at each tsconfig that leaves types unset (shogo82148/typescript-action)', () => {
  // The shape of shogo82148/typescript-action at 0f03405: src/ through tsconfig.json, tests
  // through tsconfig.eslint.json (ts-jest type-checks with it), neither listing `types`. Its
  // upgrade added `"types": ["jest", "node"]` to tsconfig.eslint.json: one line, not 14.
  const root = mkdtempSync(join(tmpdir(), 'uptide-types-default-'));
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  write('package.json', '{ "name": "action" }');
  write('tsconfig.base.json', '{ "compilerOptions": { "strict": true, "module": "NodeNext" } }');
  write(
    'tsconfig.json',
    '{\n  "extends": "./tsconfig.base.json",\n  "compilerOptions": { "outDir": "./dist" },\n  "include": ["src"]\n}\n',
  );
  write(
    'tsconfig.eslint.json',
    '{\n  "extends": "./tsconfig.base.json",\n  "compilerOptions": { "noEmit": true },\n  "include": ["__tests__", "src"]\n}\n',
  );
  // A project that already lists its types: its errors are its own, not the default's.
  write(
    'tools/tsconfig.json',
    '{ "compilerOptions": { "types": ["node"], "noEmit": true }, "include": ["*.ts"] }',
  );
  write('node_modules/@types/jest/package.json', '{ "name": "@types/jest" }');
  write(
    'node_modules/@types/jest/index.d.ts',
    'declare var describe: (name: string, fn: () => void) => void;\ndeclare var it: (name: string, fn: () => void) => void;\ndeclare const expect: (value: unknown) => { toBe(v: unknown): void };\n',
  );
  write('node_modules/@types/node/package.json', '{ "name": "@types/node" }');
  write(
    'node_modules/@types/node/timers.d.ts',
    'declare global {\n  function setTimeout(callback: () => void, ms?: number): number;\n}\nexport {};\n',
  );
  write('src/wait.ts', 'export const wait = () => setTimeout(() => {}, 1);\n');
  write(
    '__tests__/wait.test.ts',
    "describe('wait', () => {\n  it('waits', () => {\n    expect(1).toBe(1);\n    notAGlobal();\n  });\n});\n",
  );
  write('tools/run.ts', 'process.exit(0);\n');

  const findings = [
    error(
      '__tests__/wait.test.ts',
      1,
      2582,
      "Cannot find name 'describe'. Do you need to install type definitions for a test runner? Try `npm i --save-dev @types/jest` or `npm i --save-dev @types/mocha`.",
    ),
    error(
      '__tests__/wait.test.ts',
      2,
      2582,
      "Cannot find name 'it'. Do you need to install type definitions for a test runner? Try `npm i --save-dev @types/jest` or `npm i --save-dev @types/mocha`.",
    ),
    error('__tests__/wait.test.ts', 3, 2304, "Cannot find name 'expect'."),
    // Not a global any @types package declares: a real error of its own.
    error('__tests__/wait.test.ts', 4, 2304, "Cannot find name 'notAGlobal'."),
    error('src/wait.ts', 1, 2304, "Cannot find name 'setTimeout'."),
    // Its tsconfig lists `types`: not the default's doing.
    error(
      'tools/run.ts',
      1,
      2591,
      "Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.",
    ),
  ];
  const result = foldTypesDefault({ root, workspace: '.', findings });

  const anchors = result.filter((f) => f.rule === 'changed-defaults');
  expect(
    anchors.map((f) => [
      f.usage.file,
      f.usage.line,
      f.severity,
      f.anchorOnly,
      f.downstream?.map((d) => `${d.file}:${d.line}`),
    ]),
  ).toEqual([
    [
      'tsconfig.eslint.json',
      1,
      'deprecated',
      true,
      ['__tests__/wait.test.ts:1', '__tests__/wait.test.ts:2', '__tests__/wait.test.ts:3'],
    ],
    ['tsconfig.json', 1, 'deprecated', true, ['src/wait.ts:1']],
  ]);
  // What stands on its own: the undeclared name, and the error under a tsconfig that lists types.
  expect(
    result.filter((f) => f.rule === undefined).map((f) => `${f.usage.file}:${f.usage.line}`),
  ).toEqual(['__tests__/wait.test.ts:4', 'tools/run.ts:1']);
});

it('folds into the project that leaves types unset, not a nearer one that lists them (Borewit/music-metadata)', () => {
  // test/tsconfig.json lists mocha; the root tsconfig has no `include`, compiles test/ as well
  // and lists nothing. The errors are the root project's, and the upgrade added types there.
  const root = mkdtempSync(join(tmpdir(), 'uptide-types-default-root-'));
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  write('package.json', '{ "name": "lib" }');
  write('tsconfig.json', '{\n  "compilerOptions": { "module": "node16" }\n}\n');
  write(
    'test/tsconfig.json',
    '{ "extends": "../tsconfig.json", "compilerOptions": { "types": ["mocha"] } }',
  );
  write('node_modules/@types/mocha/package.json', '{ "name": "@types/mocha" }');
  write('node_modules/@types/mocha/index.d.ts', 'declare var describe: (n: string) => void;\n');
  write('test/a.test.ts', "describe('a');\n");
  const result = foldTypesDefault({
    root,
    workspace: '.',
    findings: [
      error(
        'test/a.test.ts',
        1,
        2593,
        "Cannot find name 'describe'. Do you need to install type definitions for a test runner? Try `npm i --save-dev @types/jest` or `npm i --save-dev @types/mocha` and then add 'jest' or 'mocha' to the types field in your tsconfig.",
      ),
    ],
  });
  expect(result.map((f) => [f.rule, f.usage.file, f.downstream?.length])).toEqual([
    ['changed-defaults', 'tsconfig.json', 1],
  ]);
});
