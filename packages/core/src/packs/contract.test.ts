import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Finding } from '../domain/report.js';
import {
  companionProblems,
  definePack,
  type GateEvidence,
  type GroundTruth,
  lowPrecisionRules,
  RULE_PRECISION_WARNING,
  recordedStatus,
  replaceAtSite,
  truthDigest,
  VERIFIED_MIN_BEHAVIOR_SITES,
  VERIFIED_MIN_BREAKING_SITES,
  verifiedGate,
} from './contract.js';
import { withUnexercised } from './fixability.js';
import { activePacks, registeredPacks, withCompanionPacks } from './index.js';
import { recordProblems } from './records.js';
import { runFixtures } from './tooling/fixtures.js';
import { scoreSites } from './tooling/pack-test.js';
import { parseRegistry, renderRegistry } from './tooling/registry-file.js';
import { truthProblems } from './tooling/truth.js';
import type { MigrationPack, PackContext } from './types.js';

const packsDir = fileURLToPath(new URL('.', import.meta.url));

describe('every registered pack meets the contract', () => {
  it('the registry file is exactly what pack new renders', () => {
    const text = readFileSync(join(packsDir, 'registry.ts'), 'utf8');
    expect(renderRegistry(parseRegistry(text))).toBe(text);
    expect(parseRegistry(text).map((e) => e.dir)).toEqual(registeredPacks().map((e) => e.dir));
  });

  it.each(registeredPacks().map((e) => [e.pack.name, e] as const))('%s', (_name, entry) => {
    const { pack } = entry;
    expect(pack.meta.package).toBe(pack.name);
    expect(pack.meta.maintainer).not.toBe('');
    expect(pack.meta.sources.length).toBeGreaterThan(0);
    for (const s of pack.meta.sources) expect(s.url).toMatch(/^https:\/\//);
    const ids = [...pack.rules.map((r) => r.id), ...pack.behavior.map((b) => b.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of pack.rules) {
      expect(rule.summary, rule.id).not.toBe('');
      expect(['breaking', 'deprecated']).toContain(rule.severity);
    }
    for (const note of pack.behavior) {
      expect(note.reported.length, note.id).toBeGreaterThan(0);
      // A note's findings come from its `detect`, or from the pack folding compiler errors into it.
      if (note.reported.includes('finding'))
        expect(note.detect ?? pack.foldFindings, note.id).toBeDefined();
    }
    expect(pack.instructions).not.toBe('');

    const dir = join(packsDir, entry.dir);
    // A behavior record's quote is verbatim in the page it cites, as read (ADR 0017).
    expect(recordProblems(pack.records ?? [], dir, pack.name)).toEqual([]);
    for (const record of pack.records ?? []) expect(ids, record.id).not.toContain(record.id);
    const fixtures = runFixtures(pack, dir);
    expect(fixtures.unknown).toEqual([]);
    expect(fixtures.rewriteFailures).toEqual([]);
    expect(fixtures.falsePositives).toEqual([]);
    expect(fixtures.falseNegatives).toEqual([]);

    const file = join(dir, 'ground-truth.json');
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, 'utf8');
    expect(truthProblems(JSON.parse(text) as GroundTruth, pack.name)).toEqual([]);
    // The status the CLI shows was measured on the ground truth as committed.
    if (entry.verification.status === 'verified')
      expect(entry.verification.truth).toBe(truthDigest(text));
  });

  it('every rule that rewrites or detects has a fixture site, and one it leaves alone', () => {
    for (const { pack, dir } of registeredPacks()) {
      const before = (c: string) =>
        readFileSync(join(packsDir, dir, 'fixtures', c, 'before.ts'), 'utf8');
      const cases = runFixtures(pack, join(packsDir, dir)).cases;
      const marked = cases.map(before).join('\n');
      for (const rule of pack.rules.filter((r) => r.rewrite || r.detect)) {
        expect(marked, `${pack.name} ${rule.id}`).toMatch(
          new RegExp(`@uptide ${rule.id}(?! keep)(?:\\s|$)`),
        );
        expect(marked, `${pack.name} ${rule.id} keep`).toContain(`@uptide ${rule.id} keep`);
      }
    }
  });

  it('check, list and fix use the verified packs only', () => {
    const verified = registeredPacks()
      .filter((e) => recordedStatus(e.verification) === 'verified')
      .map((e) => e.pack.name);
    expect(activePacks().map((p) => p.name)).toEqual(verified);
  });

  it('runs each active pack with the low-precision rules its record shows', () => {
    for (const pack of activePacks()) {
      const entry = registeredPacks().find((e) => e.pack.name === pack.name);
      expect(pack.lowPrecision ?? [], pack.name).toEqual(
        lowPrecisionRules(entry?.verification.mechanical),
      );
    }
  });

  it('runs each active pack with the unexercised rules its record lists', () => {
    for (const pack of activePacks()) {
      const entry = registeredPacks().find((e) => e.pack.name === pack.name);
      expect(pack.unexercised ?? [], pack.name).toEqual(entry?.verification.unexercised ?? []);
    }
  });
});

describe('the verified gate', () => {
  const evidence = (over: Partial<GateEvidence> = {}): GateEvidence => ({
    repos: 2,
    ruleSites: 5,
    breakingSites: 5,
    behaviorSites: 0,
    breaking: { truePositives: 4, falsePositives: 0 },
    behavior: { truePositives: 0, falsePositives: 0 },
    mechanical: { rename: { truePositives: 3, falsePositives: 0 } },
    ...over,
  });

  it('verifies two public repositories, five breaking sites, none falsely predicted, some found', () => {
    expect(verifiedGate(evidence())).toEqual({
      status: 'verified',
      class: 'breaking',
      reasons: [],
      unexercised: [],
      lowPrecision: [],
    });
  });

  it('needs two public repositories', () => {
    expect(verifiedGate(evidence({ repos: 1 })).reasons).toEqual([
      '1 public repository, verified needs 2',
    ]);
  });

  it('needs no false positive among breaking findings', () => {
    const gate = verifiedGate(evidence({ breaking: { truePositives: 4, falsePositives: 1 } }));
    expect(gate.status).toBe('candidate');
    expect(gate.reasons).toEqual(['1 false positive among breaking findings']);
  });

  it(`needs ${VERIFIED_MIN_BREAKING_SITES} breaking sites in public ground truth`, () => {
    expect(verifiedGate(evidence({ breakingSites: 4 })).reasons).toEqual([
      '4 breaking sites in public ground truth, verified needs 5',
    ]);
    expect(verifiedGate(evidence({ breakingSites: 1 })).status).toBe('candidate');
  });

  it("reads the pack's own breaking-site minimum", () => {
    expect(verifiedGate(evidence({ breakingSites: 3, minBreakingSites: 3 })).status).toBe(
      'verified',
    );
    expect(verifiedGate(evidence({ breakingSites: 2, minBreakingSites: 3 })).reasons).toEqual([
      '2 breaking sites in public ground truth, verified needs 3',
    ]);
  });

  it('needs a breaking site found', () => {
    expect(
      verifiedGate(evidence({ breaking: { truePositives: 0, falsePositives: 0 } })).reasons,
    ).toEqual(['no breaking site found']);
  });

  it('turns a mechanical rule no real site confirmed into assisted, without demoting the pack', () => {
    const gate = verifiedGate(
      evidence({
        mechanical: {
          rename: { truePositives: 3, falsePositives: 0 },
          json: { truePositives: 0, falsePositives: 0 },
          defer: { truePositives: 0, falsePositives: 0 },
        },
      }),
    );
    expect(gate.status).toBe('verified');
    expect(gate.unexercised).toEqual(['defer', 'json']);
  });

  it(`flags a mechanical rule below ${RULE_PRECISION_WARNING * 100}% precision, without demoting the pack`, () => {
    const gate = verifiedGate(
      evidence({
        mechanical: {
          rename: { truePositives: 3, falsePositives: 0 },
          imports: { truePositives: 29, falsePositives: 336 },
          quiet: { truePositives: 0, falsePositives: 0 },
          tiny: { truePositives: 1, falsePositives: 1 },
        },
      }),
    );
    expect(gate.status).toBe('verified');
    expect(gate.reasons).toEqual([]);
    expect(gate.lowPrecision).toEqual(['imports']);
    expect(gate.unexercised).toEqual(['quiet']);
  });

  describe("a behavior-only upgrade (every expected site a note's)", () => {
    const behavior = (over: Partial<GateEvidence> = {}): GateEvidence =>
      evidence({
        ruleSites: 0,
        breakingSites: 2,
        behaviorSites: 6,
        breaking: { truePositives: 0, falsePositives: 0 },
        behavior: { truePositives: 5, falsePositives: 0 },
        mechanical: {},
        ...over,
      });

    it('is verified on its notes: sites, no false positive, something found', () => {
      expect(verifiedGate(behavior())).toEqual({
        status: 'verified',
        class: 'behavior',
        reasons: [],
        unexercised: [],
        lowPrecision: [],
      });
    });

    it(`needs ${VERIFIED_MIN_BEHAVIOR_SITES} behavior-note sites and one found`, () => {
      expect(
        verifiedGate(
          behavior({ behaviorSites: 2, behavior: { truePositives: 0, falsePositives: 0 } }),
        ).reasons,
      ).toEqual([
        '2 behavior-note sites in public ground truth, verified needs 5',
        'no behavior-note site found',
      ]);
    });

    it('needs no false positive on a note or a mechanical rule', () => {
      const gate = verifiedGate(
        behavior({
          behavior: { truePositives: 5, falsePositives: 2 },
          mechanical: { 'pin-protocol': { truePositives: 1, falsePositives: 1 } },
        }),
      );
      expect(gate.class).toBe('behavior');
      expect(gate.reasons).toEqual([
        '2 false positives among behavior-note sites',
        '1 false positive among mechanical rules',
      ]);
    });

    it('is never the class of a pack with an expected site under a rule', () => {
      const gate = verifiedGate(behavior({ ruleSites: 1 }));
      expect(gate.class).toBe('breaking');
      expect(gate.status).toBe('candidate');
    });
  });

  it('a record that contradicts itself is a candidate', () => {
    const record = {
      status: 'verified' as const,
      truth: 'sha256-x',
      repos: 2,
      breaking: { precision: 1, recall: 1, falsePositives: 0 },
    };
    expect(recordedStatus(record)).toBe('verified');
    expect(recordedStatus({ ...record, repos: 1 })).toBe('candidate');
    expect(recordedStatus({ ...record, breaking: { ...record.breaking, falsePositives: 2 } })).toBe(
      'candidate',
    );
    expect(recordedStatus(undefined)).toBe('candidate');
  });
});

describe('companionProblems', () => {
  const source = 'https://example.com/toy/changelog';

  it('accepts an entry with a name and an https source, and no entries at all', () => {
    expect(companionProblems(undefined, 'toy')).toEqual([]);
    expect(companionProblems([{ name: 'toy-plugin', source }], 'toy')).toEqual([]);
  });

  it('refuses an entry with no source, an empty one, or one that is not an https URL', () => {
    const problems = companionProblems(
      [
        { name: 'no-source' },
        { name: 'empty-source', source: '' },
        { name: 'plain-text', source: 'the migration guide' },
        { name: 'insecure', source: 'http://example.com/guide' },
        { name: 'local', source: 'file:///etc/hosts' },
      ],
      'toy',
    );
    expect(problems).toHaveLength(5);
    expect(problems[0]).toBe(
      'companions[0] "no-source": source must be the https URL of the official migration guide or changelog that says it moves with toy',
    );
  });

  it("refuses an entry without a name, or one that names the pack's own package", () => {
    expect(companionProblems([{ source }], 'toy')).toEqual(['companions[0]: name is empty']);
    expect(companionProblems([{ name: 'toy', source }], 'toy')).toEqual([
      'companions[0] "toy": a pack does not name its own package',
    ]);
  });
});

describe('definePack', () => {
  const finding = (line: number, column: number, rule?: string): Finding => ({
    change: {
      package: 'toy',
      from: '1.2.0',
      to: '2.0.0',
      path: 'oldName',
      kind: 'removed',
      severity: 'breaking',
      source: 'types',
      confidence: 1,
    },
    usage: {
      file: 'a.ts',
      line,
      column,
      endLine: line,
      endColumn: column,
      symbolPath: 'oldName',
      access: 'call',
      snippet: '',
      via: 'direct',
    },
    severity: 'breaking',
    confidence: 1,
    fixability: 'mechanical',
    reason: '',
    ...(rule ? { rule } : {}),
  });
  const pack = definePack({
    meta: {
      package: 'toy',
      from: '>=1 <2',
      to: '>=2 <3',
      sources: [{ title: 'guide', url: 'https://example.com' }],
      maintainer: 'uptide-dev',
    },
    rules: [
      {
        id: 'rename',
        summary: 'oldName is newName',
        severity: 'breaking',
        kinds: ['removed'],
        symbols: /^oldName$/,
        guide: 'use newName',
        rewrite: (text, f) => replaceAtSite(text, f, 'oldName', 'newName'),
      },
    ],
    behavior: [
      {
        id: 'retry',
        summary: 'connect() retries by default',
        reported: ['finding'],
        detect: (text) =>
          text.includes('connect(') ? [{ line: 1, column: 1, snippet: 'connect()' }] : [],
      },
    ],
    instructions: 'only the site',
  });

  it('carries the packages the pack says always move with it, and none by default', () => {
    expect(pack.companions).toBeUndefined();
    const companions = [{ name: 'toy-plugin', source: 'https://example.com/toy/changelog' }];
    const named = definePack({ meta: pack.meta, rules: [], instructions: 'x', companions });
    expect(named.companions).toEqual(companions);
    expect(pack.releaseGroup).toBeUndefined();
    expect(
      definePack({ meta: pack.meta, rules: [], instructions: 'x', releaseGroup: companions })
        .releaseGroup,
    ).toEqual(companions);
  });

  it('runs an unexercised rule as assisted: no edit, the site demoted, detection unchanged', () => {
    const context = { from: '1.2.0', to: '2.0.0', includeDeprecated: false };
    const text = 'oldName(1);';
    expect(withUnexercised(pack, [])).toBe(pack);
    const assisted = withUnexercised(pack, ['rename']);
    expect(assisted.transform(text, finding(1, 1), context)).toMatchObject({
      applied: false,
      text,
      reason: expect.stringContaining('rename rewrite'),
    });
    expect(pack.transform(text, finding(1, 1), context).applied).toBe(true);
    const lowPrecision = withUnexercised(pack, [], ['rename']);
    expect(lowPrecision.transform(text, finding(1, 1), context)).toMatchObject({
      applied: false,
      reason: expect.stringContaining('wrong too often'),
    });
    // Another rule's edits are untouched.
    expect(withUnexercised(pack, ['other']).transform(text, finding(1, 1), context).applied).toBe(
      true,
    );
  });

  it('rewrites only the reported occurrence, within the supported versions', () => {
    const text = 'oldName(oldName(1));';
    const out = pack.transform(text, finding(1, 9), {
      from: '1.2.0',
      to: '2.0.0',
      includeDeprecated: false,
    });
    expect(out).toMatchObject({ applied: true, rule: 'rename', text: 'oldName(newName(1));' });
    expect(
      pack.transform(text, finding(1, 9), { from: '2.0.0', to: '3.0.0', includeDeprecated: true })
        .applied,
    ).toBe(false);
    expect(replaceAtSite('const oldNameX = 1;', finding(1, 7), 'oldName', 'newName').applied).toBe(
      false,
    );
  });

  it("reports a note's sites as the pack's own findings, in files that use the package", () => {
    const findings =
      pack.runtimeFindings?.({
        root: '/r',
        workspace: 'app',
        from: '1.2.0',
        to: '2.0.0',
        installedDir: '',
        targetDir: '',
        usages: [{ file: 'src/db.ts' } as never, { file: 'src/db.ts' } as never],
        read: (file) => (file === join('app', 'src/db.ts') ? 'connect()' : undefined),
      }) ?? [];
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: 'retry',
      severity: 'breaking',
      fixability: 'manual',
      change: { source: 'pack', path: 'toy:retry' },
      usage: { file: 'src/db.ts', line: 1 },
    });
  });
});

