import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Finding } from '../../domain/report.js';
import { ruleFor } from '../contract.js';
import { runFixtures } from '../tooling/fixtures.js';
import { incompatible, paramDestructureSites } from './detect.js';
import { expressPack } from './index.js';

it('express: every fixture rewrites and detects exactly its marked sites', () => {
  const result = runFixtures(expressPack, fileURLToPath(new URL('.', import.meta.url)));
  expect(result.cases.length).toBeGreaterThan(0);
  expect(result.unknown).toEqual([]);
  expect(result.rewriteFailures).toEqual([]);
  expect(result.falsePositives).toEqual([]);
  expect(result.falseNegatives).toEqual([]);
});

/** A compiler-only finding as `check` reports it on an Express 4 consumer compiled against 5. */
function compiled(code: number, message: string): Finding {
  const path = `TS${code}`;
  return {
    change: {
      package: 'express',
      from: '4.22.1',
      to: '5.2.1',
      path,
      kind: 'type',
      severity: 'breaking',
      source: 'types',
      confidence: 1,
    },
    usage: {
      file: 'src/routes.ts',
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 1,
      symbolPath: path,
      access: 'read',
      snippet: '',
      via: 'inferred',
      compileError: message,
      compileCode: code,
    },
    severity: 'breaking',
    confidence: 1,
    fixability: 'manual',
    reason: '',
  };
}

const claimed = (code: number, message: string) =>
  ruleFor(expressPack.rules, compiled(code, message))?.id;

describe('which rule claims what the compiler reports', () => {
  it('claims a route parameter widened to string | string[]', () => {
    expect(claimed(2322, "Type 'string | string[]' is not assignable to type 'string'.")).toBe(
      'params-string-array',
    );
    expect(
      claimed(
        2345,
        "Argument of type 'string | string[]' is not assignable to parameter of type 'string'.",
      ),
    ).toBe('params-string-array');
  });

  it('claims removed members by name, and leaves other errors to the generic tier', () => {
    expect(
      claimed(
        2551,
        "Property 'param' does not exist on type 'Request<ParamsDictionary>'. Did you mean 'params'?",
      ),
    ).toBe('req-param-removed');
    expect(
      claimed(
        2551,
        "Property 'sendfile' does not exist on type 'Response<any>'. Did you mean 'sendFile'?",
      ),
    ).toBe('sendfile-renamed');
    expect(
      claimed(
        2339,
        "Property 'mime' does not exist on type 'RequestHandlerConstructor<Response>'.",
      ),
    ).toBe('static-mime-removed');
    expect(claimed(2339, "Property 'query' does not exist on type 'typeof e'.")).toBe(
      'query-middleware-removed',
    );
    expect(
      claimed(2345, "Argument of type 'string' is not assignable to parameter of type 'number'."),
    ).toBe(undefined);
    expect(claimed(2339, "Property 'params' does not exist on type 'Foo'.")).toBe(undefined);
  });
});

describe('route strings path-to-regexp 8 reads differently', () => {
  it.each([
    ['*'],
    ['/assets/*'],
    ['/users/:id?'],
    ['/files/:name.:ext?'],
    ['/ab+cd'],
    ['/docs/(.*)'],
    ['/:type(a|b)/:id'],
    ['/[a|b]/:slug'],
    ['/{literal}'],
    ['/a/:'],
  ])('%s', (path) => expect(incompatible(path)).toBeDefined());

  it.each([['/'], ['/users/:id'], ['/files/:name.:ext'], ['/a-b_c.json'], ['/:id/edit']])(
    'leaves %s alone',
    (path) => expect(incompatible(path)).toBeUndefined(),
  );
});

describe('paramDestructureSites', () => {
  const text = [
    "import express from 'express';",
    'export function assign(req: express.Request) {',
    '  const { id, role } = req.params;',
    '  const copy = { ...req.params };',
    '  return save(id, role);',
    '}',
    'export function other(req: express.Request, params: { a: string }) {',
    '  const { a } = params;',
    '  return save(a);',
    '}',
  ].join('\n');

  it('anchors the destructuring an error identifier is bound by', () => {
    expect(paramDestructureSites(text, [{ line: 5, column: 15 }]).map((s) => s.line)).toEqual([3]);
  });

  it('leaves a destructuring of something other than req.params, and an error that is not on one of its names', () => {
    expect(paramDestructureSites(text, [{ line: 9, column: 15 }])).toEqual([]);
    expect(paramDestructureSites(text, [{ line: 5, column: 10 }])).toEqual([]);
  });
});
