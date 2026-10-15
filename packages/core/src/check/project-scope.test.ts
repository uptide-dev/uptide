import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createTypescriptAdapter } from '../adapters/typescript/index.js';
import type { PackageFetcher } from '../domain/io.js';
import { nextPack } from '../packs/next/index.js';
import { sentryNextjsPack } from '../packs/sentry-nextjs/index.js';
import { check } from './check.js';

process.env.UPTIDE_CACHE_DIR = mkdtempSync(join(tmpdir(), 'uptide-scope-cache-'));

it.each([
  {
    name: 'wortkarte next.config.mjs:3',
    pack: nextPack,
    from: '15.5.27',
    to: '16.3.8',
    file: 'next.config.mjs',
    text: "/** @type {import('next').NextConfig} */\nexport default {\n  eslint: { ignoreDuringBuilds: true },\n};\n",
    expected: [[3, 'lint-removal']],
  },
  {
    name: 'coh3-stats next.config.js:6/:69',
    pack: sentryNextjsPack,
    from: '10.75.3',
    to: '11.1.0',
    file: 'next.config.js',
    text: [
      ...Array<string>(5).fill('// config'),
      'const { withSentryConfig } = require("@sentry/nextjs");',
      ...Array<string>(61).fill(''),
      'module.exports = withSentryConfig({}, {',
      '  disableLogger: true,',
      '});',
    ].join('\n'),
    expected: [
      [6, 'with-sentry-config-import'],
      [69, 'build-options'],
    ],
  },
])(
  'keeps pack findings outside tsconfig: $name',
  async ({ pack, from, to, file, text, expected }) => {
    const cwd = mkdtempSync(join(tmpdir(), 'uptide-config-scope-'));
    const writePackage = (dir: string, version: string) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: pack.name, version, types: 'index.d.ts' }),
      );
      writeFileSync(
        join(dir, 'index.d.ts'),
        'export interface NextConfig {}\nexport declare function withSentryConfig(...args: unknown[]): unknown;',
      );
      return { name: pack.name, version, dir };
    };
    const dependencies = { [pack.name]: from };
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', dependencies }));
    writeFileSync(
      join(cwd, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: { '': { dependencies }, [`node_modules/${pack.name}`]: { version: from } },
      }),
    );
    writePackage(join(cwd, 'node_modules', pack.name), from);
    writeFileSync(
      join(cwd, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { allowJs: true }, include: ['src/**/*.ts'] }),
    );
    mkdirSync(join(cwd, 'src'));
    writeFileSync(join(cwd, 'src/index.ts'), 'export {};');
    writeFileSync(join(cwd, file), text);
    const target = writePackage(join(cwd, 'target'), to);
    const fetcher: PackageFetcher = {
      resolve: async () => to,
      fetch: async () => target,
      versions: async () => [from, to],
      manifests: async () => ({ [from]: {}, [to]: {} }),
    };
    const result = await check({
      cwd,
      only: [pack.name],
      targets: { [pack.name]: to },
      packs: [pack],
      adapter: createTypescriptAdapter(),
      fetcher,
      runtime: false,
    });
    const sites = result.packages.flatMap((p) => p.findings).filter((f) => f.usage.file === file);
    expect(sites.map((f) => [f.usage.line, f.rule])).toEqual(expected);
    expect(sites.every((f) => f.severity === 'breaking')).toBe(true);
  },
);
