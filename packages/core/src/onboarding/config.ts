import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isMap, isScalar, isSeq, LineCounter, type Node, parseDocument } from 'yaml';
import { UptideError } from '../errors.js';
import { keyLike } from '../llm/config.js';
import { globRegExp } from '../workspaces.js';
import { cronProblem } from './cron.js';
import {
  DEFAULT_CONFIG,
  MANUAL_SCHEDULE,
  UPTIDE_CONFIG_FILE,
  UPTIDE_CONFIG_SCHEMA,
  type UptideConfig,
} from './schema.js';
import { type Path, type Schema, validate } from './validate.js';

/** `uptide.yml` as written: only what the file sets, already validated. */
export type UptideConfigInput = {
  version: 1;
  packages?: { allow?: string[]; deny?: string[] };
  schedule?: string;
  maxOpenPrs?: number;
  llm?: { enabled?: boolean; provider?: UptideConfig['llm']['provider'] };
  maxCost?: number;
  executor?: UptideConfig['executor'];
};

export interface LoadedConfig {
  /** Absolute path of the file read. */
  path: string;
  config: UptideConfig;
  /** What the file itself sets, for callers that rank it against other sources. */
  given: UptideConfigInput;
}

/** Credentials by shape: provider keys, GitHub and Slack tokens, bearer headers. */
const TOKEN =
  /(?:sk-[\w-]{8,}|AIza[\w-]{12,}|phc_[\w-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|xox[abpr]-[\w-]{8,}|bearer\s)/i;
const MAX_BYTES = 64 * 1024;

/** `packages.allow[0]`: how a setting is named in an error. */
const pathText = (path: Path): string =>
  path.reduce<string>(
    (text, part) =>
      typeof part === 'number' ? `${text}[${part}]` : text ? `${text}.${part}` : part,
    '',
  ) || 'the file';

/** A filled-in configuration from what the file sets. */
export function withDefaults(given: UptideConfigInput): UptideConfig {
  return {
    version: 1,
    packages: {
      allow: given.packages?.allow ?? [...DEFAULT_CONFIG.packages.allow],
      deny: given.packages?.deny ?? [...DEFAULT_CONFIG.packages.deny],
    },
    schedule: given.schedule ?? DEFAULT_CONFIG.schedule,
    maxOpenPrs: given.maxOpenPrs ?? DEFAULT_CONFIG.maxOpenPrs,
    llm: {
      enabled: given.llm?.enabled ?? DEFAULT_CONFIG.llm.enabled,
      provider: given.llm?.provider ?? DEFAULT_CONFIG.llm.provider,
    },
    maxCost: given.maxCost ?? DEFAULT_CONFIG.maxCost,
    executor: given.executor ?? DEFAULT_CONFIG.executor,
  };
}

/**
 * Read `uptide.yml` text. Throws `UptideError('INVALID_CONFIG')` naming every problem with
 * its line, and never quoting a value that looks like a credential.
 */
export function parseUptideConfig(
  text: string,
  file: string = UPTIDE_CONFIG_FILE,
): { config: UptideConfig; given: UptideConfigInput } {
  const invalid = (lines: string[]): UptideError =>
    new UptideError(
      'INVALID_CONFIG',
      `${file} is not valid:\n${lines.map((l) => `  ${l}`).join('\n')}\nReference: docs/config.md`,
    );
  if (Buffer.byteLength(text) > MAX_BYTES)
    throw invalid([`the file is larger than ${MAX_BYTES / 1024} KB`]);
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, uniqueKeys: true, prettyErrors: false });
  const lineOf = (offset: number | undefined): string =>
    offset === undefined ? '' : `line ${lineCounter.linePos(offset).line}: `;
  if (doc.errors.length)
    throw invalid(
      doc.errors.map(
        (e) => `${lineOf(e.pos[0])}${e.message.split('\n')[0]?.replace(/ at line.*$/, '')}`,
      ),
    );
  const nodeAt = (path: Path): Node | undefined => {
    for (let i = path.length; i >= 0; i--) {
      const node = path.length === 0 || i === 0 ? doc.contents : doc.getIn(path.slice(0, i), true);
      if (node && typeof node === 'object' && 'range' in node) return node as Node;
    }
    return undefined;
  };
  const at = (path: Path, message: string): string =>
    `${lineOf(nodeAt(path)?.range?.[0])}${pathText(path)} ${message}`;

  // Credentials first: whatever else is wrong, a key in the file is the problem to name.
  const secrets: string[] = [];
  const scan = (node: unknown, path: Path): void => {
    if (isMap(node))
      for (const pair of node.items) {
        const name = isScalar(pair.key) ? String(pair.key.value) : '';
        if (keyLike(name))
          secrets.push(
            `${lineOf((pair.key as Node | null)?.range?.[0])}"${name}" looks like a credential setting`,
          );
        scan(pair.value, [...path, name]);
      }
    else if (isSeq(node)) node.items.forEach((item, i) => void scan(item, [...path, i]));
    else if (isScalar(node) && typeof node.value === 'string' && TOKEN.test(node.value))
      secrets.push(at(path, 'looks like a credential'));
  };
  scan(doc.contents, []);
  if (secrets.length)
    throw invalid([
      ...secrets,
      'API keys belong in the repository secret (ANTHROPIC_API_KEY) or an environment variable, never in this file. If this one was committed, rotate it.',
    ]);

  const value: unknown = doc.toJS();
  if (value === null || value === undefined)
    throw invalid(['the file is empty; it needs at least `version: 1`']);
  const record = value as Record<string, unknown>;
  if (typeof record === 'object' && !Array.isArray(record)) {
    if (typeof record.version === 'number' && record.version > 1)
      throw invalid([
        at(
          ['version'],
          `is ${record.version}; this uptide reads version 1. Update uptide to read this file.`,
        ),
      ]);
    if ('draft' in record)
      throw invalid([at(['draft'], 'is not a setting: Uptide pull requests are always drafts')]);
  }
  const problems = validate(UPTIDE_CONFIG_SCHEMA as Schema, value).map((e) =>
    at(e.path, e.message),
  );
  if (typeof record.schedule === 'string' && record.schedule !== MANUAL_SCHEDULE) {
    const cron = cronProblem(record.schedule);
    if (cron) problems.push(at(['schedule'], `${cron}, or manual for no scheduled runs`));
  }
  if (problems.length) throw invalid(problems);
  const given = value as UptideConfigInput;
  return { config: withDefaults(given), given };
}