describe('scoring', () => {
  it('a site at an expected line under another rule is a hit, listed as such', () => {
    const score = scoreSites(
      [
        { file: 'a.ts', line: 1, rule: 'x', severity: 'breaking' },
        { file: 'a.ts', line: 2, rule: 'y', severity: 'breaking' },
        { file: 'b.ts', line: 9, rule: 'x', severity: 'breaking' },
      ],
      [
        { file: 'a.ts', line: 1, rule: 'x' },
        { file: 'a.ts', line: 2, rule: 'x' },
        { file: 'c.ts', line: 3, rule: 'x' },
      ],
    );
    expect(score.falsePositives).toEqual([
      { file: 'b.ts', line: 9, rule: 'x', severity: 'breaking' },
    ]);
    expect(score.falseNegatives).toEqual([{ file: 'c.ts', line: 3, rule: 'x' }]);
    expect(score.wrongRule).toEqual([
      { file: 'a.ts', line: 2, rule: 'y', severity: 'breaking', expected: 'x' },
    ]);
  });
});

const pack = (name: string): MigrationPack => ({
  name,
  defaultTarget: '',
  rules: [],
  supports: () => true,
  transform: (text, _finding, context) => ({
    text: `${name} ${context.from} → ${context.to}`,
    applied: text !== '',
    reason: name,
  }),
  guide: () => name,
  reviewNotes: () => [],
});

