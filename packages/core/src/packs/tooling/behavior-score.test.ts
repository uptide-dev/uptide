import { describe, expect, it } from 'vitest';
import { definePack, rateLabel } from '../contract.js';
import { type ScoredSite, scoreSites, scoreTruth, siteSeverity } from './pack-test.js';

// Synthetic, modeled on the ioredis 5 → 6 ground truth (PR 129): every expected site belongs to a
// behavior note. `client-defaults` only needs a look (deprecated); `handshake-auth` is declared
// breaking; `node-minimum` is a decision `check` never reports as a site.
const pack = definePack({
  meta: {
    package: 'redis-like',
    from: '>=5 <6',
    to: '>=6 <7',
    sources: [{ title: 'guide', url: 'https://example.com/guide' }],
    maintainer: 'uptide-dev',
  },
  rules: [
    {
      id: 'duplicate-signature',
      summary: 'duplicate() became generic',
      severity: 'breaking',
      kinds: ['signature'],
      symbols: /^TS2416$/,
      guide: 'make the override generic too',
    },
  ],
  behavior: [
    {
      id: 'client-defaults',
      summary: 'a client keeps RESP3 and the new retry defaults',
      reported: ['finding', 'decision'],
      severity: 'deprecated',
      detect: () => [],
    },
    {
      id: 'handshake-auth',
      summary: 'AUTH moves into HELLO',
      reported: ['finding'],
      severity: 'breaking',
      detect: () => [],
    },
    { id: 'node-minimum', summary: 'Node 20 or newer', reported: ['decision'] },
  ],
  instructions: '',
});

const at = (spec: string, rule: string, severity?: ScoredSite['severity']): ScoredSite => {
  const [file, line] = spec.split(':') as [string, string];
  return { file, line: Number(line), rule, ...(severity ? { severity } : {}) };
};
const repo = (predicted: ScoredSite[], expected: ScoredSite[]) => ({
  predicted,
  expected,
  ...scoreSites(predicted, expected),
});
const needsALook = (spec: string) => at(spec, 'client-defaults', 'deprecated');

/** The four scored repositories of the ioredis truth, with what the pack predicted there. */
const repos = [
  // voiceai: five rebuilt constructions; two predicted at the construction, not the run's first
  // line; two constructions changed by pure insertion, which are not sites.
  repo(
    ['src/cache.ts:101', 'src/cache.ts:108', 'src/jobs.ts:92', 'src/jobs.ts:98']
      .concat(['src/pubsub.ts:140', 'src/limiter.ts:57'])
      .map(needsALook),
    [
      'src/cache.ts:98',
      'src/cache.ts:108',
      'src/jobs.ts:89',
      'src/jobs.ts:98',
      'src/vectors.ts:134',
    ].map((s) => at(s, 'client-defaults')),
  ),
  // open-foundry: the truth anchors the rewritten acquisition, the pack the call below it.
  repo(
    [needsALook('packages/api/src/server.ts:138')],
    [at('packages/api/src/server.ts:136', 'client-defaults')],
  ),
  // dokunc: one construction found; the redaction test it misses is a breaking note's.
  repo(
    [needsALook('apps/collab/src/server.ts:108'), needsALook('apps/web/src/lib/redis.ts:54')],
    [
      at('apps/collab/src/server.ts:108', 'client-defaults'),
      at('apps/web/src/lib/log.test.ts:20', 'handshake-auth'),
      at('apps/web/src/lib/log.test.ts:28', 'handshake-auth'),
    ],
  ),
  // A clean upgrade: the client it reports was left as it was, by choice.
  repo([needsALook('src/lib/cache/client.ts:13')], []),
];

