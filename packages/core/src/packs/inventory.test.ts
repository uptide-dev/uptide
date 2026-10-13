import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { definePack } from './contract.js';
import { packInventory } from './inventory.js';

const root = mkdtempSync(join(tmpdir(), 'uptide-inventory-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
it('finds declared config and convention files independently of imported usages', () => {
  for (const file of [
    'next.config.mjs',
    'src/middleware.ts',
    'app/a/default.tsx',
    'node_modules/pkg/middleware.ts',
    'other.ts',
  ]) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), 'old config');
  }
  symlinkSync(join(root, 'src'), join(root, 'linked'));
  expect(
    packInventory(root, '.', [
      'next.config.{js,mjs,ts,cjs}',
      'src/middleware.{js,ts}',
      '**/default.tsx',
      '**/middleware.ts',
    ]),
  ).toEqual(['app/a/default.tsx', 'next.config.mjs', 'src/middleware.ts']);
  const spec = {
    meta: { package: 'toy', from: '^1', to: '^2', sources: [], maintainer: 'test' },
    inventory: ['next.config.mjs'],
    rules: [],
    instructions: '',
    behavior: [
      {
        id: 'config',
        summary: 'removed',
        reported: ['finding'] as const,
        detect: () => [{ line: 1, column: 1, snippet: 'old config' }],
      },
    ],
  };
  const pack = definePack(spec);
  const input = {
    root,
    workspace: '.',
    from: '1.0.0',
    to: '2.0.0',
    installedDir: '',
    targetDir: '',
    usages: [],
    files: ['next.config.mjs'],
    read: () => 'old config',
  };
  expect(pack.runtimeFindings?.(input).map((f) => f.usage.file)).toEqual(['next.config.mjs']);
});
it('rejects inventory paths outside the workspace', () => {
  expect(() => packInventory(root, '.', ['../secret'])).toThrow('Invalid pack inventory');
});
