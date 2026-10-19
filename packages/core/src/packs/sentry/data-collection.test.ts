import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { recordDecisions, recordKept, recordPrompt, recordSites } from '../records.js';
import { sentryNextjsPack } from '../sentry-nextjs/index.js';
import { dataCollectionSites } from './data-collection.js';

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'uptide-sentry-dc-'));
  dirs.push(root);
  const all = {
    'tsconfig.json': JSON.stringify({
      compilerOptions: { strict: true },
      include: ['src', 'tests'],
    }),
    ...files,
  };
  for (const [file, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}
const sites = (root: string, phase: 'before' | 'after') =>
  dataCollectionSites({ root, workspace: '.', phase }).map((s) => `${s.file}:${s.line}`);

// brendanlong/lion-reader at 57c03c32, cut down: two inits, sendDefaultPii unset (v10 restrictive).
const client = (options: string) => `import { init } from "@sentry/nextjs";
${options.includes('SENTRY_DATA_COLLECTION') ? 'import { SENTRY_DATA_COLLECTION } from "./data-collection";\n' : ''}export function initSentry(dsn: string): void {
  init({
    dsn,
    enabled: process.env.NODE_ENV === "production",${options}
  });
}
`;
const server = `import * as Sentry from "@sentry/nextjs";
export function initSentry(): void {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
  });
}
`;
const test = `import * as Sentry from "@sentry/nextjs";
Sentry.init({ dsn: "https://examplePublicKey@o0.ingest.sentry.io/0" });
`;
const BASELINE = `const KEYS = ["forwarded", "-ip", "remote-", "via", "-user"];
export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: { deny: KEYS }, response: { deny: KEYS } },
  httpBodies: [],
  urlQueryParams: { deny: [...KEYS] },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  graphQL: { document: false, variables: false },
  frameContextLines: 7,
};
`;

describe('sentry data-collection record (UPT-123)', () => {
  const before = {
    'src/lib/sentry/client-sdk.ts': client(''),
    'src/server/sentry.ts': server,
    'tests/unit/sentry.test.ts': test,
  };

  it('finds every init that leaves dataCollection unset with sendDefaultPii unset, not a test init', () => {
    expect(sites(repo(before), 'before')).toEqual([
      'src/lib/sentry/client-sdk.ts:3',
      'src/server/sentry.ts:3',
    ]);
  });

  it("keeps an init open after a partial edit: the agent's cookie deny list and v11 defaults left on", () => {
    // Run 3caac4a1's edit: a deny list collects every cookie it does not name, session cookies included.
    const partial = `
    dataCollection: {
      userInfo: false,
      cookies: { deny: ["-ip", "forwarded"] },
      httpHeaders: { request: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] }, response: false },
      httpBodies: [],
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
    },`;
    const root = repo({ ...before, 'src/lib/sentry/client-sdk.ts': client(partial) });
    expect(sites(root, 'after')).toEqual([
      'src/lib/sentry/client-sdk.ts:3',
      'src/server/sentry.ts:3',
    ]);
  });

  it('counts the exact edit as kept, through an imported const and an options function, and only with frameContextLines: 7', () => {
    const files = (baseline: string) => ({
      ...before,
      'src/lib/sentry/data-collection.ts': baseline,
      'src/lib/sentry/client-sdk.ts': client('\n    dataCollection: SENTRY_DATA_COLLECTION,'),
      'src/server/sentry.ts': `import * as Sentry from "@sentry/nextjs";
import { SENTRY_DATA_COLLECTION } from "../lib/sentry/data-collection";
export function initSentry(): void {
  Sentry.init(serverSentryOptions(process.env.SENTRY_DSN ?? ""));
}
export function serverSentryOptions(dsn: string) {
  return { dsn, dataCollection: SENTRY_DATA_COLLECTION };
}
`,
    });
    expect(sites(repo(files(BASELINE)), 'after')).toEqual([]);
    // The human's lion-reader edit, the guide's block as printed: v11's five context lines, not v10's seven.
    const guideBlock = BASELINE.replace('  frameContextLines: 7,\n', '');
    expect(sites(repo(files(guideBlock)), 'after')).toEqual([
      'src/lib/sentry/client-sdk.ts:4',
      'src/server/sentry.ts:7',
    ]);
  });

  it('is no site where v10 already collected, the owner chose, nothing is sent or the options are hidden', () => {
    const root = repo({
      'src/a.ts': `import * as Sentry from "@sentry/node";
Sentry.init({ dsn: "x", sendDefaultPii: true });
Sentry.init({ dsn: "x", dataCollection: { userInfo: true } });
Sentry.init({ dsn: "x", enabled: false });
export function start(config: Sentry.NodeOptions) {
  Sentry.init({ ...config, tracesSampleRate: 0 });
}
`,
    });
    expect(sites(root, 'before')).toEqual([]);
  });

  it("follows a lazily imported SDK's init and a spread whose type cannot set dataCollection", () => {
    // preijm/milk-me-not and destinationparadise import the SDK on demand; youth-activity-scheduler
    // spreads its own config type before sendDefaultPii: false.
    const root = repo({
      'node_modules/@sentry/react/package.json': JSON.stringify({
        name: '@sentry/react',
        types: 'index.d.ts',
      }),
      'node_modules/@sentry/react/index.d.ts': `export interface BrowserOptions { dsn?: string; sendDefaultPii?: boolean; dataCollection?: object }
export declare function init(options: BrowserOptions): void;
`,
      'src/lazy.ts': `export function start(dsn: string) {
  return import("@sentry/react").then((sentry) => {
    sentry.init({ dsn, sendDefaultPii: false });
  });
}
export function other(dsn: string) {
  return import("@sentry/react").then(({ init }) => init({ dsn }));
}
`,
      'src/config.ts': `import * as Sentry from "@sentry/react";
type SentryConfig = { dsn: string; environment: string };
export function initSentry(config: SentryConfig) {
  Sentry.init({ ...config, sendDefaultPii: false });
}
export function initWith(config: Sentry.BrowserOptions) {
  Sentry.init({ ...config, tracesSampleRate: 0 });
}
`,
    });
    expect(sites(root, 'before')).toEqual(['src/config.ts:4', 'src/lazy.ts:3', 'src/lazy.ts:7']);
  });

  it('replaces an explicit sendDefaultPii: false, and leaves a computed one as a decision', () => {
    const root = repo({
      'src/a.ts': `import * as Sentry from "@sentry/browser";
Sentry.init({ dsn: "x", sendDefaultPii: false });
Sentry.init({ dsn: "x", sendDefaultPii: process.env.PII === "1" });
// getsentry/sentry-godot's bridge: a conditional spread hides no option.
export function start({ dsn, orgId, sendDefaultPii }: { dsn: string; orgId?: string; sendDefaultPii: boolean }) {
  Sentry.init({ dsn, ...(orgId && { orgId }), sendDefaultPii });
}
`,
    });
    const found = dataCollectionSites({ root, workspace: '.', phase: 'before' });
    expect(found).toMatchObject([
      { line: 2, edit: expect.stringContaining('replace sendDefaultPii: false') },
      {
        line: 3,
        decision: true,
        decisionReason: expect.stringContaining('sendDefaultPii is computed'),
      },
      { line: 6, decision: true },
    ]);
  });

  it('tells the agent the exact baseline, and the PR body says the partial edit was not applied', () => {
    const records = sentryNextjsPack.records ?? [];
    expect(records.map((r) => r.id)).toEqual(['@sentry/nextjs/data-collection-defaults']);
    const root = repo(before);
    const found = recordSites(records, { root, workspace: '.', phase: 'before' });
    const prompt = recordPrompt(records, found).join('\n');
    expect(prompt).toContain(
      "cookies: false, httpHeaders: { request: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] }",
    );
    expect(prompt).toContain(
      'queues: false, graphQL: { document: false, variables: false }, frameContextLines: 7 }',
    );
    expect(prompt).toContain('"frameContextLines?: number;"');
    expect(prompt).toContain('never a partial deny list');
    expect(prompt).toContain('"// v11 — preserves the v10 default"');

    const open = found.map((s) => ({ ...s, kept: false }));
    const decisions = recordDecisions(records, open).join('\n');
    expect(decisions).toContain('Behavior change (@sentry/nextjs/data-collection-defaults)');
    expect(decisions).toContain(
      'Not applied at `src/lib/sentry/client-sdk.ts:3`, `src/server/sentry.ts:3`',
    );
    expect(recordKept(records, open)).toEqual([]);
    expect(
      recordKept(
        records,
        found.map((s) => ({ ...s, kept: true })),
      )[0],
    ).toContain('**Kept (@sentry/nextjs/data-collection-defaults):**');
  });
});
