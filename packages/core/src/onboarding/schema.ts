import { PROVIDERS, type Provider } from '../llm/types.js';

/** The file `fix`, `check`, `list` and the Uptide workflow read, at the repository root. */
export const UPTIDE_CONFIG_FILE = 'uptide.yml';
/** Where the published copy of the schema lives; `schema/uptide.v1.json` is checked against it. */
export const UPTIDE_CONFIG_SCHEMA_URL =
  'https://raw.githubusercontent.com/uptide-dev/uptide/main/schema/uptide.v1.json';

export const EXECUTORS = ['auto', 'patch', 'sdk'] as const;
export type Executor = (typeof EXECUTORS)[number];

/** `uptide.yml` once loaded: every field present, defaults filled in. */
export interface UptideConfig {
  version: 1;
  packages: { allow: string[]; deny: string[] };
  /** Cron, UTC, as GitHub Actions reads it, or `manual`: no scheduled runs. */
  schedule: string;
  maxOpenPrs: number;
  llm: { enabled: boolean; provider: Provider };
  /** USD per run. */
  maxCost: number;
  executor: Executor;
  /** Days; only when the repository sets no release-age policy. Unset: no minimum. */
  minReleaseAgeDays?: number;
  /** False disables automatic root pin updates in draft PRs. Local runs still require consent. */
  updatePins?: boolean;
  /** How a migration is verified. */
  verify?: { build?: string };
}

/** `schedule: manual`: the workflow runs only when started by hand (Actions tab, dashboard). */
export const MANUAL_SCHEDULE = 'manual';

/** Used when `uptide.yml` leaves `schedule` out; `generateOnboarding` writes a per-repository one. */
export const DEFAULT_SCHEDULE = '17 6 * * 1';

export const DEFAULT_CONFIG: Readonly<UptideConfig> = Object.freeze({
  version: 1,
  packages: { allow: [], deny: [] },
  schedule: DEFAULT_SCHEDULE,
  maxOpenPrs: 3,
  llm: { enabled: true, provider: 'anthropic' as const },
  maxCost: 1,
  executor: 'auto',
});

/** npm package names with `*` and `?`: `zod`, `@types/*`, `eslint-*`. */
const GLOB = '^(?:@[a-z0-9*?~][a-z0-9._~*?-]*/)?[a-z0-9*?~][a-z0-9._~*?-]*$';

/**
 * JSON Schema (draft 2020-12) of `uptide.yml` version 1. The loader validates with this
 * object, so the schema and the loader cannot disagree; `schema/uptide.v1.json` is its
 * published copy. Only the keywords `validate.ts` implements may appear here.
 */
export const UPTIDE_CONFIG_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: UPTIDE_CONFIG_SCHEMA_URL,
  title: 'uptide.yml',
  description:
    'Settings for Uptide: which dependencies it upgrades, when, and how it uses the LLM.',
  type: 'object',
  additionalProperties: false,
  required: ['version'],
  properties: {
    version: { description: 'Format of this file. Only 1 exists.', const: 1 },
    packages: {
      description:
        'Which dependencies Uptide considers, as npm package name globs. Deny wins over allow.',
      type: 'object',
      additionalProperties: false,
      properties: {
        allow: {
          description: 'Only these dependencies. Empty: every dependency.',
          type: 'array',
          items: { type: 'string', pattern: GLOB },
          default: [],
        },
        deny: {
          description: 'Never these dependencies, even when allow matches them.',
          type: 'array',
          items: { type: 'string', pattern: GLOB },
          default: [],
        },
      },
    },
    schedule: {
      description:
        'When the workflow runs: a five-field cron expression in UTC, or `manual` to run only when started from the Actions tab or the Uptide dashboard. The workflow file holds a copy; run `uptide init` again after changing it.',
      type: 'string',
      default: DEFAULT_SCHEDULE,
    },
    maxOpenPrs: {
      description: 'No new pull request is opened while this many Uptide pull requests are open.',
      type: 'integer',
      minimum: 1,
      maximum: 50,
      default: DEFAULT_CONFIG.maxOpenPrs,
    },
    llm: {
      description: 'Assisted fixes for the sites no rule covers.',
      type: 'object',
      additionalProperties: false,
      properties: {
        enabled: {
          description:
            'No longer offered; accepted so older files still load. The Uptide Action requires the Anthropic key and rejects false. The local CLI still reads it.',
          type: 'boolean',
          default: true,
        },
        provider: {
          description: "Which provider receives the code, with this repository's own API key.",
          enum: [...PROVIDERS],
          default: 'anthropic',
        },
      },
    },
    maxCost: {
      description: 'Most a run may spend on LLM calls, in USD.',
      type: 'number',
      exclusiveMinimum: 0,
      maximum: 100,
      default: DEFAULT_CONFIG.maxCost,
    },
    executor: {
      description:
        'How assisted fixes are applied: auto (SDK for Anthropic when installed, patch otherwise), patch (one edit per site), sdk (a Claude Agent SDK session).',
      enum: [...EXECUTORS],
      default: 'auto',
    },
    minReleaseAgeDays: {
      description:
        'Days a release must be public before Uptide targets it, for a repository that sets no release-age policy of its own (npm min-release-age, pnpm minimumReleaseAge, Yarn npmMinimalAgeGate); a policy the repository sets wins. Unset: no minimum.',
      type: 'number',
      minimum: 0,
      maximum: 365,
    },
    updatePins: {
      description:
        'Allow root version pin updates in draft PRs. Set false to require --update-pins even for PR runs. Local runs always require --update-pins.',
      type: 'boolean',
    },
    verify: {
      description: 'How Uptide verifies a migration with the repository’s own scripts.',
      type: 'object',
      additionalProperties: false,
      properties: {
        build: {
          description:
            'The package.json script a migration pack’s required build runs, by name (`build-ci`): one that builds without a database or secrets. Unset: `build:ci`, then `build-ci`, then `build`.',
          type: 'string',
          pattern: '^[A-Za-z0-9][A-Za-z0-9:._-]*$',
          maxLength: 100,
        },
      },
    },
  },
} as const;
