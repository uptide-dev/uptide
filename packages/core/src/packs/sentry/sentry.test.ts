import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectIn } from '../contract.js';
import { packDecisions } from '../decisions.js';
import { packInventory } from '../inventory.js';
import { sentryBrowserPack } from '../sentry-browser/index.js';
import { sentryNextjsPack } from '../sentry-nextjs/index.js';
import { sentryNodePack } from '../sentry-node/index.js';
import { sentryReactPack } from '../sentry-react/index.js';
import { fixtureFinding } from '../tooling/fixtures.js';
import { LOCKSTEP } from './meta.js';
import { SENTRY_RULES } from './rules.js';

const context = { from: '10.76.2', to: '11.7.0', includeDeprecated: true };

/** What the pack does at one site: the rewritten text, or why it declined. */
function at(pack: typeof sentryNextjsPack, file: string, text: string, rule: string, near: string) {
  const line = text.split('\n').findIndex((l) => l.includes(near)) + 1;
  const finding = fixtureFinding(
    pack,
    { case: 'unit', file, line, rule, keep: false, at: near },
    text,
  );
  return pack.transform(text, finding, context);
}

describe('mechanical rules decline what is not safe whatever the code around it', () => {
  it('keeps a withSentryConfig import that also takes runtime exports assisted', () => {
    const text = "import { withSentryConfig, captureException } from '@sentry/nextjs';\n";
    const out = at(
      sentryNextjsPack,
      'next.config.mjs',
      text,
      'with-sentry-config-import',
      'withSentryConfig',
    );
    expect(out).toMatchObject({ applied: false, text });
    expect(out.reason).toMatch(/split it/);
  });

  it.each([
    ['false', 'enableLogs: false'],
    ['dynamic', "enableLogs: process.env.LOGS === '1'"],
  ])(
    'leaves a %s enableLogs to a decision: v11 has no switch to keep logs off',
    (_case, option) => {
      const text = `import * as Sentry from '@sentry/node';\nSentry.init({ dsn: 'x', ${option} });\n`;
      expect(at(sentryNodePack, 'instrument.ts', text, 'enable-logs', 'enableLogs')).toMatchObject({
        applied: false,
        text,
      });
    },
  );

  it('never rewrites sendDefaultPii: the data collected is a decision', () => {
    expect(SENTRY_RULES.find((r) => r.id === 'send-default-pii')?.rewrite).toBeUndefined();
  });

  it('declines a build option whose destination is already set', () => {
    const text = [
      "const { withSentryConfig } = require('@sentry/nextjs');",
      'module.exports = withSentryConfig({}, {',
      '  disableLogger: true,',
      '  webpack: { treeshake: { removeDebugLogging: false } },',
      '});',
      '',
    ].join('\n');
    expect(
      at(sentryNextjsPack, 'next.config.js', text, 'build-options', 'disableLogger'),
    ).toMatchObject({
      applied: false,
      text,
    });
  });

  it('declines an inverted or removed build option', () => {
    const text = [
      "import { withSentryConfig } from '@sentry/nextjs';",
      'export default withSentryConfig({}, {',
      '  disableManifestInjection: true,',
      "  unstable_sentryWebpackPluginOptions: { applicationKey: 'app' },",
      '});',
      '',
    ].join('\n');
    for (const near of ['disableManifestInjection', 'unstable_sentryWebpackPluginOptions'])
      expect(at(sentryNextjsPack, 'next.config.mjs', text, 'build-options', near)).toMatchObject({
        applied: false,
      });
  });

  it('declines a rename that would collide with a local declaration', () => {
    const text = [
      "import { inboundFiltersIntegration } from '@sentry/browser';",
      'const eventFiltersIntegration = () => null;',
      'export const filters = inboundFiltersIntegration();',
      '',
    ].join('\n');
    expect(
      at(sentryBrowserPack, 'main.ts', text, 'renamed-exports', 'inboundFiltersIntegration()'),
    ).toMatchObject({ applied: false, text });
  });

  it('keeps otlpIntegration assisted: it lost its options and its exporter', () => {
    const text =
      "import { otlpIntegration } from '@sentry/node';\nexport const i = otlpIntegration();\n";
    expect(
      at(sentryNodePack, 'main.ts', text, 'renamed-exports', 'otlpIntegration()'),
    ).toMatchObject({
      applied: false,
    });
  });

  it('leaves the deprecated, no-op status-code filter to a decision', () => {
    const text = [
      "import * as Sentry from '@sentry/node';",
      'Sentry.httpIntegration({ dropSpansForIncomingRequestStatusCodes: [404] });',
      '',
    ].join('\n');
    expect(
      at(
        sentryNodePack,
        'main.ts',
        text,
        'http-integration-options',
        'dropSpansForIncomingRequestStatusCodes',
      ),
    ).toMatchObject({ applied: false, text });
  });
});

