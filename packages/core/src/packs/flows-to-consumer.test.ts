import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { flowsToConsumer } from './flows-to-consumer.js';
import type { BehaviorRecord } from './records.js';
import { recordFindings, recordSites } from './records.js';
import { zodRecords } from './zod/index.js';

const FIXTURE = join(import.meta.dirname, 'zod/fixtures/mcp-input-schema');
const record = zodRecords[0] as BehaviorRecord;
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** The fixture with `zod` at the given major and the MCP SDK at `sdk`, in a fresh directory. */
function workspace(zod: 3 | 4, sdk: string | null = '1.30.1'): string {
  const dir = mkdtempSync(join(tmpdir(), 'uptide-records-'));
  dirs.push(dir);
  cpSync(join(FIXTURE, 'src'), join(dir, 'src'), { recursive: true });
  cpSync(join(FIXTURE, 'tsconfig.json'), join(dir, 'tsconfig.json'));
  cpSync(join(FIXTURE, 'package.json'), join(dir, 'package.json'));
  cpSync(join(FIXTURE, `zod${zod}/zod`), join(dir, 'node_modules/zod'), { recursive: true });
  if (sdk) {
    const target = join(dir, 'node_modules/@modelcontextprotocol/sdk');
    cpSync(join(FIXTURE, 'sdk'), target, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
    writeFileSync(join(target, 'package.json'), JSON.stringify({ ...manifest, version: sdk }));
  }
  return dir;
}

/** The lines of `src/tools.ts` that end in `// site`. */
const marked = readFileSync(join(FIXTURE, 'src/tools.ts'), 'utf8')
  .split('\n')
  .flatMap((line, i) => (/\/\/ site$/.test(line) ? [i + 1] : []));

describe('flows-to-consumer: a zod object passed to the MCP SDK as an input schema', () => {
  it('finds exactly the marked sites on zod 3: raw shapes and plain objects, not strict, passthrough, catchall, any or another type', () => {
    const sites = flowsToConsumer(record.trigger, {
      root: workspace(3),
      workspace: '.',
      phase: 'before',
    });
    expect(marked).toHaveLength(5);
    expect(sites.map((s) => `${s.file}:${s.line}`)).toEqual(marked.map((l) => `src/tools.ts:${l}`));
    expect(sites[1]?.snippet).toBe('inputSchema: plainSchema, // site');
  });

  it('on zod 4, after the edit: the same sites are still open, and a strict object closes one', () => {
    const dir = workspace(4);
    expect(
      flowsToConsumer(record.trigger, { root: dir, workspace: '.', phase: 'after' }).map(
        (s) => s.line,
      ),
    ).toEqual(marked);
    const tools = join(dir, 'src/tools.ts');
    writeFileSync(
      tools,
      readFileSync(tools, 'utf8').replace(
        "{ title: 'List', inputSchema: listShape }",
        "{ title: 'List', inputSchema: strictInput(listShape) }",
      ),
    );
    expect(
      flowsToConsumer(record.trigger, { root: dir, workspace: '.', phase: 'after' }).map(
        (s) => s.line,
      ),
    ).toEqual(marked.slice(1));
  });

  it('is no site when the SDK is not installed, or installed outside the range that reads zod 4', () => {
    for (const sdk of [null, '1.22.0', '2.0.0'])
      expect(
        flowsToConsumer(record.trigger, {
          root: workspace(3, sdk),
          workspace: '.',
          phase: 'before',
        }),
      ).toEqual([]);
  });

  it('is no site in a workspace that imports zod/v3, which keeps zod 3 after the upgrade', () => {
    const dir = workspace(3);
    writeFileSync(join(dir, 'src/legacy.ts'), "import { z } from 'zod/v3';\nexport const a = z;\n");
    expect(flowsToConsumer(record.trigger, { root: dir, workspace: '.', phase: 'before' })).toEqual(
      [],
    );
  });

  it('reports the sites as their own rule, never breaking, with the cited sources', () => {
    const findings = recordFindings([record], {
      root: workspace(3),
      workspace: '.',
      package: 'zod',
      from: '3.25.76',
      to: '4.6.5',
    });
    expect(findings).toHaveLength(5);
    expect(new Set(findings.map((f) => `${f.rule} ${f.severity} ${f.fixability}`))).toEqual(
      new Set([`${record.id} unverified manual`]),
    );
    expect(findings[0]?.details?.length).toBe(record.sources.length);
    // Outside the record's range: zod 4 to 4 has no site.
    expect(
      recordFindings([record], {
        root: workspace(3),
        workspace: '.',
        package: 'zod',
        from: '4.0.0',
        to: '4.6.5',
      }),
    ).toEqual([]);
  });

  it('gives repository-relative sites for a workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'uptide-records-root-'));
    dirs.push(root);
    cpSync(workspace(3), join(root, 'apps/mcp'), { recursive: true });
    expect(recordSites([record], { root, workspace: 'apps/mcp', phase: 'before' })[0]?.file).toBe(
      'apps/mcp/src/tools.ts',
    );
  });
});
