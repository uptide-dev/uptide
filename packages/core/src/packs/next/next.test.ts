import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { fixtureFinding, runFixtures } from '../tooling/fixtures.js';
import { nextPack } from './index.js';

it('next: every fixture rewrites and detects exactly its marked sites', () => {
  const result = runFixtures(nextPack, fileURLToPath(new URL('.', import.meta.url)));
  expect(result.cases.length).toBeGreaterThan(0);
  expect(result.unknown).toEqual([]);
  expect(result.rewriteFailures).toEqual([]);
  expect(result.falsePositives).toEqual([]);
  expect(result.falseNegatives).toEqual([]);
});

it('keeps unaliased cache exports assisted rather than renaming shadowed references', () => {
  const text = "import { unstable_cacheTag } from 'next/cache';\nunstable_cacheTag('x');\n";
  const finding = fixtureFinding(
    nextPack,
    {
      case: 'unaliased',
      file: 'app.ts',
      line: 1,
      rule: 'stable-cache-exports',
      keep: false,
      at: 'unstable_cacheTag',
    },
    text,
  );
  expect(
    nextPack.transform(text, finding, {
      from: '15.5.14',
      to: '16.4.0',
      includeDeprecated: true,
    }),
  ).toMatchObject({ text, applied: false });
});

it.each([
  [
    'async-request-apis',
    'TS2305',
    'Module "next/headers" has no exported member \'UnsafeUnwrappedCookies\'.',
  ],
  [
    'async-request-apis',
    'TS2339',
    "Property 'get' does not exist on type 'Promise<ReadonlyHeaders>'.",
  ],
  [
    'removed-amp',
    'TS2307',
    "Cannot find module 'next/amp' or its corresponding type declarations.",
  ],
  [
    'removed-runtime-config',
    'TS2307',
    "Cannot find module 'next/config' or its corresponding type declarations.",
  ],
  [
    'removed-root-params',
    'TS2305',
    'Module "next/server" has no exported member \'unstable_rootParams\'.',
  ],
])('claims %s from compiler evidence, never an unrelated diagnostic', (rule, path, message) => {
  const text = 'reportedSite;';
  const finding = fixtureFinding(
    nextPack,
    {
      case: 'compiler',
      file: 'app.ts',
      line: 1,
      rule,
      keep: false,
      kind: 'type',
      path,
      message,
    },
    text,
  );
  delete finding.rule;
  expect(nextPack.ruleOf?.(finding)).toBe(rule);
  expect(
    nextPack.transform(text, finding, { from: '15.5.14', to: '16.4.0', includeDeprecated: false }),
  ).toMatchObject({ text, applied: false });
  finding.usage.compileError = 'Unrelated application error';
  expect(nextPack.ruleOf?.(finding)).toBeUndefined();
});

it('does not turn Pages Router context params or unrelated arity errors into App Router findings', () => {
  const finding = fixtureFinding(
    nextPack,
    {
      case: 'pages',
      file: 'pages/[slug].tsx',
      line: 1,
      rule: 'async-request-apis',
      keep: false,
      kind: 'type',
      path: 'TS2339',
      message: "Property 'slug' does not exist on type 'ParsedUrlQuery | undefined'.",
    },
    'context.params.slug;',
  );
  delete finding.rule;
  expect(nextPack.ruleOf?.(finding)).toBeUndefined();
  finding.change.path = 'TS2554';
  finding.usage.compileError = 'Expected 2 arguments, but got 1.';
  expect(nextPack.ruleOf?.(finding)).toBeUndefined();
});
