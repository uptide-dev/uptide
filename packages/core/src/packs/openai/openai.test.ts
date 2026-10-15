import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Finding } from '../../domain/report.js';
import { detectIn, ruleFor } from '../contract.js';
import { runFixtures } from '../tooling/fixtures.js';
import type { PackContext } from '../types.js';
import { openaiPack } from './index.js';

it('openai: every fixture rewrites and detects exactly its marked sites', () => {
  const result = runFixtures(openaiPack, fileURLToPath(new URL('.', import.meta.url)));
  expect(result.cases.length).toBeGreaterThan(0);
  expect(result.unknown).toEqual([]);
  expect(result.rewriteFailures).toEqual([]);
  expect(result.falsePositives).toEqual([]);
  expect(result.falseNegatives).toEqual([]);
});

const context: PackContext = { from: '4.104.0', to: '7.32.0', includeDeprecated: true };

/** The finding `check` reports at a line: a compiler error, or a pack site. */
function finding(
  line: number,
  rule: string | undefined,
  change: { path?: string; kind?: Finding['change']['kind']; message?: string } = {},
): Finding {
  const path = change.path ?? 'site';
  return {
    change: {
      package: 'openai',
      from: context.from,
      to: context.to,
      path,
      kind: change.kind ?? 'type',
      severity: 'breaking',
      source: 'types',
      confidence: 1,
    },
    usage: {
      file: 'consumer.ts',
      line,
      column: 1,
      endLine: line,
      endColumn: 1,
      symbolPath: path,
      access: 'call',
      snippet: '',
      via: 'direct',
      ...(change.message ? { compileError: change.message } : {}),
    },
    severity: 'breaking',
    confidence: 1,
    fixability: 'mechanical',
    reason: '',
    ...(rule ? { rule } : {}),
  } as Finding;
}

const lines = (...code: string[]) => code.join('\n');

describe('openai: sites a rule finds but must not rewrite', () => {
  it('leaves path ids with side effects to the agent', () => {
    const text = lines(
      "import OpenAI from 'openai';",
      'const client = new OpenAI();',
      'await client.beta.threads.runs.retrieve(await threadFor(user), runId);',
    );
    expect(detectIn(openaiPack, 'consumer.ts', text)).toEqual([
      { rule: 'named-path-params', line: 3 },
    ]);
    const out = openaiPack.transform(text, finding(3, 'named-path-params'), context);
    expect(out.applied).toBe(false);
    expect(out.reason).toMatch(/evaluation order/);
  });

  it('tells a query from request options on steps.list', () => {
    const text = lines(
      "import OpenAI from 'openai';",
      'const client = new OpenAI();',
      'await client.beta.threads.runs.steps.list(threadId, runId, { limit: 5 });',
      'await client.beta.threads.runs.steps.list(threadId, runId, { timeout: 5 });',
    );
    const query = openaiPack.transform(text, finding(3, 'named-path-params'), context);
    expect(query.text.split('\n')[2]).toBe(
      'await client.beta.threads.runs.steps.list(runId, { thread_id: threadId, limit: 5 });',
    );
    const options = openaiPack.transform(text, finding(4, 'named-path-params'), context);
    expect(options.applied).toBe(false);
  });

  it('keeps imports of names that left with runFunctions, and openai/core, for the agent', () => {
    const text = lines(
      "import { RunnableFunction } from 'openai/resources/beta/chat/completions';",
      "import { APIClient } from 'openai/core';",
      "import { type ChatCompletionStreamParams } from 'openai/resources/beta/chat/completions';",
    );
    expect(detectIn(openaiPack, 'consumer.ts', text).map((s) => s.line)).toEqual([1, 2, 3]);
    for (const line of [1, 2])
      expect(openaiPack.transform(text, finding(line, 'removed-modules'), context).applied).toBe(
        false,
      );
    expect(
      openaiPack.transform(text, finding(3, 'removed-modules'), context).text.split('\n')[2],
    ).toBe("import { type ChatCompletionStreamParams } from 'openai/resources/chat/completions';");
  });

  it('keeps a shims import that binds a name', () => {
    const text = lines("import { fetch } from 'openai/shims/node';", 'export { fetch };');
    expect(openaiPack.transform(text, finding(1, 'removed-modules'), context).applied).toBe(false);
  });
});

