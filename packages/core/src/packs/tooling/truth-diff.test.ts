import { describe, expect, it } from 'vitest';
import { definePack } from '../contract.js';
import { scoreSites, scoreTruth } from './pack-test.js';
import { diffLines, enclosingLiteral, insertionAnchors } from './truth-diff.js';

/** `body` placed so that its first line is line `first` of the file. */
const at = (first: number, body: string) =>
  `${Array.from({ length: first - 1 }, (_, i) => `// ${i + 1}`).join('\n')}\n${body}`;

// Synthetic, modeled on open-foundry's ioredis 5 → 6 upgrade (packages/api/src/server.ts): the
// commit rewrote how the client constructor is obtained (135–137) and inserted `protocol: 2`
// into the unchanged constructor call that starts at 138.
const server = at(
  134,
  `  if (url) {
    // the client is optional
    const mod = await import('redis-like');
    const Client = mod.default as unknown as new (url: string, o: object) => Client;
    client = new Client(url, {
      // fail fast
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    limiter = new Limiter(client);
  }
`,
);
const diff = `diff --git a/src/server.ts b/src/server.ts
--- a/src/server.ts
+++ b/src/server.ts
@@ -135,3 +135,2 @@ async function main(): Promise<void> {
-    // the client is optional
-    const mod = await import('redis-like');
-    const Client = mod.default as unknown as new (url: string, o: object) => Client;
+    // the client stays optional
+    const { Client } = await import('redis-like');
@@ -138,0 +138,2 @@ async function main(): Promise<void> {
+      // keep the v5 wire protocol
+      protocol: 2,
`;

describe('an option added inside an unchanged call', () => {
  const lines = diffLines(diff);
  const anchors = insertionAnchors(lines, (file) =>
    file === 'src/server.ts' ? server : undefined,
  );

  it('is drafted as a site at the call, next to the rewritten lines above it', () => {
    expect(lines.changed.map((c) => c.line)).toEqual([135, 136, 137]);
    expect(lines.inserted.map((i) => [i.after, i.text])).toEqual([
      [138, '// keep the v5 wire protocol'],
      [138, 'protocol: 2,'],
    ]);
    expect(anchors).toEqual([
      {
        file: 'src/server.ts',
        line: 138,
        text: 'client = new Client(url, {',
        within: 'call',
        inserted: [
          { after: 138, text: '// keep the v5 wire protocol' },
          { after: 138, text: 'protocol: 2,' },
        ],
      },
    ]);
  });

  it('scores the prediction at the call as a true positive once the truth anchors it there', () => {
    const pack = definePack({
      meta: {
        package: 'redis-like',
        from: '>=5 <6',
        to: '>=6 <7',
        sources: [{ title: 'guide', url: 'https://example.com/guide' }],
        maintainer: 'uptide-dev',
      },
      rules: [],
      behavior: [
        {
          id: 'client-defaults',
          summary: 'a client keeps RESP3',
          reported: ['finding'],
          severity: 'deprecated',
          detect: () => [],
        },
      ],
      instructions: '',
    });
    const predicted = [
      {
        file: 'src/server.ts',
        line: 138,
        rule: 'client-defaults',
        severity: 'deprecated' as const,
      },
    ];
    const site = (line: number) => ({ file: 'src/server.ts', line, rule: 'client-defaults' });
    // Before: the rewritten run alone (136) is a site, and the call is a false positive.
    const before = scoreSites(predicted, [site(136)]);
    expect(before.falsePositives.map((s) => s.line)).toEqual([138]);
    // After: the insertion's anchor is a site too.
    const expected = [site(136), ...anchors.map((a) => site(a.line))];
    const score = scoreTruth(pack, [{ predicted, expected, ...scoreSites(predicted, expected) }]);
    expect(score.rules['client-defaults']).toMatchObject({
      truePositives: 1,
      falsePositives: 0,
      falseNegatives: 1,
    });
  });
});

describe('enclosingLiteral', () => {
  const text = `const a = 1;
const client = new Client({
  tls: {
    ca,
  },
});
const options = {
  retry: 1,
};
app.use((req) => {
  log(req);
});
function start() {
  connect();
}
configure(
  url,
);
`;

  it('anchors at the call through nested object literals, and at a lone object', () => {
    expect(enclosingLiteral('a.ts', text, 2)).toEqual({ line: 2, endLine: 6, within: 'call' });
    expect(enclosingLiteral('a.ts', text, 4)).toEqual({ line: 2, endLine: 6, within: 'call' });
    expect(enclosingLiteral('a.ts', text, 7)).toEqual({ line: 7, endLine: 9, within: 'object' });
    // A new argument between the parentheses.
    expect(enclosingLiteral('a.ts', text, 17)).toEqual({ line: 16, endLine: 18, within: 'call' });
  });

  it('anchors nothing between statements or inside a function body, even one passed to a call', () => {
    expect(enclosingLiteral('a.ts', text, 1)).toBeUndefined();
    expect(enclosingLiteral('a.ts', text, 6)).toBeUndefined();
    expect(enclosingLiteral('a.ts', text, 10)).toBeUndefined();
    expect(enclosingLiteral('a.ts', text, 13)).toBeUndefined();
    expect(enclosingLiteral('a.ts', text, 19)).toBeUndefined();
  });

  it('leaves an insertion into a call the upgrade also changed to that call’s changed lines', () => {
    const changed = [{ file: 'a.ts', line: 3, text: 'tls: {' }];
    const inserted = [{ file: 'a.ts', after: 4, text: 'rejectUnauthorized: false,' }];
    expect(insertionAnchors({ changed, inserted }, () => text)).toEqual([]);
  });

  it('reads JSX', () => {
    const tsx = 'export const App = () => render(\n  <Root />,\n  el,\n);\n';
    expect(enclosingLiteral('app.tsx', tsx, 2)).toEqual({ line: 1, endLine: 4, within: 'call' });
  });
});
