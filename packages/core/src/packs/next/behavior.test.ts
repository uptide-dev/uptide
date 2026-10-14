import { expect, it } from 'vitest';
import { packDecisions } from '../decisions.js';
import { nextPack } from './index.js';

const decisions = (inventory: Record<string, string>) =>
  packDecisions(
    nextPack,
    {
      from: '15.5.5',
      to: '16.0.1',
      includeDeprecated: false,
      inventory: Object.entries(inventory).map(([file, text]) => ({ file, text })),
    },
    [],
  );
const scoped = (inventory: Record<string, string>) =>
  decisions({
    'package.json': JSON.stringify({
      engines: { node: '22' },
      devDependencies: { typescript: '5.9.3' },
    }),
    ...inventory,
  }).filter((line) => !line.includes('Also review'));

it('keeps an unrelated repository to scoped platform guidance and an upgrade-guide line', () => {
  expect(scoped({ 'next.config.mjs': 'export default {}' })).toEqual([]);
  expect(decisions({})).toEqual([
    expect.stringContaining('No Node version found'),
    expect.stringContaining('Also review the [Next 16 upgrade guide]'),
  ]);
  expect(
    scoped({
      'next.config.mjs':
        '// webpack: {}, images: {}\nexport default { description: "experimental.ppr", mywebpack: true }',
    }),
  ).toEqual([]);
});
it.each([
  ['turbopack', 'webpack() {}', 'Turbopack'],
  ['images', 'images: { remotePatterns: [] }', 'image defaults'],
  ['ppr', 'experimental: { ppr: true }', 'cacheComponents'],
  ['dynamicIO', 'experimental: { dynamicIO: true }', 'cacheComponents'],
  ['useCache', 'experimental: { useCache: true }', 'cacheComponents'],
  ['turbo', 'experimental: { turbo: {} }', 'config moves'],
  ['compiler', 'experimental: { reactCompiler: true }', 'config moves'],
  ['amp', 'amp: {}', 'unsupported AMP'],
  ['runtime', 'serverRuntimeConfig: { secret: process.env.SECRET }', 'server-secret visibility'],
  ['indicators', 'devIndicators: { buildActivity: false }', 'indicator options'],
  ['eslint', 'eslint: { ignoreDuringBuilds: true }', 'no longer lints'],
])('scopes %s to a named config file', (_name, config, expected) => {
  const lines = scoped({ 'web/next.config.mjs': `export default { ${config} }` });
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('web/next.config.mjs');
  expect(lines[0]).toContain(expected);
});
it('does not confuse stable options with experimental ones', () => {
  expect(
    scoped({
      'next.config.ts': 'export default { ppr: true, reactCompiler: true, cacheComponents: true }',
    }),
  ).toEqual([]);
});
it('reports package scripts and platform evidence with their locations', () => {
  const lines = scoped({
    'package.json': JSON.stringify({
      scripts: { build: 'next build', lint: 'next lint' },
      engines: { node: '18.x' },
      devDependencies: { typescript: '~5.0.0' },
    }),
    '.github/workflows/test.yml':
      'jobs:\n  test:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 18',
    '.nvmrc': '18\n',
  });
  expect(lines).toHaveLength(2);
  expect(lines.join('\n')).toContain('scripts.lint');
  expect(lines.join('\n')).toContain('engines.node "18.x"');
  expect(lines.join('\n')).toContain('.github/workflows/test.yml');
  expect(lines.join('\n')).toContain('TypeScript "~5.0.0"');
});
it('scopes middleware and route ppr by file convention and exported declaration', () => {
  expect(scoped({ 'src/middleware.ts': 'export function middleware() {}' })[0]).toContain(
    'Node-only',
  );
  expect(scoped({ 'src/app/page.tsx': 'export const experimental_ppr = true;' })[0]).toContain(
    'exports `experimental_ppr`',
  );
  expect(scoped({ 'src/app/page.tsx': 'const experimental_ppr = true;' })).toEqual([]);
});
it('reports missing parallel-slot fallbacks, not unrelated directories or complete slots', () => {
  expect(
    scoped({
      'src/app/@modal/page.tsx': '',
      'src/app/@feed/default.tsx': '',
      'src/app/@feed/page.tsx': '',
    }),
  ).toEqual([expect.stringContaining('`src/app/@modal/` has no default file')]);
  expect(scoped({ 'src/app/@modal/page.tsx': '', 'src/app/@modal/default.tsx': '' })).toEqual([]);
});

it('scopes AMP page config to exported config, not arbitrary objects', () => {
  expect(scoped({ 'pages/index.tsx': 'export const config = { amp: true };' })[0]).toContain(
    'exports config.amp',
  );
  expect(
    scoped({
      'pages/index.tsx': 'const unrelated = { amp: true };',
      'src/app/page.tsx': 'const data = { serverRuntimeConfig: true };',
    }),
  ).toEqual([]);
});