describe('openai: what the compiler reports', () => {
  const del = "Property 'del' does not exist on type 'Files'.";
  it('renames a `del` the compiler places on an SDK resource, through any receiver', () => {
    const text = lines('const files = client.files;', 'await files.del(id);');
    const site = finding(2, undefined, { path: 'TS2339', message: del });
    expect(ruleFor(openaiPack.rules, site)?.id).toBe('delete-method');
    expect(openaiPack.transform(text, site, context).text.split('\n')[1]).toBe(
      'await files.delete(id);',
    );
  });

  it('leaves two ids on an unnamed resource: they may have become named params', () => {
    const text = 'await files.del(storeId, fileId);';
    const site = finding(1, undefined, { path: 'TS2339', message: del });
    expect(openaiPack.transform(text, site, context).applied).toBe(false);
  });

  it("claims no other library's `del` or a `chat` that is not Beta's", () => {
    for (const message of [
      "Property 'del' does not exist on type 'Redis'.",
      "Property 'chat' does not exist on type 'Client'.",
    ])
      expect(
        ruleFor(openaiPack.rules, finding(1, undefined, { path: 'TS2339', message }))?.id,
      ).toBeUndefined();
  });

  it('files the tool-call union under its rule, from the type diff and the compiler', () => {
    expect(
      ruleFor(
        openaiPack.rules,
        finding(1, undefined, {
          path: 'OpenAI.ChatCompletionMessageToolCall#function',
          kind: 'removed',
          message: "'raw.function' is of type 'unknown'.",
        }),
      )?.id,
    ).toBe('tool-call-union');
    expect(
      ruleFor(
        openaiPack.rules,
        finding(1, undefined, {
          path: 'TS2339',
          message:
            "Property 'function' does not exist on type 'ChatCompletionMessageCustomToolCall'.",
        }),
      )?.id,
    ).toBe('tool-call-union');
  });

  it('files a path id passed positionally under named-path-params', () => {
    const site = finding(1, undefined, {
      path: 'TS2345',
      message:
        "Argument of type 'string' is not assignable to parameter of type 'RunRetrieveParams'.",
    });
    expect(ruleFor(openaiPack.rules, site)?.id).toBe('named-path-params');
  });
});

describe('openai: detection is scoped to files that use the SDK', () => {
  it('finds nothing in a file without an openai import', () => {
    const text = lines(
      'try { await api.files.del(id); } catch (e: any) { e.headers["retry-after"]; }',
      "client.beta.threads.runs.retrieve('t', 'r');",
    );
    expect(detectIn(openaiPack, 'consumer.ts', text)).toEqual([]);
  });

  it('reads require() as well as import', () => {
    const text = lines(
      "const { OpenAI } = require('openai');",
      'const openai = new OpenAI();',
      'openai.files.del(id);',
    );
    expect(detectIn(openaiPack, 'consumer.js', text)).toEqual([{ rule: 'delete-method', line: 3 }]);
  });
});

describe('openai: decisions carry evidence from the repository', () => {
  const decisions = (inventory: { file: string; text: string }[]) =>
    openaiPack.behavior
      .filter((b) => b.reported.includes('decision') && b.applies)
      .flatMap((b) => {
        const applies = b.applies?.({ ...context, inventory });
        return typeof applies === 'string' ? [[b.id, applies] as const] : [];
      });

  it('names the Node and zod declarations below what openai 7 needs', () => {
    const found = Object.fromEntries(
      decisions([
        {
          file: 'package.json',
          text: JSON.stringify({
            engines: { node: '>=18' },
            dependencies: { openai: '^4.83.0', zod: '^3.24.1' },
            devDependencies: { typescript: '^5.7.3', '@types/node': '^20.11.17' },
          }),
        },
        {
          file: 'src/batch.ts',
          text: "import { zodResponseFormat } from 'openai/helpers/zod';",
        },
      ]),
    );
    expect(found['platform-minimums']).toMatch(/engines\.node ">=18" permits Node below 22\.0\.0/);
    expect(found['zod-helpers']).toMatch(/declares zod "\^3\.24\.1"/);
    expect(found['zod-helpers']).toMatch(/`src\/batch\.ts` use openai\/helpers\/zod/);
  });

  it('says nothing when the repository already meets the floor and has no helper, agent or subclass', () => {
    expect(
      decisions([
        {
          file: 'package.json',
          text: JSON.stringify({
            engines: { node: '>=22' },
            dependencies: { openai: '^4.104.0', zod: '^3.25.76' },
            devDependencies: { typescript: '^5.9.3', '@types/node': '^22.0.0' },
          }),
        },
        {
          file: 'src/ai.ts',
          text: "import OpenAI from 'openai';\nexport const ai = new OpenAI();",
        },
      ]).map(([id]) => id),
    ).toEqual([]);
  });

  it('finds a subclass of the client, a proxy agent and a lib without DOM', () => {
    const found = Object.fromEntries(
      decisions([
        {
          file: 'package.json',
          text: JSON.stringify({
            engines: { node: '22' },
            dependencies: { 'https-proxy-agent': '^7.0.0' },
            devDependencies: { typescript: '^5.9.3' },
          }),
        },
        {
          file: 'tsconfig.json',
          text: '{ // comments are allowed\n "compilerOptions": { "lib": ["ES2020"] } }',
        },
        {
          file: 'src/client.ts',
          text: "import { OpenAI as Base } from 'openai';\nexport class Guarded extends Base {}",
        },
      ]),
    );
    expect(found['client-subclass']).toMatch(/`src\/client\.ts` extends Base/);
    expect(found['builtin-fetch']).toMatch(/depends on https-proxy-agent/);
    expect(found['global-types']).toMatch(/without DOM and @types\/node is not declared/);
  });
});
