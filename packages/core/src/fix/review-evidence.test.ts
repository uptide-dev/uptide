import { expect, it } from 'vitest';
import { testOutput } from './review-evidence.js';

it('keeps the first failing error and summary, collapsing repeated lines', () => {
  const output = [
    'warning',
    'warning',
    'FAIL a.test.ts',
    '  first error',
    '  first error',
    'FAIL b.test.ts',
    'second error',
    'Test Suites: 2 failed, 3 passed',
    'Tests: 12 passed',
  ].join('\n');
  const rendered = testOutput(output);
  expect(rendered).toContain('warning (repeated 2 times)');
  expect(rendered).toContain('first error (repeated 2 times)');
  expect(rendered).toContain('Tests: 12 passed');
  expect(rendered).not.toContain('second error');
});
it('bounds a large first error without losing the summary', () => {
  const rendered = testOutput(
    [
      'FAIL a.test.ts',
      ...Array.from({ length: 500 }, (_, i) => `frame ${i}`),
      'Test Suites: 1 failed',
    ].join('\n'),
  );
  expect(rendered.length).toBeLessThan(5000);
  expect(rendered).toContain('output truncated');
  expect(rendered).toContain('Test Suites: 1 failed');
});
