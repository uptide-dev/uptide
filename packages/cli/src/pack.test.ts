import { type PackTestReport, registeredPacks, unfinishedPack } from '@uptide/core';
import { expect, it } from 'vitest';
import { formatPackTest, packTestSummary, SUMMARY_LIST_LIMIT, SUMMARY_MAX_BYTES } from './pack.js';

it('prints behavior notes on their own row, n/a where nothing was predicted, and each miss with its severity', () => {
  const entry = registeredPacks()[0];
  if (!entry) throw new Error('no registered pack');
  const tally = (tp: number, fp: number, fn: number) => ({
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    precision: tp + fp ? tp / (tp + fp) : 1,
    recall: tp + fn ? tp / (tp + fn) : 1,
  });
  const site = (line: number, rule: string, severity: 'breaking' | 'deprecated') => ({
    file: 'src/client.ts',
    line,
    rule,
    severity,
  });
  const report: PackTestReport = {
    ...unfinishedPack(entry, ''),
    problems: [],
    repos: [
      {
        label: 'owner/name',
        from: '5.0.0',
        to: '6.0.0',
        predicted: [site(13, 'client-defaults', 'deprecated')],
        expected: [
          site(9, 'client-defaults', 'deprecated'),
          site(20, 'handshake-auth', 'breaking'),
        ],
        falsePositives: [site(13, 'client-defaults', 'deprecated')],
        falseNegatives: [
          site(9, 'client-defaults', 'deprecated'),
          site(20, 'handshake-auth', 'breaking'),
        ],
        wrongRule: [],
      },
    ],
    overall: tally(0, 1, 2),
    breaking: tally(0, 0, 1),
    behavior: tally(0, 1, 2),
  };
  const out = formatPackTest(report);
  expect(out).toMatch(/behavior notes \(sites\)\s+0%\s+0%\s+0\s+1\s+2/);
  expect(out).toMatch(/breaking \(sites\)\s+n\/a\s+0%\s+0\s+0\s+1/);
  expect(out).toContain('src/client.ts:9  client-defaults (deprecated)');
  expect(out).toContain('src/client.ts:20  handshake-auth (breaking)');
});

it('fails a record that claims verified where the run measures candidate, and says so', () => {
  const entry = registeredPacks()[0];
  if (!entry) throw new Error('no registered pack');
  const base = { ...unfinishedPack(entry, ''), problems: [] };
  const over = formatPackTest({
    ...base,
    recorded: 'verified',
    status: 'candidate',
    overclaimed: true,
    stale: true,
  });
  expect(over).toContain('verification.json records verified; this run measures candidate');
  expect(over).toContain(`FAIL ${entry.pack.name}`);

  const under = formatPackTest({
    ...base,
    recorded: 'candidate',
    status: 'verified',
    stale: true,
    passed: true,
  });
  expect(under).toContain('recorded candidate by choice; measures verified');
  expect(under).not.toContain('✗');
  expect(under).toContain(`PASS ${entry.pack.name}: verified`);

  // Same status, different numbers: a note, not a failure.
  const drifted = formatPackTest({
    ...base,
    recorded: 'verified',
    status: 'verified',
    stale: true,
    passed: true,
  });
  expect(drifted).toContain('verification.json differs from this run');
  expect(drifted).not.toContain('✗');
});

it('prints what check plans in each repository: companions, required moves, stays, blockers and removals (UPT-62)', () => {
  const entry = registeredPacks()[0];
  if (!entry) throw new Error('no registered pack');
  const tally = { truePositives: 0, falsePositives: 0, falseNegatives: 0, precision: 1, recall: 1 };
  const out = formatPackTest({
    ...unfinishedPack(entry, ''),
    package: 'ioredis',
    problems: [],
    repos: [
      {
        label: 'owner/name',
        from: '4.28.5',
        to: '5.4.1',
        predicted: [],
        expected: [],
        falsePositives: [],
        falseNegatives: [],
        wrongRule: [],
        companions: [
          { name: 'ioredis-mock', from: '7.4.0', to: '8.9.0', reason: 'release group' },
          {
            name: 'denque',
            from: '1.5.1',
            to: '2.1.0',
            reason: 'ioredis 5.4.1 requires denque ^2.1.0',
            required: true,
          },
        ],
        stays: ['bull stays at 3.29.3 (versioned on its own)'],
        blockers: ['ioredis 5.4.1 needs node >=12.22; only a new major satisfies it'],
        removals: [
          { name: '@types/ioredis', from: '4.28.10', reason: 'ioredis 5 ships its own types' },
        ],
      },
    ],
    overall: tally,
    breaking: tally,
  });
  const repo = out.slice(out.indexOf('ground truth'), out.indexOf('\n\n'));
  expect(repo).toMatchSnapshot();
});

