import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { CheckReport, Finding } from '../domain/report.js';
import { definePack } from '../packs/contract.js';
import type { Upgrade } from './managers/upgrade.js';
import { git } from './process.js';
import type { FixServices } from './run.js';
import { fix } from './run.js';
import { diagnostics, testWorkspaces } from './verify.js';
import { declareLead } from './versions.js';

const scratch = mkdtempSync(join(tmpdir(), 'uptide-alternate-lead-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const source = 'https://example.com/router-dom/changelog';
const CLEAN_TOOL = { uptideVersion: '0.0.0', uptideCommit: 'a'.repeat(40), uptideDirty: false };

/** `router` 2.0.0 makes `navigate` take options; `router-dom` re-exports it, by name. */
const pack = definePack({
  meta: { package: 'router', from: '^1', to: '^2', sources: [], maintainer: 'test' },
  defaultTarget: '2.0.0',
  releaseGroup: [{ name: 'router-dom', source }],
  alternateLeads: [{ name: 'router-dom', source }],
  rules: [
    {
      id: 'navigate-options',
      summary: 'navigate takes options',
      severity: 'breaking',
      kinds: ['signature'],
      symbols: /navigate$/,
      guide: 'pass { replace: false }',
      rewrite: (text) => ({
        text: text.replace("navigate('/')", "navigate('/', { replace: false })"),
        applied: true,
        reason: 'options are required',
      }),
    },
  ],
  instructions: '',
});

function writeRouter(root: string, version: string): void {
  for (const name of ['router', 'router-dom']) {
    const dir = join(root, 'node_modules', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name,
        version,
        types: 'index.d.ts',
        ...(name === 'router-dom' ? { dependencies: { router: version } } : {}),
      }),
    );
    writeFileSync(
      join(dir, 'index.d.ts'),
      name === 'router-dom'
        ? "export { navigate } from 'router';\n"
        : version === '1.0.0'
          ? 'export declare function navigate(to: string): void;\n'
          : 'export declare function navigate(to: string, options: { replace: boolean }): void;\n',
    );
  }
}

