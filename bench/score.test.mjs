import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compare, hunks, regressions, silent } from './score.mjs';

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

test('silent changes: caught by the keep edit at the site or a decision naming the record; a named site the selection lacks is a false positive', () => {
  const record = 'zod/mcp-input-schema-additional-properties';
  const entry = {
    silent: [69, 83, 102].map((line) => ({
      file: 'src/tools/index.ts',
      line,
      record,
      keep: '\\.strict\\(\\)|strictObject\\(',
    })),
  };
  const agent = hunks(
    diff('diff --git a/src/tools/index.ts b/src/tools/index.ts', '@@ -69 +69 @@'),
  );
  const head = () => 'function strictInput(shape) { return z.object(shape).strict(); }';
  assert.deepEqual(silent(entry, agent, '', head), {
    silentSites: 3,
    silentEdited: ['src/tools/index.ts:69'],
    silentDecided: [],
    silentFalsePositives: [],
  });
  // The line touched without the edit is not caught.
  assert.deepEqual(silent(entry, agent, '', () => 'z.object(shape)').silentEdited, []);
  const body = `- **Behavior change (${record}):** … Not applied at \`src/tools/index.ts:83\`, \`src/other.ts:4\`: recommended ([source](https://example.com))`;
  assert.deepEqual(silent(entry, agent, body, head), {
    silentSites: 3,
    silentEdited: ['src/tools/index.ts:69'],
    silentDecided: ['src/tools/index.ts:83'],
    silentFalsePositives: [`${record} src/other.ts:4`],
  });
  assert.equal(silent({}, agent, body, head).silentSites, 0);
  assert.deepEqual(
    silent(entry, [], body.replace('([source](https://example.com))', ''), head).silentDecided,
    [],
  );
  assert.deepEqual(
    silent(entry, [], body.replace('Behavior change', 'Kept'), head).silentFalsePositives,
    [`${record} src/other.ts:4`],
  );
});

test('Stripe builder edit scores the creation site, not unrelated billing changes', () => {
  const entry = {
    silent: [
      {
        file: 'provisioning.ts',
        line: 355,
        editLine: 292,
        editLineEnd: 303,
        record: 'stripe/billing-mode-default-flexible',
        keep: "billing_mode: \\{ type: 'classic' \\}",
      },
    ],
  };
  const edits = [{ file: 'provisioning.ts', start: 293, count: 0 }];
  assert.deepEqual(
    silent(entry, edits, '', () => "billing_mode: { type: 'classic' }").silentEdited,
    ['provisioning.ts:355'],
  );
  assert.deepEqual(
    silent(entry, edits, '', () => "billing_mode: { type: 'flexible' }").silentEdited,
    [],
  );
  assert.deepEqual(
    silent(
      entry,
      [{ file: 'provisioning.ts', start: 500, count: 1 }],
      '',
      () => "billing_mode: { type: 'classic' }",
    ).silentEdited,
    [],
  );
});
