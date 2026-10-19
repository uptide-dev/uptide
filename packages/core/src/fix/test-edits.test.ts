import { expect, it } from 'vitest';
import { missingProperties, testEditObjection } from './test-edits.js';

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

// UPT-121: v11 made SpanJSON.status required; the fix adds it to the fixture.
const span = `it('strips child spans', () => {
  const event: Event = {
    spans: [
      {
        span_id: 'a',
        start_timestamp: 0,
        data: { 'http.client_ip': '203.0.113.7' },
      },
    ],
  };
  strip(event);
  expect(event.spans?.[0]?.data).toEqual({});
});`;
const withStatus = span.replace(
  'start_timestamp: 0,',
  "start_timestamp: 0,\n        status: 'ok',",
);
const missing = missingProperties(
  [
    {
      file: 'tests/span.test.ts',
      line: 4,
      column: 7,
      code: 2741,
      message:
        "Property 'status' is missing in type '{ span_id: string; }' but required in type 'SpanJSON'.",
    },
  ],
  'tests/span.test.ts',
);
const why = 'SpanJSON.status is required in v11.';

it('names the properties the compiler reports missing', () => {
  expect([...missing]).toEqual(['status']);
  expect([
    ...missingProperties(
      [
        {
          file: 'a.test.ts',
          line: 1,
          column: 1,
          code: 2739,
          message:
            "Type '{ id: string; }' is missing the following properties from type 'Span': status, kind",
        },
      ],
      'a.test.ts',
    ),
  ]).toEqual(['status', 'kind']);
});
it('allows adding a property the compiler reports missing to a fixture', () => {
  expect(testEditObjection('tests/span.test.ts', span, withStatus, why, missing)).toBeUndefined();
  const existing = span.replace("span_id: 'a',", "span_id: 'a',\n        status: 'error',");
  const both = `${existing}\n${span}`;
  const added = `${existing}\n${withStatus}`;
  expect(testEditObjection('tests/span.test.ts', both, added, why, missing)).toBeUndefined();
});
it.each([
  ['the compiler did not name', span, withStatus, new Set<string>()],
  [
    'with a computed value',
    span,
    span.replace('start_timestamp: 0,', 'start_timestamp: 0, status: status(),'),
    missing,
  ],
  [
    'alongside another input change',
    span,
    withStatus.replace("'203.0.113.7'", "'10.0.0.1'"),
    missing,
  ],
  [
    'that was already there',
    span.replace("span_id: 'a',", "span_id: 'a', status: 'error',"),
    withStatus,
    missing,
  ],
])('rejects a fixture property %s', (_, before, after, names) => {
  expect(testEditObjection('tests/span.test.ts', before, after, why, names)).toContain('rejected');
});