describe('compiler-blind detection', () => {
  const sites = (pack: typeof sentryNextjsPack, file: string, text: string) =>
    detectIn(pack, file, text).map((s) => `${s.rule}:${s.line}`);

  it('finds v10 span fields read through any in a beforeSendSpan declared apart', () => {
    const text = [
      "import * as Sentry from '@sentry/browser';",
      'const scrub = (span: any) => {',
      '  const { description } = span;',
      "  span.data['db.statement'] = '';",
      '  return span;',
      '};',
      'Sentry.init({ beforeSendSpan: scrub });',
      '',
    ].join('\n');
    expect(sites(sentryBrowserPack, 'sentry.ts', text)).toEqual([
      'span-json-format:3',
      'span-json-format:4',
    ]);
  });

  it("keeps beforeSendTransaction and ignoreTransactions where traceLifecycle: 'static' is set", () => {
    const init = (extra: string) =>
      [
        "import * as Sentry from '@sentry/browser';",
        `Sentry.init({ ${extra}beforeSendTransaction: (e) => e, ignoreTransactions: ['x'] });`,
        '',
      ].join('\n');
    expect(sites(sentryBrowserPack, 'sentry.ts', init(''))).toEqual([
      'ignore-transactions:2',
      'before-send-transaction:2',
    ]);
    expect(sites(sentryBrowserPack, 'sentry.ts', init("traceLifecycle: 'static', "))).toEqual([]);
  });

  it('ignores the same reads on objects that are not Sentry spans', () => {
    const text = [
      "import * as Sentry from '@sentry/browser';",
      'const scrub = (span: any) => span.description;',
      'Sentry.init({ beforeSend: (event) => event });',
      'export const label = scrub({ description: 1 });',
      '',
    ].join('\n');
    expect(sites(sentryBrowserPack, 'sentry.ts', text)).toEqual([]);
  });

  it('finds a sendFeedback rejection handled as a string, not one read through .message', () => {
    const text = [
      "import { sendFeedback } from '@sentry/react';",
      'export async function send(message: string, log: (s: string) => void) {',
      '  try {',
      '    await sendFeedback({ message });',
      '  } catch (e) {',
      '    if (e instanceof Error) log(e.message);',
      "    else log('failed: ' + e);",
      '  }',
      '}',
      '',
    ].join('\n');
    expect(sites(sentryReactPack, 'feedback.ts', text)).toEqual(['feedback-rejection:7']);
  });

  it('finds removed packages and preload flags, only when they are Sentry', () => {
    expect(
      sites(
        sentryNodePack,
        'src/types.ts',
        "import type { Event } from '@sentry/types';\nimport type { X } from 'types';\n",
      ),
    ).toEqual(['removed-modules:1']);
    const manifest = JSON.stringify(
      {
        scripts: {
          start: 'node -r ./instrument.js app.js',
          dotenv: 'node -r dotenv/config app.js',
          loader: 'node --import @sentry/node/loader app.js',
        },
      },
      null,
      2,
    );
    expect(sites(sentryNodePack, 'package.json', manifest)).toEqual([
      'require-preload:3',
      'require-preload:5',
    ]);
  });
});

