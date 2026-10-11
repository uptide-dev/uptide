import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { isolatedPnpmWorkspace } from './test-fixture.js';
import { diagnostics, newDiagnostics, typeResolutionFailure } from './verify.js';

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
