import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ChangeKind } from '../../domain/change.js';
import type { Finding } from '../../domain/report.js';
import { ruleFor } from '../contract.js';
import { runFixtures } from '../tooling/fixtures.js';
import type { PackContext } from '../types.js';
import { lucideReactPack } from './index.js';
import { BRAND_ICONS, forms, RENAMES } from './names.js';

it('lucide-react: every fixture rewrites and detects exactly its marked sites', () => {
  const result = runFixtures(lucideReactPack, fileURLToPath(new URL('.', import.meta.url)));
  expect(result.cases.length).toBeGreaterThan(0);
  expect(result.unknown).toEqual([]);
  expect(result.rewriteFailures).toEqual([]);
  expect(result.falsePositives).toEqual([]);
  expect(result.falseNegatives).toEqual([]);
});

/** A finding as `check` reported it on a synthetic 0.x consumer checked against 1.56.0. */
function finding(kind: ChangeKind, path: string, compileError?: string): Finding {
  return {
    change: {
      package: 'lucide-react',
      from: '0.577.0',
      to: '1.56.0',
      path,
      kind,
      severity: 'breaking',
      source: 'types',
      confidence: 1,
    },
    usage: {
      file: 'src/icons.tsx',
      line: 1,
      column: 10,
      endLine: 1,
      endColumn: 10,
      symbolPath: path,
      access: 'read',
      snippet: '',
      via: 'inferred',
      ...(compileError ? { compileError } : {}),
    },
    severity: 'breaking',
    confidence: 1,
    fixability: 'manual',
    reason: '',
  };
}

const claimed = (f: Finding) => ruleFor(lucideReactPack.rules, f)?.id;

describe('which rule claims what check reports', () => {
  it('claims a removed brand icon on an import line, whatever path the finding carries', () => {
    const message = `Module '"lucide-react"' has no exported member 'Github'.`;
    expect(claimed(finding('type', 'LucideIcon', message))).toBe('brand-icons-removed');
    expect(claimed(finding('type', 'TS2305', message))).toBe('brand-icons-removed');
  });

  it('claims brand icons reached through the icons map, dynamic imports and DynamicIcon', () => {
    expect(
      claimed(
        finding(
          'removed',
          'icons.Twitter',
          `Property 'Twitter' does not exist on type 'typeof index'.`,
        ),
      ),
    ).toBe('brand-icons-removed');
    expect(
      claimed(
        finding(
          'removed',
          'default#github',
          `Property 'github' does not exist on type '{ 'a-arrow-down': ... }'.`,
        ),
      ),
    ).toBe('brand-icons-removed');
    expect(
      claimed(
        finding('type', 'TS2322', `Type '"github"' is not assignable to type '"target" | "type"'.`),
      ),
    ).toBe('brand-icons-removed');
  });

  it('gives a line with a brand icon and a renamed icon to the brand rule, which a person decides', () => {
    const message = [
      `Module '"lucide-react"' has no exported member 'SquareGantt'.`,
      `Module '"lucide-react"' has no exported member 'Github'.`,
    ].join('\n');
    expect(claimed(finding('type', 'TS2305', message))).toBe('brand-icons-removed');
  });

  it('claims renamed icons in every form, and nothing else', () => {
    for (const [from] of RENAMES)
      expect(
        claimed(
          finding('type', 'TS2305', `Module '"lucide-react"' has no exported member '${from}'.`),
        ),
      ).toBe('renamed-icons');
    expect(
      claimed(finding('type', 'TS2305', `Module '"lucide-react"' has no exported member 'Gantt'.`)),
    ).toBeUndefined();
    expect(
      claimed(finding('type', 'TS2305', `Module '"./charts"' has no exported member 'Foo'.`)),
    ).toBeUndefined();
  });

  it('does not claim a site whose message names an icon only as part of another word', () => {
    expect(
      claimed(finding('type', 'TS2339', `Property 'githubUrl' does not exist on type 'Profile'.`)),
    ).toBeUndefined();
  });

  it('claims the deprecated IconNode type', () => {
    expect(claimed(finding('deprecated', 'IconNode'))).toBe('icon-node-type');
  });

  it('knows every form of every brand icon', () => {
    expect(Object.keys(BRAND_ICONS)).toHaveLength(19);
    expect(forms('Github')).toEqual(['Github', 'GithubIcon', 'LucideGithub']);
  });
});

function context(from: string, inventory: { file: string; text: string }[] = []): PackContext {
  return { from, to: '1.56.0', includeDeprecated: false, inventory };
}

const note = (id: string) => {
  const found = lucideReactPack.behavior.find((b) => b.id === id);
  if (!found?.applies) throw new Error(`no applies() on ${id}`);
  return found.applies;
};

describe('decisions, from the repository', () => {
  it('raises aria-hidden only for repositories older than 0.489.0, naming the tests at risk', () => {
    const tests = [
      { file: 'src/nav.test.tsx', text: `screen.getByRole('img', { name: 'menu' })` },
      { file: 'src/util.test.ts', text: 'expect(sum(1, 2)).toBe(3)' },
    ];
    const old = note('aria-hidden-default')(context('0.400.0', tests));
    expect(old).toContain('0.400.0 predates 0.489.0');
    expect(old).toContain('`src/nav.test.tsx`');
    expect(old).not.toContain('util.test.ts');
    expect(note('aria-hidden-default')(context('0.488.0'))).toContain('accessible name');
    expect(note('aria-hidden-default')(context('0.489.0', tests))).toBe(false);
    expect(note('aria-hidden-default')(context('0.577.0', tests))).toBe(false);
  });

  it('raises deep imports only when the Next config maps lucide-react to its dist files', () => {
    const config = {
      file: 'next.config.mjs',
      text: `modularizeImports: { 'lucide-react': { transform: 'lucide-react/dist/esm/icons/{{ kebabCase member }}' } }`,
    };
    expect(note('deep-imports')(context('0.577.0', [config]))).toContain('`next.config.mjs`');
    expect(
      note('deep-imports')(
        context('0.577.0', [
          { file: 'next.config.mjs', text: `optimizePackageImports: ['lucide-react']` },
        ]),
      ),
    ).toBe(false);
  });
});
