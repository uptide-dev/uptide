import { expect, it } from 'vitest';
import { testEditObjection } from './test-edits.js';
import type { FixtureProperty } from './types.js';

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
      {
        span_id: 'b',
        start_timestamp: 0,
      },
    ],
  };
  strip(event);
  expect(event.spans?.[0]?.data).toEqual({});
});`;
const file = 'tests/span.test.ts';
// The compiler anchors TS2741 for an array element at its opening brace: the first span only.
const missing = [
  {
    file,
    line: 4,
    column: 7,
    code: 2741,
    message:
      "Property 'status' is missing in type '{ span_id: string; }' but required in type 'SpanJSON'.",
  },
];
const addTo = (text: string, spanId: string, property = "status: 'ok',") =>
  text.replace(`span_id: '${spanId}',`, `span_id: '${spanId}',\n        ${property}`);
const why = 'SpanJSON.status is required in v11.';

it('allows adding a missing property to the object the diagnostic points at, and records it', () => {
  const added: FixtureProperty[] = [];
  expect(testEditObjection(file, span, addTo(span, 'a'), why, missing, added)).toBeUndefined();
  expect(added).toEqual([{ file, line: 6, property: 'status', value: "'ok'" }]);
});
it('finds the object through the name or return the compiler points at', () => {
  const declared = "it('x', () => { const s: Span = { id: 'x' };\n  use({ id: 'y' });\n});";
  const listed = {
    file: 'a.test.ts',
    line: 1,
    column: 23,
    code: 2739,
    message:
      "Type '{ id: string; }' is missing the following properties from type 'Span': status, kind",
  };
  const added: FixtureProperty[] = [];
  const both = declared.replace("{ id: 'x' }", "{ id: 'x', status: 'ok', kind: 1 }");
  expect(testEditObjection('a.test.ts', declared, both, why, [listed], added)).toBeUndefined();
  expect(added.map((p) => `${p.property}: ${p.value}`)).toEqual(["status: 'ok'", 'kind: 1']);
  const nested = "const e: E = {\n  span: { id: 'x' },\n};\nit('x', () => {});";
  const named = { ...listed, file: 'b.test.ts', line: 2, column: 3 };
  expect(
    testEditObjection(
      'b.test.ts',
      nested,
      nested.replace("id: 'x'", "id: 'x', status: 'ok'"),
      why,
      [named],
    ),
  ).toBeUndefined();
  expect(
    testEditObjection('b.test.ts', nested, nested.replace('span:', "status: 'ok',\n  span:"), why, [
      named,
    ]),
  ).toContain('rejected');
  const returned = "const make = (): Span => {\n  return { id: 'x' };\n};\nit('x', () => {});";
  const atReturn = { ...listed, file: 'c.test.ts', line: 2, column: 3 };
  expect(
    testEditObjection(
      'c.test.ts',
      returned,
      returned.replace("id: 'x'", "id: 'x', status: 'ok'"),
      why,
      [atReturn],
    ),
  ).toBeUndefined();
});
it('rejects the same property added to another object in the file', () => {
  const added: FixtureProperty[] = [];
  expect(testEditObjection(file, span, addTo(span, 'b'), why, missing, added)).toContain(
    'rejected',
  );
  expect(
    testEditObjection(file, span, addTo(addTo(span, 'a'), 'b'), why, missing, added),
  ).toContain('rejected');
  expect(
    testEditObjection(
      file,
      span,
      span.replace('spans: [', "status: 'ok',\n    spans: ["),
      why,
      missing,
    ),
  ).toContain('rejected');
  expect(added).toEqual([]);
});
it.each([
  ['the compiler did not name', span, addTo(span, 'a'), []],
  ['with a computed value', span, addTo(span, 'a', 'status: status(),'), missing],
  [
    'alongside another input change',
    span,
    addTo(span, 'a').replace("'203.0.113.7'", "'10.0.0.1'"),
    missing,
  ],
  ['that was already there', addTo(span, 'a', "status: 'error',"), addTo(span, 'a'), missing],
])('rejects a fixture property %s', (_, before, after, diagnostics) => {
  expect(testEditObjection(file, before, after, why, diagnostics)).toContain('rejected');
});
