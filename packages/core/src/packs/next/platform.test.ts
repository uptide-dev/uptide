import { expect, it } from 'vitest';
import { platformEvidence } from './platform.js';

const inspect = (inventory: Record<string, string>) =>
  platformEvidence({
    from: '15',
    to: '16',
    includeDeprecated: false,
    inventory: Object.entries(inventory).map(([file, text]) => ({ file, text })),
  });
const pkg = (node?: string, typescript?: string) =>
  JSON.stringify({ engines: { node }, devDependencies: { typescript } });
it.each(['20.9.0', '>=20.9.0', '22', '>=22', '^22.0.0'])('omits satisfied minimums: %s', (node) => {
  expect(inspect({ 'package.json': pkg(node, '^5.9.3') })).toBe(false);
});
it('names only the runtime whose range permits an unsupported version', () => {
  expect(inspect({ 'package.json': pkg('>=18', '5.9.3') })).toBe(
    '`package.json` engines.node ">=18" permits Node below 20.9.0',
  );
  expect(inspect({ 'package.json': pkg('22', '~5.0.0') })).toContain('TypeScript below 5.1.0');
});
it('names missing and unresolvable versions', () => {
  expect(inspect({ 'package.json': pkg(undefined, '5.9.3') })).toContain('No Node version found');
  expect(inspect({ 'package.json': pkg('22') })).toContain('No TypeScript version found');
  expect(inspect({ 'package.json': pkg('lts/*', 'latest') })).toContain('No Node version found');
});
it('uses literal and matrix CI versions and runtime pins', () => {
  expect(inspect({ 'package.json': pkg(undefined, '5.9.3'), '.nvmrc': 'v22.0.0' })).toBe(false);
  expect(
    inspect({
      'package.json': pkg(undefined, '5.9.3'),
      '.github/workflows/ci.yml':
        'jobs:\n  test:\n    strategy:\n      matrix:\n        node: [18, 22]\n    steps:\n      - with:\n          node-version: ${{ matrix.node }}',
    }),
  ).toContain('"18" permits Node below 20.9.0');
});
