import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { definePack } from './contract.js';
import { decisionInventory, packDecisions } from './decisions.js';
import type { PackContext } from './types.js';

const context: PackContext = { from: '1.0.0', to: '2.0.0', includeDeprecated: false };
const pack = definePack({
  meta: { package: 'example', from: '1', to: '2', sources: [], maintainer: 'uptide-dev' },
  rules: [],
  instructions: '',
  inventory: ['package.json', 'next.config.mjs', '.github/workflows/*.yml'],
  behavior: [
    { id: 'always', summary: 'Always review', reported: ['decision'] },
    { id: 'hidden', summary: 'Irrelevant', reported: ['decision'], applies: () => false },
    {
      id: 'scoped',
      summary: 'Fallback',
      reported: ['decision'],
      applies: (c) =>
        c.inventory?.some((f) => f.file === 'next.config.mjs')
          ? 'next.config.mjs has custom webpack: review Turbopack'
          : false,
    },
    { id: 'finding', summary: 'Finding only', reported: ['finding'], applies: () => true },
    { id: 'boolean', summary: 'Boolean applies', reported: ['decision'], applies: () => true },
  ],
});
it('renders only decision notes that apply, retaining the summary when unscoped or true', () => {
  expect(packDecisions(pack, context, [])).toEqual(['- Always review', '- Boolean applies']);
  expect(
    packDecisions(pack, { ...context, inventory: [{ file: 'next.config.mjs', text: '' }] }, []),
  ).toContain('- next.config.mjs has custom webpack: review Turbopack');
});
it('lets an explicit decisions hook own the section, including an empty answer', () => {
  expect(packDecisions({ ...pack, decisions: () => [] }, context, [])).toEqual([]);
  expect(
    packDecisions({ ...pack, decisions: (_c, rules) => [...rules] }, context, ['own']),
  ).toEqual(['own']);
});
it('snapshots workspace inventory using repository-relative paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'uptide-decisions-'));
  try {
    mkdirSync(join(root, 'web'));
    mkdirSync(join(root, '.github/workflows'), { recursive: true });
    writeFileSync(join(root, '.github/workflows/ci.yml'), 'node-version: 18');
    writeFileSync(join(root, 'web/package.json'), '{"engines":{"node":"18"}}');
    writeFileSync(join(root, 'web/next.config.mjs'), 'export default { webpack() {} }');
    writeFileSync(join(root, 'web/ignored.ts'), 'ignore');
    const inventory = decisionInventory(root, ['web'], pack);
    expect(inventory.map((f) => f.file)).toEqual([
      '.github/workflows/ci.yml',
      'web/next.config.mjs',
      'web/package.json',
    ]);
    writeFileSync(join(root, 'web/next.config.mjs'), 'export default {}');
    expect(inventory.find((f) => f.file === 'web/next.config.mjs')?.text).toContain('webpack');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('does not repeat decision summaries as generic run notes', () => {
  expect(pack.reviewNotes(context)).toEqual(['Finding only']);
});
