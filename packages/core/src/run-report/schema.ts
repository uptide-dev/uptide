/**
 * `uptide.run/v1`: what one run of the Uptide Action reports to the Uptide app and writes to
 * the job summary. The engine owns it; the app imports it as `uptide/report`.
 *
 * Hard rule: no source code, diffs, snippets, compiler messages or environment values. Only
 * package names, versions, repository-relative paths, line numbers, symbol names, counts and
 * sentences Uptide composes itself. Every string field is pattern-bound (one line, bounded,
 * no code punctuation) and every object is closed (`additionalProperties: false`), so
 * nothing else fits; `reportProblems` enforces it before anything leaves the runner.
 */
export const RUN_REPORT_SCHEMA_ID = 'uptide.run/v1';
export const RUN_REPORT_SCHEMA_URL =
  'https://raw.githubusercontent.com/uptide-dev/uptide/main/schema/uptide.run.v1.json';

export type RunMode = 'list' | 'check' | 'fix';
export type UpgradeKind = 'major' | 'minor' | 'patch';
export type UpgradeStatus = 'up_to_date' | 'available' | 'fixed' | 'failed' | 'skipped';
/** What changed about the symbol: the engine's change kinds. */
export type BreakingChange =
  | 'removed'
  | 'renamed'
  | 'moved'
  | 'signature'
  | 'type'
  | 'widened'
  | 'narrowed'
  | 'required'
  | 'added'
  | 'deprecated'
  | 'cause'
  | 'module-format';

export interface BreakingSite {
  /**
   * Canonical symbol path in the dependency (`z.string`, `Stripe.Customer#email`), or
   * `TS<code>` for a compiler error the upgrade causes that no symbol explains.
   */
  symbol: string;
  /** Repository-relative. */
  file: string;
  line: number;
  change: BreakingChange;
}

export interface Verification {
  /** Type errors, before the upgrade and after the migration. */
  typecheck: { before: number; after: number };
  /** Lint tools failing on the edited files, before and after. */
  lint: { before: number; after: number };
  /** Test runs (one per workspace or scope) that passed and failed; null when none ran. */
  tests: { passed: number; failed: number } | null;
}

export interface Upgrade {
  package: string;
  from: string;
  to: string;
  kind: UpgradeKind;
  status: UpgradeStatus;
  breaking: BreakingSite[];
  /** Set when a migration was attempted. */
  verification: Verification | null;
  pr: { number: number; url: string } | null;
  costUsd: number;
  durationMs: number;
  /** Uptide's own words, one line; never engine output. */
  error?: string;
}

export interface RunReport {
  schema: typeof RUN_REPORT_SCHEMA_ID;
  engineVersion: string;
  repo: { id: number; owner: string; name: string };
  sha: string;
  runId: number;
  runAttempt: number;
  mode: RunMode;
  startedAt: string;
  finishedAt: string;
  upgrades: Upgrade[];
  error?: string;
}

const PACKAGE = '^(?:@[A-Za-z0-9._~-]+/)?[A-Za-z0-9._~-]+$';
const VERSION = '^[0-9A-Za-z.+-]{1,64}$';
// Symbol paths: identifiers joined by `.`, `#`, `[]`, `/`, `:`; no space, quote, brace or paren.
const SYMBOL = '^[A-Za-z0-9_$.#\\[\\]@/:*-]{1,300}$';
// Repository-relative: no leading slash, no `..` segment, no control character.
const FILE = '^(?![/\\\\])(?!(?:.*/)?\\.\\.(?:/|$))[^\\u0000-\\u001f]{1,500}$';
// One line of Uptide's own words: no control character, no backtick (no inline code).
const SENTENCE = '^[^\\u0000-\\u001f`]{1,300}$';
const NAME = '^[A-Za-z0-9_.-]{1,100}$';
const DATE = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$';
const COUNT = { type: 'integer', minimum: 0 } as const;
const BEFORE_AFTER = {
  type: 'object',
  additionalProperties: false,
  required: ['before', 'after'],
  properties: { before: COUNT, after: COUNT },
} as const;

/** JSON Schema (draft 2020-12) of `uptide.run/v1`; `schema/uptide.run.v1.json` is its copy. */
export const RUN_REPORT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: RUN_REPORT_SCHEMA_URL,
  title: 'uptide.run/v1',
  description:
    'One run of the Uptide Action. No source code, diffs, snippets or environment values: paths, line numbers, symbol names and counts only.',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema',
    'engineVersion',
    'repo',
    'sha',
    'runId',
    'runAttempt',
    'mode',
    'startedAt',
    'finishedAt',
    'upgrades',
  ],
  properties: {
    schema: { const: RUN_REPORT_SCHEMA_ID },
    engineVersion: { type: 'string', pattern: VERSION },
    repo: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'owner', 'name'],
      properties: {
        id: COUNT,
        owner: { type: 'string', pattern: NAME },
        name: { type: 'string', pattern: NAME },
      },
    },
    sha: { type: 'string', pattern: '^[0-9a-f]{40}$' },
    runId: COUNT,
    runAttempt: { type: 'integer', minimum: 1 },
    mode: { enum: ['list', 'check', 'fix'] },
    startedAt: { type: 'string', pattern: DATE },
    finishedAt: { type: 'string', pattern: DATE },
    upgrades: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'package',
          'from',
          'to',
          'kind',
          'status',
          'breaking',
          'verification',
          'pr',
          'costUsd',
          'durationMs',
        ],
        properties: {
          package: { type: 'string', pattern: PACKAGE, maxLength: 214 },
          from: { type: 'string', pattern: VERSION },
          to: { type: 'string', pattern: VERSION },
          kind: { enum: ['major', 'minor', 'patch'] },
          status: { enum: ['up_to_date', 'available', 'fixed', 'failed', 'skipped'] },
          breaking: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['symbol', 'file', 'line', 'change'],
              properties: {
                symbol: { type: 'string', pattern: SYMBOL },
                file: { type: 'string', pattern: FILE },
                line: { type: 'integer', minimum: 1 },
                change: {
                  enum: [
                    'removed',
                    'renamed',
                    'moved',
                    'signature',
                    'type',
                    'widened',
                    'narrowed',
                    'required',
                    'added',
                    'deprecated',
                    'cause',
                    'module-format',
                  ],
                },
              },
            },
          },
          verification: {
            anyOf: [
              { type: 'null' },
              {
                type: 'object',
                additionalProperties: false,
                required: ['typecheck', 'lint', 'tests'],
                properties: {
                  typecheck: BEFORE_AFTER,
                  lint: BEFORE_AFTER,
                  tests: {
                    anyOf: [
                      { type: 'null' },
                      {
                        type: 'object',
                        additionalProperties: false,
                        required: ['passed', 'failed'],
                        properties: { passed: COUNT, failed: COUNT },
                      },
                    ],
                  },
                },
              },
            ],
          },
          pr: {
            anyOf: [
              { type: 'null' },
              {
                type: 'object',
                additionalProperties: false,
                required: ['number', 'url'],
                properties: {
                  number: { type: 'integer', minimum: 1 },
                  url: {
                    type: 'string',
                    pattern: '^https://[A-Za-z0-9.-]+/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[0-9]+$',
                  },
                },
              },
            ],
          },
          costUsd: { type: 'number', minimum: 0 },
          durationMs: COUNT,
          error: { type: 'string', pattern: SENTENCE },
        },
      },
    },
    error: { type: 'string', pattern: SENTENCE },
  },
} as const;
