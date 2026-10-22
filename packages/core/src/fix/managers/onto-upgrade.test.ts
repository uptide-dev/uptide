import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertLockScope, describeOutOfScope, type LockGraph } from './lock-guard.js';
import { npmGraph } from './npm-lock.js';
import { pnpmGraph, yarnGraph } from './text-lock.js';

// express 4.21.2 → 5.3.0 (UPT-135): express 4 stays for @bull-board/express, and the manager
// moves an unchanged http-client's qs 6.12.0 onto the 6.16.1 express 5 brings (pnpm also an
// editor-launcher's iconv-lite 0.7.1 onto 0.7.3). Their dependents (http-test; pnpm also
// prompt-editor, schema-cli) keep their versions. npm drops http-client's nested qs; Yarn moves
// the `qs@npm:^6.10.0` descriptor in place. In the control, http-client's qs moves to 6.15.0, a
// release the upgrade did not bring.
const dir = resolve(import.meta.dirname, '../../../../../fixtures/lockfiles/onto-upgrade');
const managers: [string, string, (text: string) => LockGraph][] = [
  ['pnpm', 'pnpm-lock.yaml', (t) => pnpmGraph(t, 'express')],
  ['npm', 'package-lock.json', (t) => npmGraph(t, 'express')],
  ['yarn berry', 'yarn-berry-v8.lock', (t) => yarnGraph(t, 'express')],
];

describe.each(managers)(
  '%s: a dependency moved onto the upgrade’s copy',
  (manager, file, graph) => {
    const text = (variant: string) => readFileSync(join(dir, `${variant}.${file}`), 'utf8');
    const read = (variant: string) => graph(text(variant));
    const outside = (before: string, after = read('after')) =>
      assertLockScope(graph(before), after, 'express', [], [], true)
        .outOfScope?.map(describeOutOfScope)
        .sort();

    it('is in scope, with the copy it left, and listed as housekeeping', () => {
      const diff = assertLockScope(read('before'), read('after'), 'express');
      expect(diff.outOfScope).toBeUndefined();
      expect(diff.housekeeping?.onto).toEqual([
        ...(manager === 'pnpm' ? [{ name: 'iconv-lite', from: '0.7.1', to: '0.7.3' }] : []),
        { name: 'qs', from: '6.12.0', to: '6.16.1' },
      ]);
    });

    it('is refused when the release is not one the upgrade brought', () => {
      expect(() => assertLockScope(read('before'), read('control'), 'express')).toThrow(
        /^Install changed resolutions outside express's dependency subtree: /,
      );
      expect(outside(text('before'), read('control'))).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^qs 6\.12\.0 → /),
          'http-client 2.0.0 → 2.0.0 (same version, different resolution)',
          'http-test 1.0.0 → 1.0.0 (same version, different resolution)',
        ]),
      );
    });

    it('is refused when it goes backwards or across a major', () => {
      const qs = (version: string) =>
        text('before')
          .replaceAll('qs: 6.12.0', `qs: ${version}`)
          .replaceAll('qs@6.12.0', `qs@${version}`)
          .replaceAll('"version": "6.12.0"', `"version": "${version}"`)
          .replaceAll('version: 6.12.0', `version: ${version}`)
          .replaceAll('qs@npm:6.12.0', `qs@npm:${version}`);
      // http-client was on a qs newer than express 5's 6.16.1: moving down is a real change.
      expect(outside(qs('6.17.0'))).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^qs 6\.17\.0 → /),
          'http-client 2.0.0 → 2.0.0 (same version, different resolution)',
        ]),
      );
      // A major apart is never the same dependency moving onto a shared copy.
      expect(outside(qs('5.2.0'))).toEqual(
        expect.arrayContaining([expect.stringMatching(/^qs 5\.2\.0 → /)]),
      );
    });
  },
);

it('never moves what the repository declares itself onto the upgrade’s copy', () => {
  // The app declares qs ^6.10.0 too: its own resolution moves only by the plan.
  const declared = (variant: string) =>
    readFileSync(join(dir, `${variant}.yarn-berry-v8.lock`), 'utf8').replace(
      '    express: npm:',
      '    qs: npm:^6.10.0\n    express: npm:',
    );
  expect(() =>
    assertLockScope(
      yarnGraph(declared('before'), 'express'),
      yarnGraph(declared('after'), 'express'),
      'express',
    ),
  ).toThrow(/importer app@workspace:\. resolutions/);
});

/** A logical lockfile: one record per name@version (a `~variant` suffix is not identity). */
const graph = (records: Record<string, Record<string, string>>): LockGraph => ({
  records: new Map(
    Object.entries(records).map(([key, edges]) => {
      const [name = '', version = ''] = key.split('~')[0]?.split('@') ?? [];
      return [
        key,
        {
          name,
          data: { version, dependencies: edges },
          identity: { name, version },
          edges,
          dependencies: Object.values(edges),
        },
      ];
    }),
  ),
  metadata: {},
});

it('treats a 0.x minor as a major: 0.6 is not moved onto the upgrade’s 0.7', () => {
  const before = graph({ 'lead@1.0.0': {}, 'x@1.0.0': { d: 'd@0.6.0' }, 'd@0.6.0': {} });
  const after = graph({
    'lead@2.0.0': { d: 'd@0.7.0' },
    'x@1.0.0': { d: 'd@0.7.0' },
    'd@0.7.0': {},
  });
  const diff = assertLockScope(before, after, 'lead', [], [], true);
  expect(diff.outOfScope?.map(describeOutOfScope).sort()).toEqual([
    'd 0.6.0 → none',
    'x 1.0.0 → 1.0.0 (same version, different resolution)',
  ]);
});

it('lists no move a refused dependent made', () => {
  // x moves s onto the upgrade's 1.1.0, but q to a 1.2.0 the upgrade did not bring: x is refused.
  const before = graph({
    'lead@1.0.0': {},
    'x@1.0.0': { s: 's@1.0.0', q: 'q@1.0.0' },
    's@1.0.0': {},
    'q@1.0.0': {},
  });
  const after = graph({
    'lead@2.0.0': { s: 's@1.1.0' },
    'x@1.0.0': { s: 's@1.1.0', q: 'q@1.2.0' },
    's@1.1.0': {},
    'q@1.2.0': {},
  });
  const diff = assertLockScope(before, after, 'lead', [], [], true);
  expect(diff.housekeeping?.onto).toBeUndefined();
  expect(diff.outOfScope?.map(describeOutOfScope)).toContain('s 1.0.0 → none');
});

it('lists no move from a candidate counterpart that did not match', () => {
  // x is renamed: its first candidate moves s onto the upgrade's copy but fails on q; the
  // second is x unchanged. Only what the match relied on is housekeeping: nothing here.
  const before = graph({
    'lead@1.0.0': {},
    'x@1.0.0': { s: 's@1.0.0', q: 'q@1.0.0' },
    's@1.0.0': {},
    'q@1.0.0': {},
  });
  const after = graph({
    'lead@2.0.0': { s: 's@1.1.0' },
    'x@1.0.0~a': { s: 's@1.1.0', q: 'q@1.2.0' },
    'x@1.0.0~b': { s: 's@1.0.0', q: 'q@1.0.0' },
    's@1.0.0': {},
    's@1.1.0': {},
    'q@1.0.0': {},
    'q@1.2.0': {},
  });
  expect(assertLockScope(before, after, 'lead', [], [], true).housekeeping?.onto).toBeUndefined();
});
