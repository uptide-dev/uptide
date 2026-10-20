import { describe, expect, it } from 'vitest';
import { formatFixSummary } from './format-fix.js';
import { fixReport } from './test-utils.js';

describe('formatFixSummary', () => {
  it('shows allowed and unallowed peer risks with their declared ranges', () => {
    const out = formatFixSummary({
      ...fixReport(true),
      peerConflicts: [
        {
          name: 'plugin',
          version: '1.0.0',
          peers: [
            { peer: 'react', range: '^18', target: '19.0.0', version: '1.0.0' },
            { peer: 'react-dom', range: '^18', target: '19.0.0', version: '1.0.0' },
          ],
          allowed: true,
        },
        {
          name: 'other',
          version: '1.0.0',
          peers: [{ peer: 'react', range: '^18', target: '19.0.0', version: '1.0.0' }],
          allowed: false,
        },
      ],
    });
    expect(out).toContain('Peer risks');
    expect(out).toContain(
      'plugin 1.0.0: react ^18 rejects 19.0.0; react-dom ^18 rejects 19.0.0 · explicitly allowed in package.json',
    );
    expect(out.split('\n').filter((line) => line.trim().startsWith('plugin '))).toHaveLength(1);
    expect(out).toContain('other 1.0.0: react ^18 rejects 19.0.0');
  });

  it('shows the agent-led fallback, its rounds and spend, and out-of-scope lockfile changes', () => {
    const base = fixReport(false);
    const out = formatFixSummary(
      {
        ...base,
        agentFallback: ['Install check: 1 lockfile resolution changed'],
        llm: {
          ...base.llm,
          costUsd: 0.42,
          feedback: { roundsUsed: 2, maxRounds: 3, maxCostUsd: 1 },
        },
        lockfile: {
          manager: 'pnpm',
          file: 'pnpm-lock.yaml',
          added: [],
          removed: [],
          changed: [],
          allowed: [],
          outOfScope: [{ name: 'picomatch', from: '4.0.2', to: '4.0.3' }],
        },
      },
      { color: false },
    );
    expect(out).toContain(
      '  Fallback  agent-led draft: Install check: 1 lockfile resolution changed',
    );
    expect(out).toContain('  Feedback  2/3 rounds · $0.42 of $1.00');
    expect(out).toContain(
      'Lockfile changes outside the upgrade: review\n  picomatch 4.0.2 → 4.0.3',
    );
  });

  it('says the five facts, where the branch is, and the exact next commands', () => {
    const report = {
      ...fixReport(true),
      from: '14.25.0',
      target: '23.0.0',
      package: 'stripe',
      branch: 'uptide/stripe-23.0.0',
      targetSource: 'latest on npm' as const,
      timingMs: 517_000,
      source: '/home/me/acme-app',
      base: 'main',
      remote: 'https://github.com/me/acme-app',
      prBody: '/home/me/acme-app/.git/uptide/uptide__stripe-23.0.0/pr-body.md',
      html: '/home/me/acme-app/.git/uptide/uptide__stripe-23.0.0/report.html',
    };
    const out = formatFixSummary(report, {
      color: false,
      invocation: 'uptide',
      cwd: '/home/me/acme-app',
    });
    expect(out).toMatchSnapshot();
  });

  it('points a failed run at verify, and a published one at its PR', () => {
    const failed = formatFixSummary(
      { ...fixReport(false), branch: 'uptide/zod-4.6.5' },
      { color: false },
    );
    expect(failed).toContain('verification failed');
    expect(failed).toContain('uptide verify --branch uptide/zod-4.6.5');
    expect(failed).not.toContain(' pr --branch');
    const published = formatFixSummary(
      { ...fixReport(true), prUrl: 'https://github.com/o/r/pull/9' },
      { color: false },
    );
    // Aligned with the other next steps, whose longest entry sets the padding.
    expect(published).toMatch(/https:\/\/github\.com\/o\/r\/pull\/9 +the pull request/);
  });
});

it('summarizes lockfile housekeeping without expanding placements in the terminal', () => {
  const report = fixReport(true);
  report.lockfile = {
    manager: 'npm',
    file: 'package-lock.json',
    added: [],
    removed: [],
    changed: [],
    allowed: [],
    housekeeping: {
      deduped: [
        {
          from: 'node_modules/a/node_modules/b',
          to: 'node_modules/b',
          name: 'b',
          version: '1.0.0',
        },
      ],
      metadata: [],
    },
  };
  const out = formatFixSummary(report, { color: false });
  expect(out).toContain('Lockfile housekeeping · 1 dedupe move · 0 metadata-only changes');
  expect(out).not.toContain('node_modules/');
});

it('lists packages re-resolved because a peer changed', () => {
  const report = fixReport(true);
  report.lockfile = {
    manager: 'npm',
    file: 'package-lock.json',
    added: [],
    removed: [],
    changed: [],
    allowed: [],
    peerReresolved: [
      {
        name: 'plugin',
        from: '1.1.0',
        to: '1.2.0',
        peers: ['react'],
        ranges: { '. (dependencies)': '^1' },
        records: ['node_modules/plugin'],
      },
    ],
  };
  const out = formatFixSummary(report, { color: false });
  expect(out).toContain('Re-resolved because a peer changed');
  expect(out).toContain('plugin 1.1.0 → 1.2.0 · peers react');
});

it('says which ERESOLVE retry resolved the lockfile', () => {
  const report = fixReport(true);
  report.lockfile = {
    manager: 'npm',
    file: 'package-lock.json',
    added: [],
    removed: [],
    changed: [],
    allowed: [],
    eresolveRetry: { step: 'moved entries', dropped: ['toggle', 'ui'], conflicts: [] },
  };
  expect(formatFixSummary(report, { color: false })).toContain(
    "Lockfile re-resolved\n  npm's lock-only install hit ERESOLVE from the old lockfile; it resolved without the lockfile entries of toggle, ui\n",
  );
});

