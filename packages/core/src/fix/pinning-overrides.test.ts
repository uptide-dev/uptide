import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { planRootPins } from './root-pins.js';

const fixtures = resolve(import.meta.dirname, '../../../../fixtures/lockfiles/subtree-swap');
const scratch = mkdtempSync(join(tmpdir(), 'uptide-pins-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A repository whose root manifest carries `extra`, next to the given lockfile. */
function repo(extra: Record<string, unknown>, lock?: [string, string]): string {
  const root = mkdtempSync(join(scratch, 'repo-'));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'app', dependencies: { ui: '^1.0.0', other: '^1.0.0' }, ...extra }),
  );
  if (lock) copyFileSync(join(fixtures, lock[0]), join(root, lock[1]));
  return root;
}
const moves = [{ name: 'ui', to: '2.0.0' }];

// medusa pins `@types/react` to `^18.3.2` in its root resolutions: the install kept 18.3.31
// and the lockfile had no entry for the root's new `^19.3.0`.
describe.each([
  ['Yarn 3 (lockfile v6)', 'before.yarn-berry-v6.lock'],
  ['Yarn 4 (lockfile v8)', 'before.yarn-berry-v8.lock'],
])('%s: the repository’s own resolutions', (_, lock) => {
  it('stop the upgrade before anything runs when they pin a moved package', () => {
    for (const key of ['ui', '**/ui'])
      expect(() =>
        planRootPins(repo({ resolutions: { [key]: '^1.0.0' } }, [lock, 'yarn.lock']), moves),
      ).toThrow(`"resolutions" > "${key}" pins ui to ^1.0.0; it will be updated to 2.0.0`);
  });

  it('leave unrelated and compatible pins alone', () => {
    for (const resolutions of [{ 'other/swap': '^1.0.0' }, { ui: '^2.0.0' }, { swap: '1.0.0' }])
      expect(() => planRootPins(repo({ resolutions }, [lock, 'yarn.lock']), moves)).not.toThrow();
  });
});

it('reads npm overrides and pnpm overrides the same way', () => {
  expect(() => planRootPins(repo({ overrides: { ui: '1.0.0' } }), moves)).toThrow(
    'pins ui to 1.0.0; it will be updated to 2.0.0',
  );
  expect(() => planRootPins(repo({ pnpm: { overrides: { ui: '<2' } } }), moves)).toThrow(
    'pins ui to <2; it will be updated to 2.0.0',
  );
  // Scoped pins require a manual decision.
  expect(() =>
    planRootPins(
      repo({ overrides: { other: { ui: '1.0.0' } }, pnpm: { overrides: { 'other>ui': '1' } } }),
      moves,
    ),
  ).toThrow('cannot be updated safely');
});
