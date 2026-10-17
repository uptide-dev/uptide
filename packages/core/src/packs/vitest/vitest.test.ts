import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { packInventory } from '../inventory.js';
import { runFixtures } from '../tooling/fixtures.js';
import { vitestPack } from './index.js';

it('vitest: every fixture rewrites and detects exactly its marked sites', () => {
  const result = runFixtures(vitestPack, fileURLToPath(new URL('.', import.meta.url)));
  expect(result.cases.length).toBeGreaterThan(0);
  expect(result.unknown).toEqual([]);
  expect(result.rewriteFailures).toEqual([]);
  expect(result.falsePositives).toEqual([]);
  expect(result.falseNegatives).toEqual([]);
});

it('vitest: reads configs and jest-dom setup files that never import vitest (UPT-85)', () => {
  const root = mkdtempSync(join(tmpdir(), 'uptide-vitest-'));
  try {
    const write = (file: string, text: string) => {
      mkdirSync(join(root, 'app', file, '..'), { recursive: true });
      writeFileSync(join(root, 'app', file), text);
    };
    write('tsconfig.json', '{ "include": ["src"] }');
    write(
      'vitest.config.ts',
      "import { defineConfig } from '../shared.mjs';\nexport default defineConfig({ test: { coverage: { exclude: ['src/config'] } } });\n",
    );
    write('src/setupTests.ts', "import '@testing-library/jest-dom/vitest';\n");
    write('src/other.ts', "export const jestDom = 'not @testing-library/jest-dom/vitest';\n");
    const findings =
      vitestPack.runtimeFindings?.({
        root,
        workspace: 'app',
        from: '4.1.11',
        to: '5.0.2',
        installedDir: '',
        targetDir: '',
        usages: [],
        files: packInventory(root, 'app', vitestPack.inventory),
        read: (file) => {
          try {
            return readFileSync(join(root, file), 'utf8');
          } catch {
            return undefined;
          }
        },
      }) ?? [];
    expect(findings.map((f) => `${f.usage.file}:${f.usage.line}:${f.rule}`)).toEqual([
      'src/setupTests.ts:1:jest-dom-matchers',
      'vitest.config.ts:2:coverage-patterns',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
