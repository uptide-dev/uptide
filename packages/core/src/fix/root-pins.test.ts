import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { planRootPins, writeRootPins } from './root-pins.js';
import { bumpCatalog, bumpVersions } from './versions.js';

const scratch = mkdtempSync(join(tmpdir(), 'uptide-root-pins-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const moves = [
  { name: '@types/react', to: '19.3.0' },
  { name: '@types/react-dom', to: '19.3.0' },
];
function fixture() {
  const root = mkdtempSync(join(scratch, 'repo-'));
  cpSync(resolve(import.meta.dirname, '../../../../fixtures/workspaces/root-pins'), root, {
    recursive: true,
  });
  return root;
}

it('requires consent, then changes only target and companion pins alongside declarations and catalogs', () => {
  const root = fixture();
  const read = (file: string) => readFileSync(join(root, file), 'utf8');
  const original = read('package.json');
  expect(() => planRootPins(root, moves)).toThrow('--update-pins');
  expect(read('package.json')).toBe(original);
  const pins = planRootPins(root, moves, true);
  expect(pins).toHaveLength(6);
  for (const move of moves) bumpVersions(root, move.name, move.to);
  expect(writeRootPins(root, pins)).toEqual([
    join(root, 'package.json'),
    join(root, 'pnpm-workspace.yaml'),
  ]);
  const expected = JSON.parse(original);
  expected.devDependencies['@types/react'] = '19.3.0';
  expected.resolutions['@types/react'] = '19.3.0';
  expected.resolutions['**/@types/react-dom'] = '19.3.0';
  expected.overrides['@types/react'] = '$@types/react';
  expected.overrides['@types/react-dom']['.'] = '19.3.0';
  expected.pnpm.overrides['@types/react'] = '19.3.0';
  expect(JSON.parse(read('package.json'))).toEqual(expected);
  expect(read('pnpm-workspace.yaml')).toContain("'@types/react': '19.3.0' # root pin");
  expect(read('pnpm-workspace.yaml')).toContain("'@types/react': '^19.3.0' # shared types");
  expect(read('pnpm-workspace.yaml')).toContain("'@types/react-dom': '~19.3.0'");
  expect(read('pnpm-workspace.yaml').match(/other: '18.0.26'/g)).toHaveLength(3);
  expect(JSON.parse(read('packages/app/package.json')).dependencies).toEqual({
    '@types/react': 'catalog:',
    '@types/react-dom': 'catalog:types',
    other: '1.0.0',
  });
  expect(planRootPins(root, moves, true)).toEqual([]);
});

it.each([
  { resolutions: { 'parent/@types/react': '18.0.26' } },
  { resolutions: { '@types/react@18': '18.0.26' } },
  { resolutions: { '@types/*': '18.0.26' } },
  { resolutions: { '@types/{react,react-dom}': '18.0.26' } },
  { resolutions: { '@types/rea[c]t': '18.0.26' } },
  { overrides: { parent: { '@types/react': '18.0.26' } } },
  { pnpm: { overrides: { 'parent>@types/react': '18.0.26' } } },
  { overrides: { '@types/react': 'npm:fork@18.0.26' } },
  { overrides: { '@types/react': '$other' } },
])('refuses ambiguous selectors or non-version values even with consent: %j', (extra) => {
  const root = fixture();
  const read = (file: string) => (file === 'package.json' ? JSON.stringify(extra) : undefined);
  expect(() => planRootPins(root, moves, true, read)).toThrow('cannot be updated safely');
});

it('does not confuse unscoped packages with scoped packages, prefixes or parent selectors', () => {
  const manifest = {
    resolutions: { '@types/react': '18.0.26', 'react-dom': '18.0.26', 'react/other': '18.0.26' },
    overrides: { react: { other: '18.0.26' }, '@types/react': '18.0.26' },
  };
  expect(
    planRootPins(fixture(), [{ name: 'react', to: '19.3.0' }], true, (file) =>
      file === 'package.json' ? JSON.stringify(manifest) : undefined,
    ),
  ).toEqual([]);
});

it.each([
  "overrides:\n  '@types/react': &pin 18.0.26\n  other: *pin\n",
  "pin: &pin 18.0.26\noverrides:\n  '@types/react': *pin\n",
  "pins: &pins\n  '@types/react': 18.0.26\noverrides: *pins\n",
])('refuses YAML aliases and anchors that could affect unrelated entries', (yaml) => {
  expect(() =>
    planRootPins(fixture(), moves, true, (file) => (file === 'package.json' ? '{}' : yaml)),
  ).toThrow('YAML anchor or alias');
});

it('leaves companion pins and catalogs alone unless that package is actually moving', () => {
  const root = fixture();
  const before = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const pins = planRootPins(root, moves.slice(0, 1), true);
  bumpVersions(root, '@types/react', '19.3.0');
  writeRootPins(root, pins);
  const after = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  expect(after.resolutions['**/@types/react-dom']).toBe(before.resolutions['**/@types/react-dom']);
  expect(after.overrides['@types/react-dom']).toEqual(before.overrides['@types/react-dom']);
  expect(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')).toContain(
    "'@types/react-dom': '~18.0.9'",
  );
});

it.each([
  'catalog:\n  react: &pin ^18.0.0\n  other: *pin\n',
  'pin: &pin ^18.0.0\ncatalog:\n  react: *pin\n',
])('rejects catalog edits that could change another package through a YAML anchor', (yaml) => {
  expect(() => bumpCatalog(yaml, 'react', '19.3.0', '')).toThrow('YAML anchor or alias');
});
