import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify, fingerprintOf } from './classify.mjs';

const summary = (breaking = 0, failed = 0) => ({ summary: { breaking, failed } });
const kind = (s) => classify(s).kind;

test('check: 0 and 1 that agree with the result are successes', () => {
  assert.equal(kind({ step: 'check', exit: 0, json: summary(0) }), 'success');
  assert.equal(kind({ step: 'check', exit: 1, json: summary(3) }), 'success');
});

test('check: exit codes that contradict the result are wrong-exit-code', () => {
  assert.equal(kind({ step: 'check', exit: 0, json: summary(2) }), 'wrong-exit-code');
  assert.equal(kind({ step: 'check', exit: 0, json: summary(0, 1) }), 'wrong-exit-code');
  assert.equal(kind({ step: 'check', exit: 1, json: summary(0) }), 'wrong-exit-code');
  assert.equal(kind({ step: 'check', exit: 2, json: summary(4) }), 'wrong-exit-code');
  assert.equal(kind({ step: 'check', exit: 3, json: summary(0) }), 'wrong-exit-code');
  assert.equal(kind({ step: 'check', exit: 0, json: null }), 'wrong-exit-code');
});

test('a timeout, a signal and an uncaught exception are not exit-code problems', () => {
  assert.equal(kind({ step: 'fix', exit: null, timedOut: true }), 'timeout');
  assert.equal(kind({ step: 'check', exit: null, signal: 'SIGKILL' }), 'crash');
  const stderr =
    'TypeError: x is not a function\n    at a (/p/a.js:1:2)\n    at b (/p/b.js:3:4)\n    at c (/p/c.js:5:6)\n\nNode.js v22.1.0\n';
  assert.equal(kind({ step: 'check', exit: 1, stderr, json: null }), 'crash');
  assert.equal(
    kind({ step: 'fix', exit: 134, stderr: 'FATAL ERROR: heap out of memory' }),
    'crash',
  );
});

test('exit 2 is a false refusal unless it is the documented no-pack exit', () => {
  const stderr = 'error: foo is not supported in this repository';
  assert.equal(kind({ step: 'check', exit: 2, stderr, json: summary(0, 1) }), 'false-refusal');
  const noPack =
    'error: x has no migration pack, so every fix would come from the agent\n  Nothing was changed: no clone, no branch, no install.';
  assert.equal(kind({ step: 'fix', exit: 2, stderr: noPack }), 'expected');
  const late = 'error: x has no migration pack, so every fix would come from the agent';
  assert.equal(kind({ step: 'fix', exit: 2, stderr: late }), 'other');
  assert.equal(
    kind({ step: 'check', exit: 2, stderr: 'ENOTFOUND registry', json: summary(0, 1) }),
    'other',
  );
});

test('fix: 0 verified, 1 not verified', () => {
  assert.equal(kind({ step: 'fix', exit: 0 }), 'success');
  assert.equal(kind({ step: 'fix', exit: 1, stderr: 'error: tests failed' }), 'other');
});

test('fingerprints drop paths, versions and scoped package names so repositories group', () => {
  const a = fingerprintOf('error: @a/lodash 4.17.21 cannot resolve /home/u/repo/node_modules/x');
  const b = fingerprintOf('error: @b/zod 3.23.8 cannot resolve /work/r/node_modules/y');
  assert.equal(a, b);
});

test('a worker out of memory is a crash, a peer blocker is a documented stop', () => {
  const oom = 'error: Worker terminated due to reaching memory limit: JS heap out of memory';
  assert.equal(kind({ step: 'fix', exit: 2, stderr: oom }), 'crash');
  const json = { error: { message: 'uptide fix · x · 1 peer blocker to resolve first\nNext: y' } };
  assert.equal(kind({ step: 'fix', exit: 2, stdout: '{}', json }), 'expected');
});
