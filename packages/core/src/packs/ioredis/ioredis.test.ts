import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { packDecisions } from '../decisions.js';
import { fixtureFinding, runFixtures } from '../tooling/fixtures.js';
import type { PackContext } from '../types.js';
import { bundledCopies, instrumentationGaps, nodeEvidence, staleTypes } from './behavior.js';
import { ioredisPack } from './index.js';

it('ioredis: every fixture rewrites and detects exactly its marked sites', () => {
  const result = runFixtures(ioredisPack, fileURLToPath(new URL('.', import.meta.url)));
  expect(result.cases.length).toBeGreaterThan(0);
  expect(result.unknown).toEqual([]);
  expect(result.rewriteFailures).toEqual([]);
  expect(result.falsePositives).toEqual([]);
  expect(result.falseNegatives).toEqual([]);
});

/** The diagnostic inbox-zero's own TypeScript gave with bullmq 5's private ioredis 5 in place. */
const twoCopies =
  "Type 'Redis<\"legacy\">' is not assignable to type 'ConnectionOptions'.   Type 'Redis<\"legacy\">' is not assignable to type 'ClusterOptions | Redis | IRedisClient | Cluster'.";

it.each([
  ['bundled-ioredis', 'TS2322', twoCopies],
  [
    'bundled-ioredis',
    'TS2345',
    "Argument of type 'Cluster<\"legacy\">' is not assignable to parameter of type 'Cluster'.",
  ],
  [
    'duplicate-signature',
    'TS2416',
    "Property 'duplicate' in type 'TracedRedis' is not assignable to the same property in base type 'Redis<\"legacy\">'.",
  ],
])('claims %s from compiler evidence only, and never rewrites it', (rule, path, message) => {
  const text = 'reportedSite;';
  const finding = fixtureFinding(
    ioredisPack,
    { case: 'compiler', file: 'queue.ts', line: 1, rule, keep: false, kind: 'type', path, message },
    text,
  );
  delete finding.rule;
  expect(ioredisPack.ruleOf?.(finding)).toBe(rule);
  expect(
    ioredisPack.transform(text, finding, { from: '5.11.1', to: '6.0.0', includeDeprecated: true }),
  ).toMatchObject({ text, applied: false });
  finding.usage.compileError = "Type 'string' is not assignable to type 'number'.";
  expect(ioredisPack.ruleOf?.(finding)).toBeUndefined();
});

it('offers the bundled-copy options in its guide, so the agent reports which one it chose', () => {
  const rule = ioredisPack.rules.find((r) => r.id === 'bundled-ioredis');
  expect(rule?.guide).toMatch(/Options: \(a\).*\(b\).*\(c\).*\(d\).*Say which you chose/);
  expect(rule?.guide).toMatch(/Never cast/);
});

const context = (inventory: { file: string; text: string }[], to = '6.0.0'): PackContext => ({
  inventory,
  from: '5.11.1',
  to,
  includeDeprecated: false,
});
const manifest = (pkg: object, file = 'package.json') => ({ file, text: JSON.stringify(pkg) });

describe('repository evidence for the decisions', () => {
  it('names Node declarations that permit a runtime below 20, and none when they do not', () => {
    expect(
      nodeEvidence(
        context([manifest({ engines: { node: '>=18.0.0' } }), { file: '.nvmrc', text: '22\n' }]),
      ),
    ).toBe('`package.json` engines.node ">=18.0.0" permits Node below 20');
    expect(
      nodeEvidence(
        context([
          manifest({ engines: { node: '>=20' } }),
          {
            file: '.github/workflows/ci.yml',
            text: `jobs:\n  test:\n    strategy:\n      matrix:\n        node: [18, 22]\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: \${{ matrix.node }}\n`,
          },
        ]),
      ),
    ).toBe('`.github/workflows/ci.yml` node-version "18" permits Node below 20');
    expect(nodeEvidence(context([manifest({ engines: { node: '^20.9 || >=22' } })]))).toBe(false);
    expect(nodeEvidence(context([manifest({ name: 'app' })]))).toMatch(/No Node version/);
  });

  it('names dependents that install their own ioredis 5, and not those that peer on it', () => {
    const hit = bundledCopies(
      context([
        manifest({ dependencies: { bullmq: '^5.79.2', '@hocuspocus/extension-redis': '4.7.0' } }),
        manifest({ dependencies: { bullmq: '^6.3.8' } }, 'apps/worker/package.json'),
      ]),
    );
    expect(hit).toContain('`package.json` declares bullmq "^5.79.2"');
    expect(hit).toContain('@hocuspocus/extension-redis');
    expect(hit).not.toContain('apps/worker');
    expect(
      bundledCopies(context([manifest({ dependencies: { '@nestjs-modules/ioredis': '2.3.1' } })])),
    ).toBe(false);
  });

  it('names instrumentation that only patches ioredis below 6, and stale @types', () => {
    expect(
      instrumentationGaps(
        context([
          manifest({ dependencies: { '@opentelemetry/auto-instrumentations-node': '^0.79.0' } }),
        ]),
      ),
    ).toContain('auto-instrumentations-node "^0.79.0"');
    expect(
      instrumentationGaps(
        context([
          manifest({ dependencies: { '@opentelemetry/instrumentation-ioredis': '^0.71.0' } }),
        ]),
      ),
    ).toBe(false);
    expect(
      staleTypes(context([manifest({ devDependencies: { '@types/ioredis': '^4.28.10' } })])),
    ).toBe('`package.json` declares @types/ioredis');
  });

  it('renders only the decisions this repository has evidence for', () => {
    const lines = packDecisions(
      ioredisPack,
      context(
        [manifest({ engines: { node: '>=20' }, dependencies: { bullmq: '5.79.2' } })],
        '6.1.0',
      ),
      [],
    );
    expect(lines.some((l) => l.includes('clients built without explicit protocol'))).toBe(true);
    expect(lines.some((l) => l.includes('declares bullmq "5.79.2"'))).toBe(true);
    expect(lines.some((l) => l.includes('permits Node'))).toBe(false);
    expect(lines.some((l) => l.includes('String.prototype'))).toBe(false);
    expect(lines.some((l) => l.includes('@types/ioredis'))).toBe(false);
    expect(
      packDecisions(ioredisPack, context([manifest({ engines: { node: '>=20' } })]), []).some((l) =>
        l.includes('String.prototype'),
      ),
    ).toBe(true);
  });
});
