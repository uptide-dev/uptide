import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { messages } from '../llm/prompt.js';
import { reactPack } from '../packs/react/index.js';
import { assist } from './assisted.js';
import { applySitePatch } from './patch.js';
import { git } from './process.js';
import type { FixRequest, FixSite } from './types.js';
import { diagnostics } from './verify.js';

const scratch = mkdtempSync(join(tmpdir(), 'uptide-related-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
function fixture(extra = '') {
  const root = mkdtempSync(join(scratch, 'repo-'));
  for (const file of ['props', 'call-site'])
    copyFileSync(
      new URL(`./__fixtures__/related-declaration/${file}.ts.txt`, import.meta.url),
      join(root, `${file}.ts`),
    );
  if (extra)
    writeFileSync(
      join(root, 'call-site.ts'),
      readFileSync(join(root, 'call-site.ts'), 'utf8') + extra,
    );
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, skipLibCheck: true },
      include: ['*.ts'],
    }),
  );
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true }));
  git(root, 'init');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'user.email', 'test@example.test');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'fixture');
  const verify = () => diagnostics(root, ['.']);
  const sites: FixSite[] = verify().map((d) => ({
    outcome: 'manual',
    reason: 'nullable ref',
    finding: {
      change: {
        package: 'react',
        from: '18.2.0',
        to: '19.3.0',
        path: 'RefObject',
        kind: 'type',
        severity: 'breaking',
        source: 'types',
        confidence: 1,
      },
      usage: {
        file: d.file,
        line: d.line,
        column: d.column,
        endLine: d.line,
        endColumn: d.column + 1,
        symbolPath: 'RefObject',
        access: 'typeRef',
        via: 'direct',
        snippet: '',
        compileCode: d.code,
        compileError: d.message,
      },
      severity: 'breaking',
      confidence: 1,
      fixability: 'assisted',
      reason: 'nullable ref',
    },
  }));
  return { root, verify, sites };
}
const patch =
  '--- a/props.ts\n+++ b/props.ts\n@@ -3 +3 @@\n-  inputRef: Ref<string>;\n+  inputRef: Ref<string | null>;\n';
const fixer = (diff: string, requests: FixRequest[]) => ({
  id: 'mock',
  estimate: () => 0,
  fix: async (r: FixRequest) => {
    requests.push(r);
    return { diff, inputTokens: 1, outputTokens: 1, costUsd: 0 };
  },
});

it('collects real TS related information, edits the receiving declaration once, and resolves both sites', async () => {
  const f = fixture(),
    requests: FixRequest[] = [];
  expect(f.sites).toHaveLength(2);
  expect(f.verify()[0]?.relatedDeclarations).toEqual([
    { file: 'props.ts', line: 3, endLine: 3, message: expect.stringContaining('inputRef') },
  ]);
  await assist(f.root, f.sites, reactPack, fixer(patch, requests), f.verify);
  expect(requests).toHaveLength(1);
  expect(requests[0]?.relatedDeclarations?.[0]?.source).toContain('inputRef: Ref<string>');
  expect(requests[0]?.sharedDiagnostics).toHaveLength(2);
  expect(messages(requests[0] as FixRequest)[0]?.content).not.toContain('untouched');
  expect(f.verify()).toEqual([]);
  expect(f.sites.map((s) => s.outcome)).toEqual(['agent', 'agent']);
  expect(f.sites[0]?.editedFiles).toEqual(['props.ts']);
  expect(f.sites[1]?.resolvedBy).toBeDefined();
  expect(git(f.root, 'status', '--porcelain')).toBe('');
});

it('rejects a declaration edit that introduces an error elsewhere and rolls it back, once per group', async () => {
  const f = fixture('export const length = (props: Props) => props.inputRef.current.length;\n'),
    requests: FixRequest[] = [];
  await assist(f.root, f.sites, reactPack, fixer(patch, requests), f.verify);
  expect(requests).toHaveLength(3);
  expect(f.sites.every((s) => s.outcome === 'manual')).toBe(true);
  expect(f.sites[0]?.attempts?.[0]?.explanation).toContain('newErrors');
  expect(f.sites[0]?.attempts?.[0]?.after.some((d) => d.code === 18047)).toBe(true);
  expect(f.verify()).toHaveLength(2);
  expect(git(f.root, 'status', '--porcelain')).toBe('');
});