it('prints the precision of each rewrite and warns below the threshold without failing (UPT-65)', () => {
  const entry = registeredPacks()[0];
  if (!entry) throw new Error('no registered pack');
  const base = unfinishedPack(entry, '');
  const tally = { truePositives: 1, falsePositives: 0, falseNegatives: 0, precision: 1, recall: 1 };
  const out = formatPackTest({
    ...base,
    problems: [],
    status: 'verified',
    recorded: 'verified',
    passed: true,
    repos: [
      {
        label: 'owner/name',
        from: '6.0.0',
        to: '7.0.0',
        predicted: [],
        expected: [],
        falsePositives: [],
        falseNegatives: [],
        wrongRule: [],
      },
    ],
    overall: tally,
    breaking: tally,
    behavior: tally,
    gate: {
      ...base.gate,
      status: 'verified',
      reasons: [],
      lowPrecision: ['dom-imports'],
      mechanical: {
        'dom-imports': { truePositives: 29, falsePositives: 336 },
        rename: { truePositives: 4, falsePositives: 0 },
      },
    },
  });
  expect(out).toMatch(/dom-imports\s+8%\s+29\s+336 {2}! below \d+%/);
  expect(out).toMatch(/rename\s+100%\s+4\s+0\n/);
  expect(out).toContain('warning only: dom-imports below');
  expect(out).toContain(`PASS ${entry.pack.name}: verified`);
});

it("keeps the job summary under GitHub's 1 MiB with every list cut, and the full lists in the log", () => {
  const entry = registeredPacks()[0];
  if (!entry) throw new Error('no registered pack');
  const tally = {
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 6000,
    precision: 1,
    recall: 0,
  };
  const miss = (line: number) => ({
    file: `src/${'deep/'.repeat(8)}file.ts`,
    line,
    rule: 'generic',
  });
  const report = (n: number, misses = 6000): PackTestReport => ({
    ...unfinishedPack(entry, ''),
    package: `pack-${n}`,
    problems: [],
    repos: [
      {
        label: 'owner/a-long-repository-name@0123456789ab',
        from: '1.0.0',
        to: '2.0.0',
        predicted: [],
        expected: [],
        falsePositives: [],
        falseNegatives: Array.from({ length: misses }, (_, i) => miss(i + 1)),
        wrongRule: [],
      },
    ],
    overall: tally,
    breaking: tally,
  });
  const packs = Array.from({ length: 20 }, (_, n) => report(n));
  const MiB = 1024 * 1024;

  expect(packs.map((p) => formatPackTest(p)).join('').length).toBeGreaterThan(MiB);
  const summary = packTestSummary(packs, '\nAt least one pack failed.\n');
  expect(Buffer.byteLength(summary)).toBeLessThan(MiB);
  expect(summary).toContain('false negatives (6000)');
  expect(summary).toContain(`… and ${6000 - SUMMARY_LIST_LIMIT} more, see the job log`);
  expect(summary).toContain('breaking (sites)');
  expect(summary.endsWith('At least one pack failed.\n')).toBe(true);

  // So many packs that even the cut lists overflow: cut at a line, the fence closed.
  const many = packTestSummary(Array.from({ length: 2000 }, (_, n) => report(n, 30)));
  expect(Buffer.byteLength(many)).toBeLessThanOrEqual(SUMMARY_MAX_BYTES);
  expect(many).toMatch(/\n… cut here to fit the job summary, see the job log\n```\n$/);
});
