import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compare, hunks, regressions } from './score.mjs';

const diff = (...parts) => parts.join('\n');
const human = hunks(
  diff(
    'diff --git a/src/a.ts b/src/a.ts',
    '@@ -3 +3 @@',
    '@@ -10,0 +11,2 @@',
    'diff --git a/package-lock.json b/package-lock.json',
    '@@ -1,4 +1,4 @@',
    'diff --git a/src/b.tsx b/src/b.tsx',
    '@@ -7,2 +7,0 @@',
  ),
);

test('code hunks only, with old start and count', () => {
  assert.deepEqual(human, [
    { file: 'src/a.ts', start: 3, count: 1 },
    { file: 'src/a.ts', start: 10, count: 0 },
    { file: 'src/b.tsx', start: 7, count: 2 },
  ]);
});

test('a hunk is covered when the run touches one of its old lines', () => {
  const agent = hunks(diff('diff --git a/src/a.ts b/src/a.ts', '@@ -2,2 +2,2 @@', '@@ -11 +11 @@'));
  const { covered, missed } = compare(human, agent);
  assert.equal(covered, 2); // line 3, and the insertion after 10 by touching 11
  assert.deepEqual(missed, [{ file: 'src/b.tsx', start: 7, count: 2 }]);
});

test('regressions are failures the reference does not have', () => {
  const reference = {
    reference: true,
    checks: { test: 0, lint: 1 },
    ci: [{ name: 'ci/build', bucket: 'pass' }],
  };
  const row = { checks: { test: 1, lint: 1 }, ci: [{ name: 'ci/build', bucket: 'fail' }] };
  assert.deepEqual(regressions(row, reference), ['local test', 'ci ci/build']);
});
