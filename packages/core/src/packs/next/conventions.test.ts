import { expect, it } from 'vitest';
import { nextPack } from './index.js';

function migrate(file: string, text: string, rule: string) {
  const sites =
    nextPack.runtimeFindings?.({
      root: '/repo',
      installedDir: '/installed',
      targetDir: '/target',
      workspace: '/repo',
      from: '15.5.5',
      to: '16.0.1',
      usages: [],
      files: [file],
      read: () => text,
    }) ?? [];
  const finding = sites.find((f) => f.rule === rule);
  return {
    sites,
    result:
      finding &&
      nextPack.transform(text, finding, { from: '15.5.5', to: '16.0.1', includeDeprecated: true }),
  };
}
it('requires a build and moves all five installed release-group members', () => {
  expect(nextPack.requiresBuild).toBe(true);
  expect(nextPack.releaseGroup?.map((p) => p.name)).toEqual([
    'eslint-config-next',
    '@next/eslint-plugin-next',
    '@next/bundle-analyzer',
    '@next/mdx',
    '@next/third-parties',
  ]);
});
it.each(['middleware.ts', 'src/middleware.js'])(
  'renames %s and its function atomically from an inventory-only finding',
  (file) => {
    const { sites, result } = migrate(
      file,
      "export const config = { runtime: 'nodejs', matcher: '/admin' };\nexport default function middleware() { return middleware; }\n",
      'middleware-proxy',
    );
    expect(sites).toHaveLength(1);
    expect(sites[0]?.usage.file).toBe(file);
    expect(result).toMatchObject({
      applied: true,
      text: "export const config = {  matcher: '/admin' };\nexport default function proxy() { return proxy; }\n",
      edits: [{ kind: 'rename', file, to: file.replace('middleware.', 'proxy.') }],
    });
  },
);
it.each([
  "export const runtime = 'edge';",

  "export const config = { 'runtime': 'edge' };",
  'const proxy = 1;',
  "export { other } from './other';",
])('declines ambiguous middleware: %s', (prefix) => {
  expect(
    migrate('middleware.ts', `${prefix}\nexport function middleware() {}`, 'middleware-proxy')
      .result?.applied,
  ).toBe(false);
});
it.each([
  '',
  "export const config = { runtime: 'edge' };",
  'export const config = { runtime: chooseRuntime() };',
  "export const config = { runtime: 'nodejs', ...other };",
  "export const config = { runtime: 'nodejs', [key]: 'edge' };",
  "const config = { runtime: 'nodejs' };",
  "export const config = { runtime: 'nodejs' }; config.runtime = 'edge';",
])('keeps the deprecated finding without changing runtime: %s', (prefix) => {
  const text = `${prefix}\nexport function middleware() {}`;
  const { sites, result } = migrate('middleware.ts', text, 'middleware-proxy');
  expect(sites).toHaveLength(1);
  expect(sites[0]?.severity).toBe('deprecated');
  expect(result).toEqual({
    text,
    applied: false,
    reason:
      'middleware runs on Edge by default; proxy is Node-only. Keep middleware or migrate after choosing the runtime',
  });
});
it.each([
  "export const config = { 'runtime': 'nodejs' };",
  'export const config = { runtime: "nodejs" } as const;',
  "export const config = ({ runtime: 'nodejs' } satisfies Config);",
])('accepts equivalent static Node configuration: %s', (prefix) => {
  const { result } = migrate(
    'middleware.ts',
    `${prefix}\nexport function middleware() {}`,
    'middleware-proxy',
  );
  expect(result?.applied).toBe(true);
  expect(result?.text).toContain('function proxy()');
  expect(result?.text).not.toContain('nodejs');
  expect(result?.edits).toEqual([{ kind: 'rename', file: 'middleware.ts', to: 'proxy.ts' }]);
});
it('does not reject an unrelated runtime local in explicit Node middleware', () => {
  const text =
    "export const config = { runtime: 'nodejs' };\nexport function middleware() { const runtime = 'local'; return runtime; }";
  const { result } = migrate('middleware.ts', text, 'middleware-proxy');
  expect(result?.applied).toBe(true);
  expect(result?.text).toContain("const runtime = 'local'; return runtime;");
});
it.each(['next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.cjs'])(
  'removes only exported static eslint in %s',
  (file) => {
    const text =
      'const unrelated = { eslint: true };\nconst config = {\n  eslint: { ignoreDuringBuilds: true },\n  images: { unoptimized: true },\n};\n' +
      (file.endsWith('cjs') ? 'module.exports = config;' : 'export default config;');
    const { sites, result } = migrate(file, text, 'lint-removal');
    expect(sites).toHaveLength(1);
    expect(sites[0]?.usage.line).toBe(3);
    expect(result?.applied).toBe(true);
    expect(result?.text).toContain('const unrelated = { eslint: true }');
    expect(result?.text).toContain('images: { unoptimized: true }');
    expect(result?.text).not.toContain('ignoreDuringBuilds');
  },
);
it('detects dynamic eslint but declines removing side effects', () => {
  const result = migrate(
    'next.config.mjs',
    'export default { eslint: loadSettings() };',
    'lint-removal',
  );
  expect(result.sites).toHaveLength(1);
  expect(result.result?.applied).toBe(false);
});
it('does not rewrite arbitrary files or nested eslint objects', () => {
  expect(migrate('app.ts', 'export function middleware() {}', 'middleware-proxy').sites).toEqual(
    [],
  );
  expect(
    migrate('next.config.mjs', 'export default { plugin: { eslint: {} } };', 'lint-removal').sites,
  ).toEqual([]);
});
it.each([
  ['export default { images: {}, eslint: {} };', 'export default { images: {} };'],
  ['export default { eslint: {} };', 'export default {  };'],
])('removes eslint in the last or sole property position', (text, expected) => {
  expect(migrate('next.config.mjs', text, 'lint-removal').result?.text).toBe(expected);
});
it('preserves computed-key side effects', () => {
  expect(
    migrate('next.config.mjs', 'export default { eslint: { [effect()]: true } };', 'lint-removal')
      .result?.applied,
  ).toBe(false);
});