describe('decisions are scoped to evidence in the repository', () => {
  const decisions = (pack: typeof sentryNextjsPack, inventory: Record<string, string>) =>
    packDecisions(
      pack,
      { ...context, inventory: Object.entries(inventory).map(([file, text]) => ({ file, text })) },
      [],
    );

  it('names the init files that leave dataCollection, tracing and stack traces to the new defaults', () => {
    const lines = decisions(sentryNextjsPack, {
      'sentry.server.config.ts':
        "import * as Sentry from '@sentry/nextjs';\nSentry.init({ dsn: 'x', tracesSampleRate: 0.1, tracesSampler: () => 1 });\n",
      'package.json': JSON.stringify({ dependencies: { next: '15.5.0' } }),
    });
    const text = lines.join('\n');
    expect(text).toContain('`sentry.server.config.ts` call Sentry.init without dataCollection');
    expect(text).toContain('`sentry.server.config.ts` enable tracing');
    expect(text).toContain('set tracesSampler or ignoreSpans');
    expect(text).toContain('leave attachStacktrace unset');
    expect(text).toContain('leave environment unset');
    expect(text).not.toContain('tunnelRoute');
    expect(text).not.toContain('declares typescript');
  });

  // UPT-121: lion-reader's test asserted v10's dataCollection default; v11 changed it.
  it('names a test that asserts a changed default it leaves unset, for the owner to decide', () => {
    const lines = decisions(sentryNextjsPack, {
      'src/server/sentry.ts':
        "import * as Sentry from '@sentry/nextjs';\nSentry.init({ dsn: 'x', attachStacktrace: false });\n",
      'tests/unit/posture.test.ts': [
        "import * as Sentry from '@sentry/nextjs';",
        "it('is conservative', () => {",
        "  Sentry.init({ dsn: 'x', enabled: false });",
        '  expect(Sentry.getClient()?.getDataCollectionOptions()).toMatchObject({ userInfo: false });',
        '});',
      ].join('\n'),
      'tests/unit/other.test.ts':
        "import * as Sentry from '@sentry/nextjs';\nSentry.init({ dsn: 'x' });\nexpect(1).toBe(1);\n",
    });
    const pinned = lines.filter((l) => l.includes('pins @sentry/nextjs'));
    expect(pinned).toEqual([
      expect.stringContaining(
        '`tests/unit/posture.test.ts` asserts dataCollection without setting it',
      ),
    ]);
    expect(pinned[0]).toContain('Uptide leaves the test as it is');
  });

  it('drops a decision the repository already made', () => {
    const lines = decisions(sentryBrowserPack, {
      'src/sentry.ts':
        "import * as Sentry from '@sentry/browser';\nSentry.init({ dsn: 'x', dataCollection: { userInfo: false }, attachStacktrace: false, tracesSampleRate: 0 });\n",
    });
    const text = lines.join('\n');
    expect(text).not.toContain('without dataCollection');
    expect(text).not.toContain('attachStacktrace unset');
    expect(text).not.toContain('enable tracing');
    expect(text).toContain('initialize the browser SDK');
  });

  it('reports platform minimums only when a manifest falls below them', () => {
    const below = decisions(sentryNodePack, {
      'package.json': JSON.stringify({
        engines: { node: '>=18' },
        devDependencies: { typescript: '4.9.5' },
      }),
      '.nvmrc': '20.11.1\n',
    }).join('\n');
    expect(below).toContain('engines.node is >=18');
    expect(below).toContain('pins Node 20.11.1');
    expect(below).toContain('declares typescript 4.9.5');
    const above = decisions(sentryNodePack, {
      'package.json': JSON.stringify({
        engines: { node: '>=20.19.0' },
        devDependencies: { typescript: '5.9.3' },
      }),
    }).join('\n');
    expect(above).not.toContain('needs');
  });

  it('flags tunnelRoute only next to a middleware or proxy file', () => {
    const config =
      "import { withSentryConfig } from '@sentry/nextjs/config';\nexport default withSentryConfig({}, { tunnelRoute: true });\n";
    expect(decisions(sentryNextjsPack, { 'next.config.mjs': config }).join('\n')).not.toContain(
      'tunnelRoute',
    );
    expect(
      decisions(sentryNextjsPack, { 'next.config.mjs': config, 'middleware.ts': 'export {}' }).join(
        '\n',
      ),
    ).toContain('set tunnelRoute and `middleware.ts` exists');
  });
});