it("routes a companion pack's sites to it, between its own versions (UPT-10)", () => {
  const both = withCompanionPacks(pack('zod'), [pack('express')]);
  const site = (name: string, from: string, to: string) =>
    ({ change: { package: name, from, to } }) as Finding;
  const context = { from: '3.25.0', to: '4.6.5', includeDeprecated: false };
  expect(both.transform('x', site('zod', '3.25.0', '4.6.5'), context).text).toBe(
    'zod 3.25.0 → 4.6.5',
  );
  expect(both.transform('x', site('express', '4.0.0', '5.0.0'), context).text).toBe(
    'express 4.0.0 → 5.0.0',
  );
  expect(both.guide(site('express', '4.0.0', '5.0.0'))).toBe('express');
  expect(withCompanionPacks(both, [])).toBe(both);
});

it('gives a companion its own scan context and review section (UPT-98)', () => {
  const seen: unknown[] = [];
  const companion = {
    ...pack('express'),
    reviewNotes: () => ['express note'],
    transform: (text: string, _f: Finding, context: PackContext) => {
      seen.push(context.defaultMessages);
      return { text, applied: true, reason: '' };
    },
  };
  const both = withCompanionPacks(pack('zod'), [companion]);
  const mine = { from: '4.0.0', to: '5.0.0', includeDeprecated: false, defaultMessages: [] };
  const lead = {
    from: '3.25.0',
    to: '4.6.5',
    includeDeprecated: false,
    defaultMessages: [{ file: 'lead.ts' }] as never,
    companions: { express: mine },
  };
  both.transform(
    'x',
    { change: { package: 'express', from: '4.0.0', to: '5.0.0' } } as Finding,
    lead,
  );
  expect(seen).toEqual([[]]);
  expect(both.reviewSections?.(lead)).toEqual([
    { title: 'express 4.0.0 → 5.0.0', lines: ['express note'] },
  ]);
  expect(both.reviewSections?.({ ...lead, companions: {} })).toEqual([]);
});
