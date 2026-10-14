import { expect, it } from 'vitest';
import type { Finding } from '../domain/report.js';
import { foldOptionCascades } from './option-cascades.js';

/** The shape of TryGhost/ActivityPub's src/instrumentation.ts at @sentry/node 11 (lines 47-77). */
const text = [
  "import * as Sentry from '@sentry/node';",
  'Sentry.init({',
  '  openTelemetrySpanProcessors,',
  '  integrations: [',
  '    Sentry.httpIntegration({',
  '      instrumentation: {',
  '        requestHook: (span, req) => {',
  '          span.updateName(req.url);',
  '        },',
  '        applyCustomAttributesOnSpan: (_span) => {},',
  '      },',
  '    }),',
  '  ],',
  '  beforeSend: (event) => event,',
  '});',
  '',
].join('\n');

const at = (
  line: number,
  needle: string,
  code: number,
  rule?: string,
  file = 'src/instrumentation.ts',
): Finding => {
  const column = (text.split('\n')[line - 1] ?? '').indexOf(needle) + 1;
  return {
    change: {
      package: '@sentry/node',
      from: '10.75.3',
      to: '11.0.0',
      path: `TS${code}`,
      kind: 'type',
      severity: 'breaking',
      source: 'compiler',
      confidence: 1,
    },
    usage: {
      file,
      line,
      column,
      endLine: line,
      endColumn: column,
      symbolPath: `TS${code}`,
      access: 'read',
      snippet: '',
      via: 'direct',
      compileCode: code,
      compileError: `TS${code} at ${needle}`,
    },
    severity: 'breaking',
    confidence: 1,
    fixability: 'assisted',
    reason: '',
    ...(rule ? { rule } : {}),
  } as Finding;
};
const claimed = (f: Finding) => f.rule !== undefined;
const read = (file: string) => (file === 'src/instrumentation.ts' ? text : undefined);
const sites = (findings: Finding[]) =>
  findings.map((f) => `${f.usage.line}:${f.usage.compileCode}`);

it('folds implicit-any errors inside a removed option into the pack finding there', () => {
  const findings = [
    at(3, 'openTelemetrySpanProcessors', 2353, 'opentelemetry-setup'),
    at(6, 'instrumentation', 2353, 'http-integration-options'),
    at(7, 'span', 7006),
    at(7, 'req', 7006),
    at(10, '_span', 7006),
    at(14, 'event', 7006),
  ];
  const out = foldOptionCascades(findings, claimed, read);
  expect(sites(out)).toEqual(['3:2353', '6:2353', '14:7006']);
  const anchor = out.find((f) => f.usage.line === 6) as Finding;
  expect(anchor.downstream?.map((d) => `${d.line}:${d.code}`)).toEqual([
    '7:7006',
    '7:7006',
    '10:7006',
  ]);
  expect(anchor.details?.at(-1)).toMatch(
    /3 implicit-any errors inside this option \(lines 7, 7, 10\)/,
  );
});

it('leaves the errors alone when no pack claims the option', () => {
  const findings = [at(6, 'instrumentation', 2353), at(7, 'span', 7006)];
  expect(foldOptionCascades(findings, claimed, read)).toEqual(findings);
});

it('folds under a pack-detected option too, and never across files', () => {
  const detected = { ...at(6, 'instrumentation', 2353, 'http-integration-options') };
  detected.change = { ...detected.change, source: 'pack' };
  detected.usage = { ...detected.usage, compileCode: undefined, compileError: undefined };
  const elsewhere = at(7, 'span', 7006, undefined, 'src/other.ts');
  const out = foldOptionCascades([detected, at(10, '_span', 7006), elsewhere], claimed, read);
  expect(out).toHaveLength(2);
  expect(out[0]?.downstream?.map((d) => d.line)).toEqual([10]);
  expect(out[1]).toBe(elsewhere);
});