describe('the release group and the leads', () => {
  it('moves every lockstep package with the lead, and nothing versioned on its own', () => {
    for (const pack of [sentryNextjsPack, sentryNodePack, sentryReactPack, sentryBrowserPack]) {
      const names = (pack.releaseGroup ?? []).map((c) => c.name);
      expect(names).not.toContain(pack.name);
      expect(names.length).toBe(LOCKSTEP.length - 1);
      for (const independent of [
        '@sentry/types',
        '@sentry/node-core',
        '@sentry/utils',
        '@sentry/cli',
        '@sentry/vite-plugin',
        '@sentry/webpack-plugin',
        '@sentry/bundler-plugins',
      ])
        expect(names).not.toContain(independent);
    }
  });

  it('gives each SDK only the rules for what it exports', () => {
    const ids = (pack: typeof sentryNextjsPack) => pack.rules.map((r) => r.id);
    expect(ids(sentryNextjsPack)).toContain('with-sentry-config-import');
    expect(ids(sentryNodePack)).not.toContain('with-sentry-config-import');
    expect(ids(sentryNodePack)).toContain('http-integration-options');
    expect(ids(sentryReactPack)).not.toContain('http-integration-options');
    expect(ids(sentryBrowserPack)).toContain('feedback-rejection');
    expect(sentryNextjsPack.requiresBuild).toBe(true);
    expect(sentryNodePack.requiresBuild).toBeUndefined();
  });

  it('asks for the choice in decisions wherever a guide offers options', () => {
    for (const rule of SENTRY_RULES.filter((r) => /\boptions(?::| are)/i.test(r.guide)))
      expect(rule.guide, rule.id).toMatch(/decisions/);
  });
});

describe('scripts that never import the pack package (UPT-89)', () => {
  it('reads a JS file outside the tsconfig include that only requires @sentry/core', () => {
    const root = mkdtempSync(join(tmpdir(), 'uptide-sentry-'));
    try {
      const write = (file: string, text: string) => {
        mkdirSync(join(root, 'bridge', file, '..'), { recursive: true });
        writeFileSync(join(root, 'bridge', file), text);
      };
      write('tsconfig.json', '{ "include": ["src"] }');
      write(
        'test.js',
        'const { spanToStreamedSpanJSON } = require("@sentry/core");\nspanToStreamedSpanJSON(span);\n',
      );
      write(
        'dist/bundle.js',
        'const { spanToStreamedSpanJSON } = require("@sentry/core");\nspanToStreamedSpanJSON(span);\n',
      );
      write('other.js', 'const spanToStreamedSpanJSON = 1;\n');
      const findings =
        sentryBrowserPack.runtimeFindings?.({
          root,
          workspace: 'bridge',
          from: '10.75.2',
          to: '11.5.0',
          installedDir: '',
          targetDir: '',
          usages: [],
          files: packInventory(root, 'bridge', sentryBrowserPack.inventory),
          read: (file) => {
            try {
              return readFileSync(join(root, file), 'utf8');
            } catch {
              return undefined;
            }
          },
        }) ?? [];
      expect(findings.map((f) => `${f.usage.file}:${f.usage.line}:${f.rule}`)).toEqual([
        'test.js:2:renamed-exports',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
