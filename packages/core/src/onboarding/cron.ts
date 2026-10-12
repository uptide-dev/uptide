/**
 * Five-field cron as GitHub Actions accepts it (POSIX cron: numbers, `*`, ranges, steps,
 * lists, and month and weekday names). Returns why `expression` is not one, or undefined.
 */
export function cronProblem(expression: string): string | undefined {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5)
    return `has ${fields.length} field${fields.length === 1 ? '' : 's'}; a cron expression has five (minute hour day month weekday)`;
  for (const [i, field] of fields.entries()) {
    const spec = FIELDS[i] as FieldSpec;
    for (const part of (field as string).split(',')) {
      const problem = partProblem(part, spec);
      if (problem) return `${spec.name} field "${part}": ${problem}`;
    }
  }
  return undefined;
}

interface FieldSpec {
  name: string;
  min: number;
  max: number;
  names?: string[];
}

const FIELDS: FieldSpec[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day', min: 1, max: 31 },
  {
    name: 'month',
    min: 1,
    max: 12,
    names: ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'],
  },
  { name: 'weekday', min: 0, max: 6, names: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] },
];

function partProblem(part: string, spec: FieldSpec): string | undefined {
  const [range, step, ...rest] = part.split('/');
  if (rest.length || range === undefined || range === '') return 'not a cron value';
  if (step !== undefined && !(/^\d+$/.test(step) && Number(step) > 0))
    return 'a step must be a positive number';
  if (range === '*') return undefined;
  const bounds = range.split('-');
  if (bounds.length > 2) return 'not a cron value';
  const values = bounds.map((b) => fieldValue(b, spec));
  if (values.some((v) => v === undefined))
    return `expected ${spec.min} to ${spec.max}${spec.names ? ' or a name' : ''}`;
  const [low, high] = values as number[];
  if (high !== undefined && (low as number) > high) return 'a range must go from low to high';
  return undefined;
}

function fieldValue(text: string, spec: FieldSpec): number | undefined {
  const named = spec.names?.indexOf(text.toLowerCase()) ?? -1;
  if (named >= 0) return spec.min + named;
  if (!/^\d+$/.test(text)) return undefined;
  const n = Number(text);
  // Weekday 7 is Sunday again in POSIX cron, and GitHub accepts it.
  const max = spec.name === 'weekday' ? 7 : spec.max;
  return n >= spec.min && n <= max ? n : undefined;
}

/** FNV-1a: a stable small hash, the same in the CLI and the App. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * A weekly schedule for one repository: Monday, between 03:00 and 08:59 UTC, at a minute
 * that is never 0 or 30. GitHub delays scheduled runs at the top and middle of the hour,
 * and spreading repositories keeps them from all starting together. Same seed, same answer.
 */
export function weeklySchedule(seed: string): string {
  const h = hash(seed.toLowerCase());
  const minutes = Array.from({ length: 60 }, (_, m) => m).filter((m) => m !== 0 && m !== 30);
  const minute = minutes[h % minutes.length] as number;
  const hour = 3 + (Math.floor(h / minutes.length) % 6);
  return `${minute} ${hour} * * 1`;
}