it('rejects an unchanged target and refuses edits outside the related declaration, even with false line numbers', async () => {
  for (const diff of [
    patch.replace('Ref<string | null>', 'Ref<string>'),
    `${patch}@@ -3 +3 @@\n-export const untouched = 1;\n+export const untouched = 2;\n`,
  ]) {
    const f = fixture(),
      requests: FixRequest[] = [];
    await assist(f.root, f.sites, reactPack, fixer(diff, requests), f.verify);
    expect(requests).toHaveLength(3);
    expect(f.sites.every((s) => s.outcome === 'manual')).toBe(true);
    expect(git(f.root, 'status', '--porcelain')).toBe('');
  }
});

it('accepts a multi-file patch only within the supplied scope', () => {
  const files = new Map([
    ['props.ts', { source: '  inputRef: Ref<string>;\n', regions: [{ line: 1, endLine: 1 }] }],
    ['site.ts', { source: 'export const value = 1;\n' }],
  ]);
  const diff =
    patch +
    'diff --git a/site.ts b/site.ts\nindex abc..def 100644\n--- a/site.ts\n+++ b/site.ts\n@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n';
  expect([...applySitePatch(files, diff).keys()]).toEqual(['props.ts', 'site.ts']);
  expect(() => applySitePatch(files, diff.replaceAll('site.ts', '../outside.ts'))).toThrow(
    'not editable',
  );
});

it.each(['node_modules', 'outside', 'symlink'])(
  'never grants edit access to a %s declaration',
  (kind) => {
    const f = fixture();
    const target =
      kind === 'node_modules'
        ? join(f.root, 'node_modules', 'props')
        : mkdtempSync(join(scratch, 'outside-'));
    mkdirSync(target, { recursive: true });
    copyFileSync(join(f.root, 'props.ts'), join(target, 'index.ts'));
    if (kind === 'symlink') symlinkSync(target, join(f.root, 'linked'));
    const from =
      kind === 'node_modules' ? './node_modules/props' : kind === 'symlink' ? './linked' : target;
    writeFileSync(
      join(f.root, 'call-site.ts'),
      readFileSync(join(f.root, 'call-site.ts'), 'utf8').replace('./props', from),
    );
    expect(f.verify().filter((d) => d.code === 2322)).toHaveLength(2);
    expect(f.verify().every((d) => !d.relatedDeclarations?.length)).toBe(true);
  },
);

it('rolls back both the reported file and declaration when a multi-file edit introduces an error', async () => {
  const f = fixture(),
    requests: FixRequest[] = [];
  const diff = `${patch}--- a/call-site.ts\n+++ b/call-site.ts\n@@ -4 +4 @@\n-export const second: Props = { inputRef: ref };\n+export const second: Props = { inputRef: ref }; const broken: number = "bad";\n`;
  await assist(f.root, f.sites, reactPack, fixer(diff, requests), f.verify);
  expect(requests).toHaveLength(3);
  expect(f.sites[0]?.attempts?.[0]?.after.some((d) => d.message.includes("Type 'string'"))).toBe(
    true,
  );
  expect(git(f.root, 'status', '--porcelain')).toBe('');
});

it('groups call sites in different files that share the same receiving declaration', async () => {
  const f = fixture(),
    requests: FixRequest[] = [];
  const original = readFileSync(join(f.root, 'call-site.ts'), 'utf8');
  copyFileSync(join(f.root, 'call-site.ts'), join(f.root, 'other.ts'));
  writeFileSync(
    join(f.root, 'call-site.ts'),
    original.replace('export const second: Props = { inputRef: ref };', ''),
  );
  writeFileSync(
    join(f.root, 'other.ts'),
    original.replace('export const first: Props = { inputRef: ref };', ''),
  );
  const second = f.sites[1];
  if (!second) throw new Error('missing fixture site');
  second.finding.usage.file = 'other.ts';
  await assist(f.root, f.sites, reactPack, fixer(patch, requests), f.verify);
  expect(requests).toHaveLength(1);
  expect(f.verify()).toEqual([]);
  expect(second.resolvedBy).toBeDefined();
});
