import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type BehaviorRecord, recordDecisions, recordProblems, recordPrompt } from './records.js';
import { zodRecords } from './zod/index.js';

const record = zodRecords[0] as BehaviorRecord;
const zodDir = join(import.meta.dirname, 'zod');
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
const sites = [
  { record: record.id, file: 'src/tools/index.ts', line: 69, snippet: 'inputSchema: a,' },
  { record: record.id, file: 'src/tools/index.ts', line: 83, snippet: 'inputSchema: b,' },
];

describe('behavior records', () => {
  it('the zod record cites both sources: the zod docs line and the MCP SDK converter line', () => {
    expect(recordProblems(zodRecords, zodDir, 'zod')).toEqual([]);
    expect(record.sources.map((s) => s.url)).toEqual([
      expect.stringContaining('colinhacks/zod'),
      expect.stringContaining('@modelcontextprotocol/sdk@1.30.1'),
      expect.stringContaining('colinhacks/zod'),
    ]);
  });

  it('refuses a quote that is not verbatim in its snapshot, a changed snapshot, and a non-exact edit that does not say what else it changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'uptide-record-'));
    dirs.push(dir);
    cpSync(join(zodDir, 'sources'), join(dir, 'sources'), { recursive: true });
    const [docs, sdk] = record.sources;
    const bad: BehaviorRecord = {
      ...record,
      sources: [
        { ...(docs as BehaviorRecord['sources'][0]), quote: 'additionalProperties is always set' },
        sdk as BehaviorRecord['sources'][0],
      ],
      keepOld: { edit: '.strict()', exact: false },
    };
    writeFileSync(join(dir, sdk?.snapshot as string), 'moved');
    expect(recordProblems([bad], dir, 'zod')).toEqual([
      `records "${record.id}": keepOld is not exact, so alsoChanges says what else it changes`,
      `records "${record.id}": the quote is not verbatim in sources/zod-json-schema.mdx.txt`,
      `records "${record.id}": sources/mcp-sdk-1.30.1-zod-json-schema-compat.js.txt does not match its sha256`,
      `records "${record.id}": the quote is not verbatim in sources/mcp-sdk-1.30.1-zod-json-schema-compat.js.txt`,
    ]);
    expect(recordProblems([record], dir, 'stripe')[0]).toContain('the id starts with "stripe/"');
  });

  it('tells the agent each site, the quotes, and the edit with what else it changes', () => {
    const block = recordPrompt([record], sites).join('\n');
    expect(block).toContain('Behavior changes at these sites');
    expect(block).toContain('site: src/tools/index.ts:69 `inputSchema: a,`');
    expect(block).toContain('"io: opts?.pipeStrategy ?? \'input\'"');
    expect(block).toContain('it also makes the server reject a call with an unknown key');
    expect(block).toContain(`naming the record id`);
    expect(recordPrompt([record], [])).toEqual([]);
  });

  it('puts the decision in the PR: applied sites with the side effect, open sites with the recommendation', () => {
    const [kept] = recordDecisions(
      [record],
      sites.map((s) => ({ ...s, kept: true })),
    );
    expect(kept).toContain('Applied `.strict() on the object');
    expect(kept).toContain('`src/tools/index.ts:69`, `src/tools/index.ts:83`');
    expect(kept).toContain('it also makes the server reject a call with an unknown key');
    expect(kept).toContain('([source](https://unpkg.com/@modelcontextprotocol/sdk@1.30.1/');
    expect(kept).not.toContain('Not applied');
    // In file and line order, whatever order the sites came in.
    expect(
      recordDecisions(
        [record],
        [...sites].reverse().map((s) => ({ ...s, kept: true })),
      )[0],
    ).toBe(kept);
    const [mixed] = recordDecisions(
      [record],
      [{ ...(sites[0] as (typeof sites)[0]), kept: true }, sites[1] as (typeof sites)[0]],
    );
    expect(mixed).toContain('Not applied at `src/tools/index.ts:83`: recommended');
    expect(recordDecisions([record], [])).toEqual([]);
  });
});
