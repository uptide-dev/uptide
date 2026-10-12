import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { importSpecifier } from './import-specifier.js';

const scratch = mkdtempSync(join(tmpdir(), 'uptide-specifier-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(scratch, 'repo-'));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

it('uses the paths alias the file already imports through (saas-starter-kit)', () => {
  const root = repo({
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        moduleResolution: 'node',
        baseUrl: '.',
        paths: { '@/lib/*': ['lib/*'], '@/components/*': ['components/*'] },
      },
    }),
    'lib/stripe.ts': 'export const stripe = 1;',
    'pages/api/webhooks/stripe.ts': 'import env from "@/lib/env";\nimport Stripe from "stripe";\n',
  });
  expect(importSpecifier(root, 'pages/api/webhooks/stripe.ts', 'lib/stripe.ts')).toBe(
    '@/lib/stripe',
  );
});

it('uses an alias a neighbour imports through, and follows extends to find it', () => {
  const root = repo({
    'tsconfig.base.json': JSON.stringify({ compilerOptions: { paths: { '~/*': ['./src/*'] } } }),
    'tsconfig.json': JSON.stringify({ extends: './tsconfig.base.json' }),
    'src/lib/stripe.ts': '',
    'src/routes/billing.ts': 'import Stripe from "stripe";\n',
    'src/routes/account.ts': 'import { db } from "~/lib/db";\n',
  });
  expect(importSpecifier(root, 'src/routes/billing.ts', 'src/lib/stripe.ts')).toBe('~/lib/stripe');
});

it('writes an extensionless relative path when nothing nearby uses an alias or an extension', () => {
  const root = repo({
    'tsconfig.json': JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/lib/*': ['lib/*'] } },
    }),
    'lib/stripe.ts': '',
    'pages/api/webhooks/stripe.ts': 'import { a } from "../../../lib/a";\n',
  });
  // TS5097 without allowImportingTsExtensions: never `.ts` unless the compiler allows it.
  expect(importSpecifier(root, 'pages/api/webhooks/stripe.ts', 'lib/stripe.ts')).toBe(
    '../../../lib/stripe',
  );
});

it('keeps the extension the file writes: .js always, .ts only where the compiler allows it', () => {
  const files = {
    'src/lib/stripe.ts': '',
    'src/routes/billing.ts': 'import { a } from "./a.ts";\n',
  };
  const allowed = repo({
    ...files,
    'tsconfig.json': JSON.stringify({ compilerOptions: { allowImportingTsExtensions: true } }),
  });
  expect(importSpecifier(allowed, 'src/routes/billing.ts', 'src/lib/stripe.ts')).toBe(
    '../lib/stripe.ts',
  );
  const refused = repo({ ...files, 'tsconfig.json': '{}' });
  expect(importSpecifier(refused, 'src/routes/billing.ts', 'src/lib/stripe.ts')).toBe(
    '../lib/stripe',
  );
  const esm = repo({
    'src/lib/stripe.ts': '',
    'src/routes/billing.ts': 'import { a } from "./a.js";\n',
    'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'nodenext' } }),
  });
  expect(importSpecifier(esm, 'src/routes/billing.ts', 'src/lib/stripe.ts')).toBe(
    '../lib/stripe.js',
  );
  // node16/nodenext with nothing to go by: the extension the resolution requires.
  const bare = repo({
    'src/lib/stripe.ts': '',
    'src/routes/billing.ts': 'import Stripe from "stripe";\n',
    'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'nodenext' } }),
  });
  expect(importSpecifier(bare, 'src/routes/billing.ts', 'src/lib/stripe.ts')).toBe(
    '../lib/stripe.js',
  );
});
