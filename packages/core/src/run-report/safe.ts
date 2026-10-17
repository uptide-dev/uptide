import { CREDENTIAL } from '../credentials.js';
import { SafetyRefusal } from '../errors.js';
import { type Schema, validate } from '../onboarding/validate.js';
import { RUN_REPORT_SCHEMA, type RunReport } from './schema.js';

const pathText = (path: (string | number)[]): string =>
  path.reduce<string>(
    (text, part) =>
      typeof part === 'number' ? `${text}[${part}]` : text ? `${text}.${part}` : part,
    '',
  ) || 'report';

/**
 * Every reason `report` must not leave the runner: it breaks the schema (which admits no
 * code, diff, snippet or multi-line text), or a string in it has the shape of a credential.
 * Reasons name the field, never its value.
 */
export function reportProblems(report: unknown): string[] {
  const problems = validate(RUN_REPORT_SCHEMA as unknown as Schema, report).map(
    (e) => `${pathText(e.path)} ${e.message}`,
  );
  const scan = (value: unknown, path: (string | number)[]): void => {
    if (typeof value === 'string') {
      if (CREDENTIAL.test(value)) problems.push(`${pathText(path)} looks like a credential`);
    } else if (Array.isArray(value)) value.forEach((v, i) => void scan(v, [...path, i]));
    else if (value && typeof value === 'object')
      for (const [k, v] of Object.entries(value)) scan(v, [...path, k]);
  };
  scan(report, []);
  return problems;
}

/** Throws, naming the fields, when `report` may not be sent or written. */
export function assertSafeReport(report: unknown): asserts report is RunReport {
  const problems = reportProblems(report);
  if (problems.length)
    throw new SafetyRefusal(
      'UNSAFE_DATA',
      `the run report is not safe to send:\n  ${problems.join('\n  ')}`,
    );
}
