import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import type { CheckReport, Finding } from '../domain/report.js';
import { activePack } from '../packs/index.js';
import { git } from './process.js';
import { fix } from './run.js';
import { diagnostics, testWorkspaces } from './verify.js';

const scratch = mkdtempSync(join(tmpdir(), 'uptide-companion-pack-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// React 19 types: `useRef` takes an initial value, `undefined` included.
const useRef = (optional: boolean) =>
  `export declare function useRef<T>(initial${optional ? '?: T' : ': T | undefined'}): { current: T | undefined };\n`;

/** next 15 leads; react 18 → 19 moves with it as a peer blocker's major its pack covers (UPT-10). */
function nextWithReact() {
  const root = mkdtempSync(join(scratch, 'repo-'));
  const installed = { next: '15.5.0', react: '18.3.1' };
  for (const [name, version] of Object.entries(installed)) {
    mkdirSync(join(root, 'node_modules', name), { recursive: true });
    writeFileSync(
      join(root, 'node_modules', name, 'package.json'),
      JSON.stringify({ name, version, types: 'index.d.ts' }),
    );
    writeFileSync(join(root, 'node_modules', name, 'index.d.ts'), 'export {};\n');
  }
  writeFileSync(join(root, 'node_modules/react/index.d.ts'), useRef(true));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'consumer', type: 'module', dependencies: installed }),
  );
  writeFileSync(
    join(root, 'pnpm-lock.yaml'),
    `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n${Object.entries(installed)
      .map(([n, v]) => `      ${n}:\n        specifier: ${v}\n        version: ${v}\n`)
      .join('')}`,
  );
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        skipLibCheck: true,
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
      },
      include: ['timer.ts'],
    }),
  );
  writeFileSync(
    join(root, 'timer.ts'),
    "import { useRef } from 'react';\nexport const timer = () => useRef<number>();\n",
  );
  writeFileSync(join(root, '.gitignore'), 'node_modules\n');
  git(root, 'init');
  git(root, 'config', 'user.email', 'test@example.test');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'baseline');
  return root;
}

it("runs a companion pack's rule in the lead's fix, under the companion's versions (UPT-10)", async () => {
  const root = nextWithReact();
  // What check reports for the group next leads: react's site at react's own versions.
  const site: Finding = {
    change: {
      package: 'react',
      from: '18.3.1',
      to: '19.3.0',
      path: 'TS2554',
      kind: 'signature',
      severity: 'breaking',
      confidence: 1,
      source: 'types',
    },
    usage: {
      file: 'timer.ts',
      line: 2,
      column: 28,
      endLine: 2,
      endColumn: 34,
      symbolPath: 'useRef',
      access: 'call',
      snippet: 'useRef<number>()',
      via: 'direct',
      compileCode: 2554,
      compileError: 'Expected 1 arguments, but got 0.',
    },
    severity: 'breaking',
    confidence: 1,
    fixability: 'mechanical',
    reason: 'useRef requires an argument',
  };
  const report: CheckReport = {
    repo: root,
    workspaces: ['.'],
    summary: {
      packagesNeedingAttention: 1,
      breaking: 1,
      deprecated: 0,
      unverified: 0,
      unaffected: 0,
      notImported: 0,
      partiallyAnalyzed: 0,
      autoFixable: 1,
      skippedForTime: 0,
      failed: 0,
    },
    packages: [
      {
        name: 'next',
        workspace: '.',
        installed: '15.5.0',
        latest: '16.4.0',
        target: '16.4.0',
        majorsBehind: 1,
        findings: [site],
        callSitesChecked: 1,
        status: 'breaking',
        unanalyzed: [],
        notes: [],
        timing: { fetchMs: 0, diffMs: 0, usagesMs: 0, compileMs: 0 },
      },
    ],
  };
  let checked: { only?: string[]; packs?: readonly { name: string }[] } = {};
  const result = await fix(
    {
      cwd: root,
      only: 'next',
      target: '16.4.0',
      fixer: null,
      peerPlan: {
        target: '16.4.0',
        targetSource: 'requested',
        companions: [
          {
            name: 'react',
            from: '18.3.1',
            to: '19.3.0',
            reason: 'explicit peer upgrade accepting next 16.4.0',
            migration: 'pack',
          },
        ],
        conflicts: [],
      },
    },
    {
      check: async (options) => {
        checked = options;
        return report;
      },
      diagnostics,
      tests: testWorkspaces,
      build: async (_dir, workspaces) =>
        workspaces.map((workspace) => ({ workspace, status: 'passed' as const, output: '' })),
      resolve: async () => '16.4.0',
      install: async (dir, upgrade) => {
        for (const move of [{ name: 'next', version: '16.4.0' }, ...(upgrade?.also ?? [])]) {
          const file = join(dir, 'node_modules', move.name, 'package.json');
          writeFileSync(
            file,
            JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), version: move.version }),
          );
        }
        writeFileSync(join(dir, 'node_modules/react/index.d.ts'), useRef(false));
        writeFileSync(
          join(dir, 'pnpm-lock.yaml'),
          readFileSync(join(dir, 'pnpm-lock.yaml'), 'utf8')
            .replaceAll('15.5.0', '16.4.0')
            .replaceAll('18.3.1', '19.3.0'),
        );
      },
    },
  );
  // Check analyzed react beside next, with next's pack speaking for both.
  expect(checked.only).toEqual(['next', 'react']);
  expect(checked.packs?.find((p) => p.name === 'next')).not.toBe(activePack('next'));
  // react's rule rewrote the site in the same fix, and the site keeps react's versions.
  expect(readFileSync(join(root, 'timer.ts'), 'utf8')).toContain('useRef<number>(undefined)');
  expect(result.package).toBe('next');
  expect(result.companions).toMatchObject([
    { name: 'react', from: '18.3.1', to: '19.3.0', migration: 'pack' },
  ]);
  expect(result.sites).toMatchObject([
    {
      outcome: 'mechanical',
      rule: 'use-ref-argument',
      finding: { change: { package: 'react', from: '18.3.1', to: '19.3.0' } },
    },
  ]);
  expect(result.verification.passed).toBe(true);
});