/**
 * The configuration for a run in `cwd`: `explicit` when given (relative to `cwd`; it must
 * exist), else the nearest `uptide.yml` from `cwd` up to the Git root. Undefined when none.
 */
export function loadUptideConfig(cwd: string, explicit?: string): LoadedConfig | undefined {
  const read = (path: string): LoadedConfig => {
    if (statSync(path).size > MAX_BYTES)
      throw new UptideError('INVALID_CONFIG', `${path} is larger than ${MAX_BYTES / 1024} KB`);
    return { path, ...parseUptideConfig(readFileSync(path, 'utf8'), path) };
  };
  if (explicit) {
    const path = resolve(cwd, explicit);
    if (!existsSync(path))
      throw new UptideError('INVALID_CONFIG', `--config ${explicit}: no such file (${path})`);
    return read(path);
  }
  let dir = resolve(cwd);
  for (;;) {
    const path = join(dir, UPTIDE_CONFIG_FILE);
    if (existsSync(path)) return read(path);
    const parent = dirname(dir);
    if (parent === dir || existsSync(join(dir, '.git'))) return undefined;
    dir = parent;
  }
}

/** Whether the configuration lets Uptide consider `name`: not denied, and allowed when allow is set. */
export function packageSelected(config: Pick<UptideConfig, 'packages'>, name: string): boolean {
  const matches = (globs: string[]) => globs.some((glob) => globRegExp(glob).test(name));
  if (matches(config.packages.deny)) return false;
  return config.packages.allow.length === 0 || matches(config.packages.allow);
}
