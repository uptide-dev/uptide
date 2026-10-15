import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Finding } from '../../domain/report.js';
import { runFixtures } from '../tooling/fixtures.js';
import { removeDownlevelIteration, rootDirSites, unsetDefaults } from './detect.js';
import { typescriptPack } from './index.js';

it('typescript: every fixture rewrites and detects exactly its marked sites', () => {
  const result = runFixtures(typescriptPack, fileURLToPath(new URL('.', import.meta.url)));
  expect(result.cases.length).toBeGreaterThan(0);
  expect(result.unknown).toEqual([]);
  expect(result.rewriteFailures).toEqual([]);
  expect(result.falsePositives).toEqual([]);
  expect(result.falseNegatives).toEqual([]);
});

const at = (file: string, line: number) => ({ usage: { file, line, column: 5 } }) as Finding;

describe('downlevelIteration removal', () => {
  const config = (target: string, extra = '') =>
    `{\n  "compilerOptions": {\n    "target": "${target}",${extra}\n    "downlevelIteration": true\n  }\n}\n`;
  it('removes the line when the target is ES2015 or later', () => {
    const result = removeDownlevelIteration(config('es2017'), at('tsconfig.json', 4));
    expect(result.applied).toBe(true);
    expect(result.text).toBe('{\n  "compilerOptions": {\n    "target": "es2017",\n  }\n}\n');
  });
  it('declines where it still changes the output: an ES5 target, or deprecations silenced', () => {
    expect(removeDownlevelIteration(config('es5'), at('tsconfig.json', 4)).applied).toBe(false);
    const silenced = config('es2017', '\n    "ignoreDeprecations": "6.0",');
    expect(removeDownlevelIteration(silenced, at('tsconfig.json', 5)).applied).toBe(false);
  });
  it('declines a property that shares its line', () => {
    const text = '{ "compilerOptions": { "target": "es2017", "downlevelIteration": true } }\n';
    expect(removeDownlevelIteration(text, at('tsconfig.json', 1)).applied).toBe(false);
  });
});

describe('defaults a tsconfig leaves unset', () => {
  it('follows extends inside the repository, and leaves a package config unknown', () => {
    const lines = unsetDefaults([
      { file: 'tsconfig.base.json', text: '{ "compilerOptions": { "strict": true } }' },
      {
        file: 'packages/api/tsconfig.json',
        text: '{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node"] } }',
      },
      { file: 'apps/web/tsconfig.json', text: '{ "extends": "@tsconfig/node20/tsconfig.json" }' },
    ]);
    expect(lines).toEqual([
      'packages/api/tsconfig.json: noUncheckedSideEffectImports is on: `import "./x.css"` needs a declaration',
      'tsconfig.base.json: types is [] (every @types package was included): list the ones the code uses; noUncheckedSideEffectImports is on: `import "./x.css"` needs a declaration',
    ]);
  });
  it('is a decision for the owner, and a finding only where the compiler errors fold into it', () => {
    const note = typescriptPack.behavior.find((b) => b.id === 'changed-defaults');
    expect(note?.reported).toEqual(['finding', 'decision']);
    expect(note?.severity).toBe('deprecated');
    expect(note?.detect).toBeUndefined();
    const decision = note?.applies?.({
      from: '5.9.3',
      to: '6.0.3',
      includeDeprecated: false,
      inventory: [{ file: 'tsconfig.json', text: '{ "compilerOptions": {} }' }],
    });
    expect(decision).toMatch(/tsconfig\.json: strict is on/);
  });
});

describe('rootDir default', () => {
  it('reports outDir only when the inputs share one directory and rootDir is unset', () => {
    const config = (options: string, include: string) =>
      `{\n  "compilerOptions": {\n${options}\n  },\n  "include": ${include}\n}\n`;
    expect(rootDirSites(config('    "outDir": "dist"', '["src"]'), 'tsconfig.json')).toHaveLength(
      1,
    );
    expect(
      rootDirSites(config('    "outDir": "dist"', '["src", "test"]'), 'tsconfig.json'),
    ).toEqual([]);
    expect(
      rootDirSites(config('    "outDir": "dist",\n    "noEmit": true', '["src"]'), 'tsconfig.json'),
    ).toEqual([]);
    expect(rootDirSites(config('    "outDir": "dist"', '["**/*.ts"]'), 'tsconfig.json')).toEqual(
      [],
    );
    expect(rootDirSites(config('    "outDir": "dist"', '["src"]'), 'src/config.json')).toEqual([]);
  });
});