it('names an imported undeclared package the re-resolve kept or dropped (UPT-109)', () => {
  const report = fixReport(true);
  report.lockfile = {
    manager: 'npm',
    file: 'package-lock.json',
    added: [],
    removed: [],
    changed: [],
    allowed: [],
    undeclared: [
      { name: 'picker-types', version: '1.0.0', kept: true },
      { name: 'old-types', version: '2.1.0', kept: false },
    ],
  };
  const out = formatFixSummary(report, { color: false });
  expect(out).toContain(
    'Imported but not declared\n  picker-types 1.0.0 is imported by the repo but not declared in package.json. The re-resolve would have dropped it; it was kept at 1.0.0. Add it to package.json.\n',
  );
  expect(out).toContain(
    'old-types 2.1.0 is imported by the repo but not declared in package.json. The new lockfile no longer has it, so those imports fail. Add it to package.json.',
  );
});

it('names a resolved version that differs from the target (UPT-124)', () => {
  const report = fixReport(true);
  report.lockfile = {
    manager: 'yarn-classic',
    file: 'yarn.lock',
    added: [],
    removed: [],
    changed: [],
    allowed: [],
    resolved: [{ name: 'zod', requested: '4.1.0', version: '4.1.3' }],
  };
  expect(formatFixSummary(report, { color: false })).toContain(
    'Resolved version differs from the target\n  zod: asked for 4.1.0; the package manager resolved 4.1.3',
  );
});

it('lists transitive changes under the package that moved them, two at a time', () => {
  const report = fixReport(true);
  report.lockfile = {
    manager: 'yarn-berry',
    file: 'yarn.lock',
    added: [],
    removed: [],
    changed: [],
    allowed: [],
    transitive: [
      {
        name: 'cmdk',
        from: ['0.2.1'],
        to: ['1.0.1'],
        changes: [
          { name: '@radix-ui/primitive', from: '1.0.0', to: '1.1.1' },
          { name: '@radix-ui/react-dialog', from: '1.0.0', to: '1.2.0' },
          { name: 'use-sync-external-store', to: '1.5.0' },
        ],
      },
    ],
  };
  const out = formatFixSummary(report, { color: false });
  expect(out).toContain('Moved with the upgraded packages');
  expect(out).toContain(
    'cmdk 0.2.1 → 1.0.1 replaced @radix-ui/primitive 1.0.0 with 1.1.1, replaced @radix-ui/react-dialog 1.0.0 with 1.2.0, and 1 more (in the report)',
  );
});

it('uses the committed diff count instead of counting diagnostic-only files as changed', () => {
  const report = {
    ...fixReport(true),
    changedFiles: ['package.json', 'package-lock.json', 'props.ts'],
  };
  expect(formatFixSummary(report, { color: false })).toContain('3 changed files');
});

it('explains the numbered export and points pr at the new branch', () => {
  const report = {
    ...fixReport(true),
    branch: 'uptide/zod-4.6.5-2',
    branchRenamedFrom: 'uptide/zod-4.6.5',
  };
  const text = formatFixSummary(report, { color: false });
  expect(text).toContain(
    'uptide/zod-4.6.5 already exists with different content; created uptide/zod-4.6.5-2.',
  );
  expect(text).toContain('uptide pr --branch uptide/zod-4.6.5-2');
});

it('names the coverage the check behind the run gave up to the memory cap', () => {
  const report = {
    ...fixReport(true),
    importersNotAnalyzed: [
      {
        workspace: 'apps/web',
        files: ['apps/web/src/heavy.test.ts', 'apps/web/src/sdk.ts'],
        message: '2 importing files not analyzed (memory cap); findings in them may be missed',
      },
    ],
  };
  expect(formatFixSummary(report, { color: false })).toContain(
    '  Coverage  apps/web: 2 importing files not analyzed (memory cap); findings in them may be missed',
  );
  expect(formatFixSummary(fixReport(true), { color: false })).not.toContain('Coverage');
});

it('says an unhealthy baseline first, and "no new errors" instead of passed', () => {
  const report = fixReport(true);
  report.verification.baseline = [
    { file: 'a.ts', line: 1, column: 1, code: 2307, message: "Cannot find module '@/ee/x'." },
  ];
  const out = formatFixSummary(report, { color: false }).split('\n');
  expect(out[0]).toContain('· no new errors ·');
  expect(out[2]).toBe(
    '⚠ this repository does not type-check before the upgrade (1 error, 1 from missing modules: 1 under @/ee/); verification can only compare, not prove',
  );
  // A healthy baseline: the strict words, no warning.
  const healthy = formatFixSummary(fixReport(true), { color: false });
  expect(healthy).toContain('· verification passed ·');
  expect(healthy).not.toContain('does not type-check');
});

it('diffs from the captured commit even when the starting branch moves', () => {
  const report = { ...fixReport(true), base: 'demo-base', baseHead: 'a'.repeat(40) };
  expect(formatFixSummary(report, { color: false })).toContain(
    `git diff ${report.baseHead}..${report.branch} --stat`,
  );
});

it('marks a companion major that needs its own migration (UPT-10)', () => {
  const report = fixReport(true);
  report.companions = [
    {
      name: 'plugin',
      from: '1.0.0',
      to: '2.0.0',
      reason: 'explicit peer upgrade',
      migration: 'own',
    },
  ];
  expect(formatFixSummary(report, { color: false })).toContain(
    'needs its own migration: plugin 1.0.0 → 2.0.0 (major, no pack)',
  );
});
