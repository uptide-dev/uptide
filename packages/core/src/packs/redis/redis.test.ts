import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import type { Finding } from '../../domain/report.js';
import type { Usage } from '../../domain/usage.js';
import { runFixtures } from '../tooling/fixtures.js';
import { rewriteScanIterator } from './detect.js';
import { appliesTo, redisPack } from './index.js';

it('redis: every fixture rewrites and detects exactly its marked sites', () => {
  const result = runFixtures(redisPack, fileURLToPath(new URL('.', import.meta.url)));
  expect(result.cases.length).toBeGreaterThan(0);
  expect(result.unknown).toEqual([]);
  expect(result.rewriteFailures).toEqual([]);
  expect(result.falsePositives).toEqual([]);
  expect(result.falseNegatives).toEqual([]);
});

const usage = (line: number, file = 'a.ts') =>
  ({ usage: { file, line, column: 1, symbolPath: '', snippet: '' } }) as unknown as Finding;

it('redis: each upgrade gets the rule sets of the majors it crosses', () => {
  expect(redisPack.supports('4.7.1', '5.12.1')).toBe(true);
  expect(redisPack.supports('4.7.1', '6.3.0')).toBe(true);
  expect(redisPack.supports('5.8.0', '6.3.0')).toBe(true);
  // A minor inside 5 is not a migration.
  expect(redisPack.supports('5.1.0', '5.12.1')).toBe(false);
  expect(appliesTo('scan-iterators', '4.7.1', '5.12.1')).toBe(true);
  expect(appliesTo('scan-iterators', '5.8.0', '6.3.0')).toBe(false);
  expect(appliesTo('client-defaults', '4.7.1', '5.12.1')).toBe(false);
  expect(appliesTo('client-defaults', '4.7.1', '6.3.0')).toBe(true);
  expect(appliesTo('unstable-resp3', '5.8.0', '6.3.0')).toBe(true);
  expect(appliesTo('generic', '5.8.0', '6.3.0')).toBe(true);
});

it('redis: a 5 → 6 check reports no 4 → 5 site, and a 4 → 5 check no 6 default', () => {
  const text = [
    "import { createClient } from 'redis';",
    'const client = createClient({ legacyMode: true });',
    'for await (const key of client.scanIterator()) console.log(key);',
  ].join('\n');
  const run = (from: string, to: string) =>
    (
      redisPack.runtimeFindings?.({
        root: '/r',
        workspace: '/r',
        from,
        to,
        installedDir: '',
        targetDir: '',
        usages: [{ file: 'a.ts' } as Usage],
        read: () => text,
      }) ?? []
    ).map((f) => `${f.rule}:${f.usage.line}`);
  expect(run('4.7.1', '5.12.1')).toEqual(['legacy-mode:2', 'scan-iterators:3']);
  expect(run('5.8.0', '6.3.0')).toEqual(['client-defaults:2']);
  expect(run('4.7.1', '6.3.0').sort()).toEqual(
    ['client-defaults:2', 'legacy-mode:2', 'scan-iterators:3'].sort(),
  );
});

it('redis: a 4 → 5 rewrite never runs on code already on 5', () => {
  const text =
    "import { createClient } from 'redis';\nconst o = { socket: { keepAlive: 1000 } };\n";
  const finding = {
    ...usage(2),
    rule: 'keep-alive',
    change: { from: '5.8.0', to: '6.3.0' },
  } as Finding;
  const out = redisPack.transform(text, finding, {
    from: '5.8.0',
    to: '6.3.0',
    includeDeprecated: true,
  });
  expect(out.applied).toBe(false);
  const v4 = redisPack.transform(text, finding, {
    from: '4.7.1',
    to: '6.3.0',
    includeDeprecated: true,
  });
  expect(v4.applied).toBe(true);
});

it('redis: a scan loop that breaks or continues is reported but not rewritten', () => {
  const text = [
    "import type { RedisClientType } from 'redis';",
    'declare const client: RedisClientType;',
    'export async function first() {',
    '  for await (const key of client.scanIterator()) {',
    "    if (key.startsWith('x')) break;",
    '  }',
    '  for await (const key of client.scanIterator()) {',
    '    for (const c of key) if (c) break;',
    '  }',
    '}',
  ].join('\n');
  expect(rewriteScanIterator(text, usage(4)).applied).toBe(false);
  // A `break` of a loop inside the body is its own.
  expect(rewriteScanIterator(text, usage(7)).applied).toBe(true);
});

it('redis: compiler findings are claimed by the rule the diagnostic names', () => {
  const at = (code: number, message: string, from = '5.12.1', to = '6.3.0') =>
    redisPack.ruleOf?.({
      change: {
        package: 'redis',
        from,
        to,
        path: `TS${code}`,
        kind: 'type',
        severity: 'breaking',
        source: 'compiler',
        confidence: 1,
      },
      usage: {
        file: 'a.ts',
        line: 1,
        column: 1,
        symbolPath: `TS${code}`,
        compileError: message,
        compileCode: code,
      },
      severity: 'breaking',
      confidence: 1,
    } as unknown as Finding);
  const wide =
    "Type 'RedisClientType<RedisDefaultModules, {}, {}, 3, {}>' is not assignable to type 'RedisClientType<RedisModules, RedisFunctions, RedisScripts, RespVersions, TypeMapping>'.";
  expect(at(2322, wide)).toBe('client-type');
  // The same diagnostic is not a 4 → 5 change.
  expect(at(2322, wide, '4.7.1', '5.12.1')).toBeUndefined();
  expect(
    at(
      2345,
      "Argument of type 'number' is not assignable to parameter of type 'RedisArgument'.",
      '4.7.1',
      '6.3.0',
    ),
  ).toBe('scan-cursor');
  expect(
    at(
      2305,
      `Module '"@redis/client/dist/lib/commands"' has no exported member 'RedisCommandArgument'.`,
      '4.7.1',
      '5.12.1',
    ),
  ).toBe('deep-imports');
  expect(
    at(
      2724,
      `'"redis"' has no exported member named 'SchemaFieldTypes'. Did you mean 'SchemaFieldType'?`,
      '4.7.1',
      '5.12.1',
    ),
  ).toBe('renamed-exports');
});
