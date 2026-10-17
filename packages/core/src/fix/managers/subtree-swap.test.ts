import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertLockScope, describeTransitive, type LockGraph } from './lock-guard.js';
import { npmGraph } from './npm-lock.js';
import { pnpmGraph, yarnGraph } from './text-lock.js';

// `ui` 1 → 2 swaps its transitive dependencies: old-dep (and its old-leaf) go, new-dep (and
// its new-leaf) come, swap moves 1.0.0 → 1.2.0. `other` is not moved; in the control its
// dependency `shared` moves 1.0.0 → 1.1.0, which no upgrade of `ui` accounts for.
const dir = resolve(import.meta.dirname, '../../../../../fixtures/lockfiles/subtree-swap');
const managers: [string, string, (text: string) => LockGraph][] = [
  ['npm', 'package-lock.json', (t) => npmGraph(t, 'ui')],
  ['pnpm', 'pnpm-lock.yaml', (t) => pnpmGraph(t, 'ui')],
  ['yarn classic', 'yarn-classic.lock', (t) => yarnGraph(t, 'ui')],
  // Yarn 3 writes `old-dep: ^1.0.0` for the entry keyed `"old-dep@npm:^1.0.0"`.
  ['yarn berry, lockfile v6 (Yarn 3)', 'yarn-berry-v6.lock', (t) => yarnGraph(t, 'ui')],
  ['yarn berry, lockfile v8 (Yarn 4)', 'yarn-berry-v8.lock', (t) => yarnGraph(t, 'ui')],
];

describe.each(managers)(
  '%s: a new major that swaps its transitive dependencies',
  (_, file, graph) => {
    const read = (variant: string) => graph(readFileSync(join(dir, `${variant}.${file}`), 'utf8'));

    it('is inside the moved package’s subtree, before for what goes and after for what comes', () => {
      const diff = assertLockScope(read('before'), read('after'), 'ui');
      expect(diff.transitive).toEqual([
        {
          name: 'ui',
          from: ['1.0.0'],
          to: ['2.0.0'],
          changes: [
            { name: 'new-dep', to: '2.0.0' },
            { name: 'new-leaf', to: '2.0.0' },
            { name: 'old-dep', from: '1.0.0' },
            { name: 'old-leaf', from: '1.0.0' },
            { name: 'swap', from: '1.0.0', to: '1.2.0' },
          ],
        },
      ]);
      expect(diff.transitive?.[0]?.changes.map(describeTransitive)).toContain(
        'replaced swap 1.0.0 with 1.2.0',
      );
    });

    it('still rejects a change only an unmoved package reaches', () => {
      let message = '';
      try {
        assertLockScope(read('before'), read('control'), 'ui');
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/^Install changed resolutions outside ui's dependency subtree: /);
      expect(message).toMatch(/shared/);
      // Only the outside change is named; the swap itself stays allowed next to it.
      expect(message).not.toMatch(/old-dep|old-leaf|new-dep|new-leaf|swap/);
    });

    it('reports that change instead of refusing when an agent leads (UPT-78)', () => {
      const diff = assertLockScope(read('before'), read('control'), 'ui', [], [], true);
      expect(diff.outOfScope?.map((c) => c.name)).toContain('shared');
    });
  },
);

it('yarn berry v6: an importer’s resolution is compared, not lost to the missing protocol', () => {
  const text = readFileSync(join(dir, 'before.yarn-berry-v6.lock'), 'utf8');
  const graph = yarnGraph(text, 'ui');
  expect(graph.roots?.['app@workspace:.']).toEqual({
    other: 'other@npm:^1.0.0',
    ui: 'ui@npm:^1.0.0',
  });
  expect(graph.records.get('ui@npm:^1.0.0')?.dependencies).toEqual([
    'old-dep@npm:^1.0.0',
    'swap@npm:1.0.0',
  ]);
});
