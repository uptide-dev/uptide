import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isMajorUpgrade, noPackBlockers } from './no-pack.js';
import type { FixReport } from './types.js';

const storefront = (): FixReport =>
  JSON.parse(readFileSync(new URL('./__fixtures__/storefront-zod.json', import.meta.url), 'utf8'));
/** A run no pack covered, every check that ran passing; `verification` overrides. */
const noPack = (
  from: string,
  target: string,
  verification: Partial<FixReport['verification']> = {},
): FixReport => {
  const run = storefront();
  return {
    ...run,
    package: 'next',
    from,
    target,
    tier: 'generic',
    sites: [],
    verification: {
      ...run.verification,
      newErrors: [],
      passed: true,
      tests: [{ workspace: '.', status: 'passed', output: '' }],
      build: [{ workspace: '.', status: 'passed', command: 'next build', output: '' }],
      ...verification,
    },
  };
};

describe('isMajorUpgrade', () => {
  it('is a new major, a new minor below 1.0.0, or a version it cannot read', () => {
    expect(isMajorUpgrade('15.5.14', '16.4.0')).toBe(true);
    expect(isMajorUpgrade('15.4.0', '15.5.14')).toBe(false);
    expect(isMajorUpgrade('15.5.13', '15.5.14')).toBe(false);
    expect(isMajorUpgrade('0.4.2', '0.5.0')).toBe(true);
    expect(isMajorUpgrade('0.4.2', '0.4.3')).toBe(false);
    expect(isMajorUpgrade(undefined, '1.0.0')).toBe(true);
    expect(isMajorUpgrade('latest', '1.0.0')).toBe(true);
  });
});

describe('noPackBlockers', () => {
  it('says nothing about a run a pack covered', () => {
    expect(noPackBlockers({ ...noPack('3.25.76', '4.6.5'), tier: 'verified' })).toEqual([]);
  });

  it('never lets a major upgrade without a pack through, whatever passed', () => {
    expect(noPackBlockers(noPack('15.5.14', '16.4.0'))).toEqual([
      'no pack yet: next 15.5.14 → 16.4.0 is a major upgrade, and Uptide opens one only with a verified migration pack',
    ]);
  });

  it('lets a minor or patch through only with a passing build and tests', () => {
    expect(noPackBlockers(noPack('15.4.0', '15.5.14'))).toEqual([]);
    expect(
      noPackBlockers(
        noPack('15.4.0', '15.5.14', {
          build: [{ workspace: '.', status: 'missing', output: 'no build script' }],
          tests: [{ workspace: '.', status: 'missing', output: 'no test script' }],
        }),
      ),
    ).toEqual([
      'no pack yet: the repository has no build script and no tests to verify the bump with, and the type-check alone does not',
    ]);
    // A run stored before builds were recorded never ran one.
    const { build: _, ...unbuilt } = noPack('15.5.13', '15.5.14').verification;
    expect(noPackBlockers({ ...noPack('15.5.13', '15.5.14'), verification: unbuilt })).toEqual([
      'no pack yet: the repository has no build script to verify the bump with, and the type-check alone does not',
    ]);
    expect(
      noPackBlockers(
        noPack('15.4.0', '15.5.14', {
          tests: [{ workspace: '.', status: 'failed', output: '', preexisting: ['*'] }],
        }),
      ),
    ).toEqual(['no pack yet: tests fail, already before the upgrade, so they cannot verify it']);
  });

  it('leaves failures to verification, which already reports them', () => {
    expect(
      noPackBlockers(
        noPack('15.4.0', '15.5.14', {
          passed: false,
          build: [{ workspace: '.', status: 'failed', command: 'next build', output: '' }],
        }),
      ),
    ).toEqual([]);
  });
});
