import { describe, expect, it } from 'vitest';
import { cronProblem, weeklySchedule } from './cron.js';

describe('cronProblem', () => {
  it('accepts what GitHub Actions accepts', () => {
    for (const cron of [
      '17 6 * * 1',
      '*/15 * * * *',
      '0 9-17 * * MON-FRI',
      '5 4 1,15 jan *',
      '0 0 * * 7',
    ])
      expect(cronProblem(cron), cron).toBeUndefined();
  });

  it('says what is wrong with the rest', () => {
    expect(cronProblem('* * * *')).toContain('has 4 fields');
    expect(cronProblem('60 * * * *')).toBe('minute field "60": expected 0 to 59');
    expect(cronProblem('0 24 * * *')).toBe('hour field "24": expected 0 to 23');
    expect(cronProblem('0 0 0 * *')).toBe('day field "0": expected 1 to 31');
    expect(cronProblem('0 0 * 13 *')).toBe('month field "13": expected 1 to 12 or a name');
    expect(cronProblem('0 0 * * 8')).toBe('weekday field "8": expected 0 to 6 or a name');
    expect(cronProblem('*/0 * * * *')).toContain('a step must be a positive number');
    expect(cronProblem('10-5 * * * *')).toContain('a range must go from low to high');
  });
});

describe('weeklySchedule', () => {
  it('is weekly, on Monday morning UTC, never at minute 0 or 30', () => {
    for (let i = 0; i < 500; i++) {
      const cron = weeklySchedule(`owner/repo-${i}`);
      expect(cronProblem(cron)).toBeUndefined();
      const [minute, hour, day, month, weekday] = cron.split(' ').map(String);
      expect(['0', '30']).not.toContain(minute);
      expect(Number(hour)).toBeGreaterThanOrEqual(3);
      expect(Number(hour)).toBeLessThanOrEqual(8);
      expect([day, month, weekday]).toEqual(['*', '*', '1']);
    }
  });

  it('is the same for the same repository, whatever the case, and spreads repositories', () => {
    expect(weeklySchedule('Acme/Shop')).toBe(weeklySchedule('acme/shop'));
    const spread = new Set(Array.from({ length: 200 }, (_, i) => weeklySchedule(`o/r${i}`)));
    expect(spread.size).toBeGreaterThan(100);
  });
});