describe('behavior-note sites', () => {
  it('count as breaking misses only when their note is declared breaking', () => {
    const score = scoreTruth(pack, repos);
    // Before: 6 breaking false negatives, every client-defaults miss among them.
    expect(score.breaking).toMatchObject({
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 2,
    });
    expect(score.overall).toMatchObject({ truePositives: 3, falsePositives: 7, falseNegatives: 6 });
    expect(score.rules['client-defaults']).toMatchObject({
      truePositives: 3,
      falsePositives: 7,
      falseNegatives: 4,
    });
  });

  it('are scored on their own: precision and recall of every note site', () => {
    const { behavior } = scoreTruth(pack, repos);
    expect(behavior).toEqual({
      truePositives: 3,
      falsePositives: 7,
      falseNegatives: 6,
      precision: 0.3,
      recall: 1 / 3,
    });
  });

  it('take the severity of the rule or note they are expected under', () => {
    expect(siteSeverity(pack, 'duplicate-signature')).toBe('breaking');
    expect(siteSeverity(pack, 'client-defaults')).toBe('deprecated');
    expect(siteSeverity(pack, 'handshake-auth')).toBe('breaking');
    // Never reported as a finding: neither breaking nor deprecated.
    expect(siteSeverity(pack, 'node-minimum')).toBe('behavior');
    // `check` reports a detected note without a severity as breaking; so does the scorer.
    const unmarked = { ...pack, behavior: [{ ...pack.behavior[1], id: 'x', severity: undefined }] };
    expect(siteSeverity(unmarked as typeof pack, 'x')).toBe('breaking');
    expect(siteSeverity(pack, 'generic')).toBe('breaking');
  });

  it('leave a decision-only note out of the breaking misses', () => {
    const score = scoreTruth(pack, [repo([], [at('package.json:4', 'node-minimum')])]);
    expect(score.breaking.falseNegatives).toBe(0);
    expect(score.behavior.falseNegatives).toBe(1);
  });
});

describe('rateLabel', () => {
  it('says n/a for a zero denominator, where the ratio reads 100%', () => {
    const none = {
      precision: 1,
      recall: 0,
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 2,
    };
    expect(rateLabel(none, 'precision')).toBe('n/a');
    expect(rateLabel(none, 'recall')).toBe('0%');
    expect(rateLabel({ ...none, falseNegatives: 0, recall: 1 }, 'recall')).toBe('n/a');
    expect(
      rateLabel(
        { precision: 0.9, recall: 0.5, truePositives: 9, falsePositives: 1, falseNegatives: 9 },
        'precision',
      ),
    ).toBe('90%');
  });

  it('reads a record written before the counts were kept as it did', () => {
    expect(rateLabel({ precision: 1, recall: 0.7375, falsePositives: 0 }, 'precision')).toBe(
      '100%',
    );
    expect(rateLabel({ precision: 1, recall: 0.7375, falsePositives: 0 }, 'recall')).toBe('74%');
  });
});

describe('a generic truth entry', () => {
  it('counts as a true positive for whichever rule claims its site', () => {
    const expected = [at('src/a.ts:3', 'generic'), at('src/a.ts:9', 'generic')];
    const predicted = [at('src/a.ts:3', 'duplicate-signature', 'breaking')];
    const scored = repo(predicted, expected);
    expect(scored.wrongRule).toEqual([]);
    const { rules, breaking } = scoreTruth(pack, [scored]);
    expect(rules['duplicate-signature']).toMatchObject({
      truePositives: 1,
      falsePositives: 0,
      falseNegatives: 0,
    });
    // The site no rule claims is still the generic miss it was.
    expect(rules.generic).toMatchObject({ truePositives: 0, falsePositives: 0, falseNegatives: 1 });
    expect(breaking).toMatchObject({ truePositives: 1, falsePositives: 0, falseNegatives: 1 });
  });
  it('a named rule still has to match: another rule claiming it is reported, not counted', () => {
    const scored = repo(
      [at('src/a.ts:3', 'duplicate-signature')],
      [at('src/a.ts:3', 'handshake-auth')],
    );
    expect(scored.wrongRule).toHaveLength(1);
    expect(scoreTruth(pack, [scored]).rules['duplicate-signature']).toMatchObject({
      truePositives: 0,
      falsePositives: 1,
    });
  });
});
