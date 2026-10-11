import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { mergeSignals } from '../../check/merge.js';
import { unattributedFindings } from '../../check/unattributed.js';
import type { CheckReport } from '../../domain/report.js';
import type { ApiSurface } from '../../domain/surface.js';
import { assist } from '../../fix/assisted.js';
import { git } from '../../fix/process.js';
import { selectedFindings } from '../../fix/select.js';
import type { FixRequest, FixSite } from '../../fix/types.js';
import { diagnostics } from '../../fix/verify.js';
import { reactPack } from '../../packs/react/index.js';
import { compileAgainstTargets } from './compile.js';

const scratch = mkdtempSync(join(tmpdir(), 'uptide-jsx-overlay-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

it.each(['automatic', 'types', 'typeRoots', 'reference'])(
  '%s type inclusion uses target React types and sends the missing JSX finding to the agent',
  async (mode) => {
    const dir = mkdtempSync(join(scratch, 'repo-'));
    const target = mkdtempSync(join(scratch, 'react19-'));
    const installed = join(dir, 'node_modules/@types/react');
    const other = join(dir, 'node_modules/@types/other');
    for (const path of [installed, other]) mkdirSync(path, { recursive: true });
    symlinkSync(
      realpathSync(resolve(import.meta.dirname, '../../../../../node_modules/typescript')),
      join(dir, 'node_modules/typescript'),
      'dir',
    );
    const next = 'export namespace JSX { interface Element { kind: "element" } }\n';
    writeFileSync(
      join(installed, 'package.json'),
      JSON.stringify({ name: '@types/react', version: '18.3.1', types: 'index.d.ts' }),
    );
    writeFileSync(
      join(installed, 'index.d.ts'),
      `${next}declare global { namespace JSX { interface Element { kind: "element" } } }\n`,
    );
    writeFileSync(
      join(other, 'package.json'),
      JSON.stringify({ name: '@types/other', version: '1.0.0', types: 'index.d.ts' }),
    );
    writeFileSync(join(other, 'index.d.ts'), 'declare const ambientOther: number;\n');
    writeFileSync(
      join(target, 'package.json'),
      JSON.stringify({ name: '@types/react', version: '19.3.0', types: 'index.d.ts' }),
    );
    writeFileSync(join(target, 'index.d.ts'), next);
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        dependencies: { react: '18.3.1', '@types/react': '18.3.1' },
      }),
    );
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          ...(mode === 'types' ? { types: ['react', 'other'] } : {}),
          ...(mode === 'typeRoots' ? { typeRoots: ['./node_modules/@types'] } : {}),
          ...(mode === 'reference' ? { types: ['other'] } : {}),
        },
        include: ['app.ts'],
      }),
    );
    const source = `${mode === 'reference' ? '/// <reference types="react" />\n' : ''}import type * as React from 'react';\nexport let icons: Record<string, JSX.Element>;\nexport let scoped: React.JSX.Element;\nexport const keep = ambientOther;\n`;
    writeFileSync(join(dir, 'app.ts'), source);
    const signal = await compileAgainstTargets({ dir }, [
      { name: '@types/react', specifier: 'react', dir: target },
    ]);
    expect(signal.baselineErrors).toBe(0);
    expect(signal.diagnostics).toHaveLength(1);
    expect(signal.diagnostics[0]).toMatchObject({
      file: 'app.ts',
      code: 2503,
      message: "Cannot find namespace 'JSX'.",
    });
    const surface: ApiSurface = {
      package: '@types/react',
      version: '19.3.0',
      symbols: [],
      extractedAt: '2026-01-01T00:00:00.000Z',
      adapter: 'typescript',
    };
    const merged = mergeSignals([], signal, surface);
    const findings = unattributedFindings(
      merged.unattributed,
      { package: 'react', from: '18.3.1', to: '19.3.0' },
      surface,
      [],
    );
    const report = {
      repo: dir,
      workspaces: ['.'],
      summary: {} as CheckReport['summary'],
      packages: [
        {
          workspace: '.',
          name: 'react',
          installed: '18.3.1',
          latest: '19.3.0',
          target: '19.3.0',
          majorsBehind: 1,
          findings,
          callSitesChecked: 1,
          unanalyzed: [],
          status: 'breaking' as const,
          notes: [],
          timing: { fetchMs: 0, diffMs: 0, usagesMs: 0, compileMs: 0 },
        },
      ],
    };
    const selected = selectedFindings(report, 'react', false);
    expect(selected).toHaveLength(1);
    const finding = selected[0];
    if (!finding) throw new Error('missing JSX finding');
    expect(reactPack.ruleOf?.(finding)).toBe('global-jsx-namespace');
    writeFileSync(join(installed, 'index.d.ts'), next);
    git(dir, 'init');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'user.email', 'test@example.test');
    git(dir, 'add', 'app.ts', 'package.json', 'tsconfig.json');
    git(dir, 'commit', '-m', 'fixture');
    const sites: FixSite[] = selected.map((finding) => ({
      finding,
      outcome: 'manual',
      reason: 'no mechanical rule',
    }));
    const requests: FixRequest[] = [];
    const line = mode === 'reference' ? 2 : 1;
    await assist(
      dir,
      sites,
      reactPack,
      {
        id: 'mock',
        estimate: () => 0,
        fix: async (request) => {
          requests.push(request);
          return {
            inputTokens: 1,
            outputTokens: 1,
            diff: `--- a/app.ts\n+++ b/app.ts\n@@ -${line} +${line} @@\n-import type * as React from 'react';\n+import type * as React from 'react'; import type { JSX } from 'react';\n`,
          };
        },
      },
      () => diagnostics(dir, ['.']),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.guide).toContain('import type { JSX }');
    expect(requests[0]?.enclosingFunction).toContain("import type * as React from 'react';");
    expect(sites[0]?.outcome).toBe('agent');
    expect(diagnostics(dir, ['.'])).toEqual([]);
    expect(readFileSync(join(dir, 'app.ts'), 'utf8')).toContain('import type { JSX }');
  },
  15000,
);