/** A committed repository that declares only `router-dom`, between two other dependencies. */
function alternateFixture() {
  const root = mkdtempSync(join(scratch, 'repo-'));
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify(
      {
        name: 'consumer',
        type: 'module',
        dependencies: { alpha: '1.0.0', 'router-dom': '^1.0.0', zeta: '1.0.0' },
      },
      null,
      2,
    )}\n`,
  );
  writeRouter(root, '1.0.0');
  for (const name of ['alpha', 'zeta']) {
    mkdirSync(join(root, 'node_modules', name), { recursive: true });
    writeFileSync(
      join(root, 'node_modules', name, 'package.json'),
      JSON.stringify({ name, version: '1.0.0' }),
    );
  }
  writeFileSync(
    join(root, 'pnpm-lock.yaml'),
    "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      router-dom:\n        specifier: ^1.0.0\n        version: 1.0.0\n",
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
      include: ['index.ts'],
    }),
  );
  writeFileSync(join(root, 'index.ts'), "import { navigate } from 'router-dom';\nnavigate('/');\n");
  writeFileSync(join(root, '.gitignore'), 'node_modules\n');
  git(root, 'init');
  git(root, 'config', 'user.email', 'test@example.test');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'baseline');
  const finding: Finding = {
    change: {
      package: 'router',
      from: '1.0.0',
      to: '2.0.0',
      path: 'navigate',
      kind: 'signature',
      severity: 'breaking',
      confidence: 1,
      source: 'types',
    },
    usage: {
      file: 'index.ts',
      line: 2,
      column: 1,
      endLine: 2,
      endColumn: 9,
      symbolPath: 'navigate',
      access: 'call',
      snippet: "navigate('/');",
      via: 'reexport',
      compileCode: 2554,
    },
    severity: 'breaking',
    confidence: 1,
    fixability: 'mechanical',
    reason: 'navigate takes options',
  };
  // What `check router-dom` reports there: the lead, through the alternate, moving it along.
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
        name: 'router',
        workspace: '.',
        installed: '1.0.0',
        latest: '2.0.0',
        target: '2.0.0',
        majorsBehind: 1,
        findings: [finding],
        callSitesChecked: 1,
        status: 'breaking',
        unanalyzed: [],
        notes: [],
        undeclared: { via: 'router-dom' },
        companions: [
          { name: 'router-dom', from: '1.0.0', to: '2.0.0', reason: 'declared release group' },
        ],
        timing: { fetchMs: 0, diffMs: 0, usagesMs: 0, compileMs: 0 },
      },
    ],
  };
  const installs: Upgrade[] = [];
  const checked: string[][] = [];
  const services: FixServices = {
    check: async (options) => {
      checked.push(options.only ?? []);
      return report;
    },
    diagnostics,
    tests: testWorkspaces,
    resolve: async () => '2.0.0',
    // The registry for the peer plan: router-dom is released at each router version.
    manifests: async (name) =>
      Object.fromEntries(
        ['1.0.0', '2.0.0'].map((v) => [
          v,
          name === 'router-dom' ? { dependencies: { router: v } } : {},
        ]),
      ),
    install: async (dir, upgrade) => {
      if (upgrade) installs.push(upgrade);
      writeRouter(dir, upgrade?.version ?? '2.0.0');
      writeFileSync(
        join(dir, 'pnpm-lock.yaml'),
        readFileSync(join(dir, 'pnpm-lock.yaml'), 'utf8').replaceAll('1.0.0', '2.0.0'),
      );
    },
  };
  return { root, services, installs, checked };
}

describe('fix asked for an alternate lead', () => {
  it('fixes the pack lead, declaring it beside the alternate, both at the target', async () => {
    const { root, services, installs, checked } = alternateFixture();
    const result = await fix(
      { cwd: root, only: 'router-dom', pack, fixer: null, tool: CLEAN_TOOL },
      services,
    );
    expect(checked).toEqual([['router']]);
    expect(git(root, 'branch', '--show-current')).toBe('uptide/router-2.0.0');
    // Declared in the section that declares the alternate, keeping its range style and order.
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toContain(
      '"dependencies": {\n    "alpha": "1.0.0",\n    "router": "^2.0.0",\n    "router-dom": "^2.0.0",\n    "zeta": "1.0.0"\n  }',
    );
    expect(installs).toHaveLength(1);
    expect(installs[0]).toMatchObject({
      name: 'router',
      version: '2.0.0',
      workspaces: ['.'],
      files: ['package.json'],
      also: [{ name: 'router-dom', version: '2.0.0' }],
    });
    expect(git(root, 'log', '--format=%s', '-1', 'HEAD~1')).toBe(
      'chore: upgrade router to 2.0.0 with router-dom 2.0.0',
    );
    expect(result.sites[0]).toMatchObject({ outcome: 'mechanical', rule: 'navigate-options' });
    expect(result.verification.passed).toBe(true);
  }, 20000);
});

describe('declareLead', () => {
  const manifest = (dependencies: Record<string, string>, extra: object = {}) => {
    const root = mkdtempSync(join(scratch, 'declare-'));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'x', dependencies, ...extra }),
    );
    return root;
  };
  const read = (root: string) => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

  it.each([
    ['6.30.1', '7.18.4'],
    ['^6.30.1', '^7.18.4'],
    ['~6.30.0', '~7.18.4'],
    ['^6', '^7'],
  ])('declares the lead with the alternate range style: %s gives %s', (spec, expected) => {
    const root = manifest({ 'react-router-dom': spec });
    expect(declareLead(root, 'react-router', ['react-router-dom'], '7.18.4')).toHaveLength(1);
    expect(read(root).dependencies['react-router']).toBe(expected);
  });

  it('writes nothing when a workspace declares the lead, or none declares an alternate', () => {
    const declared = manifest({ 'react-router': '^6.30.1', 'react-router-dom': '^6.30.1' });
    expect(declareLead(declared, 'react-router', ['react-router-dom'], '7.18.4')).toEqual([]);
    const other = manifest({ zod: '^3.0.0' });
    expect(declareLead(other, 'react-router', ['react-router-dom'], '7.18.4')).toEqual([]);
    expect(read(other).dependencies).toEqual({ zod: '^3.0.0' });
  });

  it('keeps a section that is not sorted as it is, appending the lead', () => {
    const root = manifest({ zod: '1.0.0', 'react-router-dom': '6.30.1' });
    declareLead(root, 'react-router', ['react-router-dom'], '7.18.4');
    expect(Object.keys(read(root).dependencies)).toEqual([
      'zod',
      'react-router-dom',
      'react-router',
    ]);
  });

  it('refuses a catalog or alias it cannot mirror, without writing', () => {
    const root = manifest({ 'react-router-dom': 'catalog:' });
    expect(() => declareLead(root, 'react-router', ['react-router-dom'], '7.18.4')).toThrow(
      /declare react-router 7\.18\.4 beside it by hand/,
    );
    expect(read(root).dependencies).toEqual({ 'react-router-dom': 'catalog:' });
  });
});
