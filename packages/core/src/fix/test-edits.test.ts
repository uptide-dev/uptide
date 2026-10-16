import { expect, it } from 'vitest';
import { testEditObjection } from './test-edits.js';

const original = `it('validates', () => { expect(parse(input)).toEqual({ message: 'old' }); });`;
it('requires a reason even when only an expected literal changes', () => {
  expect(
    testEditObjection('schema.test.ts', original, original.replace("'old'", "'new'")),
  ).toContain('explanation');
  expect(
    testEditObjection(
      'schema.test.ts',
      original,
      original.replace("'old'", "'new'"),
      'The upgrade changed the exact default message.',
    ),
  ).toBeUndefined();
});
it.each([
  original.replace("'old'", 'parse(input)'),
  original.replace('parse(input)', "'new'"),
  original.replace('toEqual', 'toMatchObject'),
  original.replace('it(', 'it.only('),
  ['/* @vitest', '-environment custom */\n', original].join(''),
  '',
])('rejects changes to assertion logic or test execution', (changed) => {
  expect(testEditObjection('schema.test.ts', original, changed, 'make it pass')).toContain(
    'rejected',
  );
});
