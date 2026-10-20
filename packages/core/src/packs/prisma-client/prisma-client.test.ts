import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { runFixtures } from '../tooling/fixtures.js';
import { prismaClientPack } from './index.js';

it('@prisma/client: every fixture rewrites and detects exactly its marked sites', () => {
  const result = runFixtures(prismaClientPack, fileURLToPath(new URL('.', import.meta.url)));
  expect(result.cases.length).toBeGreaterThan(0);
  expect(result.unknown).toEqual([]);
  expect(result.rewriteFailures).toEqual([]);
  expect(result.falsePositives).toEqual([]);
  expect(result.falseNegatives).toEqual([]);
});

describe('runtime findings', () => {
  const root = mkdtempSync(join(tmpdir(), 'uptide-prisma-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const write = (files: Record<string, string>) => {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
    }
  };
  const run = (inventory: string[]) =>
    (
      prismaClientPack.runtimeFindings?.({
        root,
        workspace: '.',
        from: '6.19.3',
        to: '7.10.1',
        installedDir: '',
        targetDir: '',
        // `check` finds no usage of @prisma/client: its types are the generated client.
        usages: [],
        files: inventory,
        read: (file) => {
          try {
            return readFileSync(join(root, file), 'utf8');
          } catch {
            return undefined;
          }
        },
      }) ?? []
    ).map((f) => `${f.usage.file}:${f.usage.line} ${f.rule}`);

  write({
    'tsconfig.json': '{ "include": ["src"] }',
    'src/db.ts':
      "import { PrismaClient } from '@prisma/client';\nexport const db = new PrismaClient();\n",
    'src/other.ts': 'export const PrismaClient = 1;\n',
    'package.json': '{\n  "scripts": {\n    "db:deploy": "prisma migrate deploy"\n  }\n}\n',
  });

  it('reads the TypeScript project, not only importing files', () => {
    expect(run(['package.json'])).toEqual([
      'package.json:3 env-not-loaded',
      'src/db.ts:2 client-adapter',
    ]);
  });

  it('reports no .env script where a Prisma config already existed on 6', () => {
    write({ 'prisma.config.ts': "export default { schema: 'prisma/schema.prisma' };\n" });
    expect(run(['package.json', 'prisma.config.ts'])).toEqual(['src/db.ts:2 client-adapter']);
  });
});

describe('decisions', () => {
  const decide = (id: string, to: string, inventory: Record<string, string>) =>
    prismaClientPack.behavior
      .find((b) => b.id === id)
      ?.applies?.({
        from: '6.19.3',
        to,
        includeDeprecated: false,
        inventory: Object.entries(inventory).map(([file, text]) => ({ file, text })),
      });
  const schema =
    'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n\nenum Status {\n  PENDING @map("pending")\n}\n';

  it('names where the app read its URL on 6', () => {
    expect(decide('env-not-loaded', '7.10.1', { 'prisma/schema.prisma': schema })).toMatch(
      /`prisma\/schema.prisma:3` reads DATABASE_URL with env\(\)/,
    );
  });

  it('warns about mapped enums only for a target that changes them', () => {
    expect(decide('mapped-enum-values', '7.2.0', { 'prisma/schema.prisma': schema })).toMatch(
      /prisma\/schema.prisma:7/,
    );
    expect(decide('mapped-enum-values', '7.10.1', { 'prisma/schema.prisma': schema })).toBe(false);
  });

  it('names a Node or TypeScript the repository allows below the minimums', () => {
    const manifest = JSON.stringify({
      engines: { node: '>=18' },
      devDependencies: { typescript: '^5.9.3' },
    });
    expect(decide('runtime-minimums', '7.10.1', { 'package.json': manifest })).toMatch(
      /`package.json` allows Node ">=18"$/,
    );
    expect(decide('runtime-minimums', '7.10.1', { '.nvmrc': '22\n' })).toBe(false);
  });
});
