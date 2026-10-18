import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { command } from './process.js';
import type { LintResult } from './types.js';

/** A formatter or linter the repository itself uses, and how to run it on a list of files. */
interface StyleTool {
  name: 'biome' | 'prettier' | 'eslint' | 'oxfmt' | 'dprint';
  /** Rewrites the files in place. Absent for a tool that only checks. */
  format?: (files: string[]) => string;
  /** Exits non-zero when the files do not pass. */
  lint: (files: string[]) => string;
}

const quote = (arg: string): string =>
  /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`;
const list = (files: string[]): string => files.map(quote).join(' ');
const manifest = (dir: string): Record<string, unknown> => {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
};

/**
 * What the repository formats and lints with, from its own configuration files and installed
 * binaries: biome, prettier, oxfmt, dprint, eslint. Nothing is assumed: a tool without both a
 * configuration and a binary in `node_modules/.bin` is not used. For a workspace (`dir`,
 * repository-relative), each is the workspace's own, else the root's, as builds are.
 */
export function detectStyle(root: string, dir = '.'): StyleTool[] {
  const dirs = [...new Set([join(root, dir), root])];
  const has = (names: string[]): boolean =>
    dirs.some((d) => names.some((name) => existsSync(join(d, name))));
  const field = (name: string): boolean => dirs.some((d) => manifest(d)[name] !== undefined);
  const installed = (bin: string): boolean =>
    dirs.some((d) => existsSync(join(d, 'node_modules/.bin', bin)));
  const tools: StyleTool[] = [];
  if (has(['biome.json', 'biome.jsonc']) && installed('biome'))
    tools.push({
      name: 'biome',
      format: (files) => `biome format --write ${list(files)}`,
      // `check` is what a repository's own `lint` script runs: formatting, lint rules, imports.
      lint: (files) => `biome check ${list(files)}`,
    });
  const prettierConfig =
    has([
      '.prettierrc',
      '.prettierrc.json',
      '.prettierrc.yaml',
      '.prettierrc.yml',
      '.prettierrc.js',
      '.prettierrc.cjs',
      '.prettierrc.mjs',
      'prettier.config.js',
      'prettier.config.cjs',
      'prettier.config.mjs',
      'prettier.config.ts',
    ]) || field('prettier');
  if (prettierConfig && installed('prettier'))
    tools.push({
      name: 'prettier',
      format: (files) => `prettier --write ${list(files)}`,
      lint: (files) => `prettier --check ${list(files)}`,
    });
  const oxfmtConfig = has([
    '.oxfmtrc.json',
    '.oxfmtrc.jsonc',
    ...['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].map((ext) => `oxfmt.config.${ext}`),
  ]);
  if (oxfmtConfig && installed('oxfmt'))
    tools.push({
      name: 'oxfmt',
      format: (files) => `oxfmt ${list(files)}`,
      lint: (files) => `oxfmt --check ${list(files)}`,
    });
  if (has(['dprint.json', '.dprint.json', 'dprint.jsonc', '.dprint.jsonc']) && installed('dprint'))
    tools.push({
      name: 'dprint',
      format: (files) => `dprint fmt ${list(files)}`,
      lint: (files) => `dprint check ${list(files)}`,
    });
  const eslintConfig =
    has([
      'eslint.config.js',
      'eslint.config.mjs',
      'eslint.config.cjs',
      'eslint.config.ts',
      '.eslintrc',
      '.eslintrc.json',
      '.eslintrc.js',
      '.eslintrc.cjs',
      '.eslintrc.yaml',
      '.eslintrc.yml',
    ]) || field('eslintConfig');
  if (eslintConfig && installed('eslint'))
    tools.push({ name: 'eslint', lint: (files) => `eslint ${list(files)}` });
  return tools;
}

const run = (root: string, dir: string, script: string, timeoutMs: number) =>
  command(join(root, dir), process.env.SHELL ?? '/bin/sh', ['-c', script], timeoutMs, {
    PATH: [
      ...new Set([join(root, dir, 'node_modules/.bin'), join(root, 'node_modules/.bin')]),
      process.env.PATH,
    ].join(':'),
  });
/**
 * The existing files, by the package that holds them (nearest `package.json`), each relative to
 * it: a workspace's tools run from the workspace, with its own configuration, as its scripts do.
 */
const byPackage = (root: string, files: string[]): Map<string, string[]> => {
  const groups = new Map<string, string[]>();
  for (const file of [...new Set(files)].filter((f) => existsSync(join(root, f))).sort()) {
    let dir = dirname(file);
    while (dir !== '.' && !existsSync(join(root, dir, 'package.json'))) dir = dirname(dir);
    groups.set(dir, [...(groups.get(dir) ?? []), relative(dir, file)]);
  }
  return groups;
};
const inDir = (dir: string, script: string): string =>
  dir === '.' ? script : `cd ${quote(dir)} && ${script}`;
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

/**
 * Runs the repository's formatter on the files the migration edited, and on nothing else: a
 * formatter let loose on the whole repository would bury the migration in unrelated changes.
 * Returns the names of the formatters that ran.
 */
export async function formatFiles(
  root: string,
  files: string[],
  timeoutMs = 120_000,
): Promise<string[]> {
  const ran = new Set<string>();
  for (const [dir, targets] of byPackage(root, files))
    for (const tool of detectStyle(root, dir)) {
      if (!tool.format) continue;
      // A failure is not thrown: the lint that follows checks the same files and reports it.
      await run(root, dir, tool.format(targets), timeoutMs);
      ran.add(tool.name);
    }
  return [...ran];
}

/**
 * Runs the repository's lint on the files the migration edited. A `baseline` (the same files
 * before the migration) tells a failure the migration introduced from one that was there.
 */
export async function lintFiles(
  root: string,
  files: string[],
  baseline: LintResult[] = [],
  timeoutMs = 120_000,
): Promise<LintResult[]> {
  const results: LintResult[] = [];
  for (const [dir, targets] of byPackage(root, files))
    for (const tool of detectStyle(root, dir)) {
      const script = inDir(dir, tool.lint(targets));
      const result = await run(root, dir, tool.lint(targets), timeoutMs);
      const before = baseline.find(
        (b) =>
          b.tool === tool.name &&
          (dir === '.' ? !b.command.startsWith('cd ') : b.command.startsWith(inDir(dir, ''))),
      );
      results.push({
        tool: tool.name,
        status:
          !result.code && !result.timeout
            ? 'passed'
            : before?.status === 'failed'
              ? 'pre-existing'
              : 'failed',
        command: script,
        files: targets.length,
        output:
          result.code || result.timeout
            ? result.output.replace(ANSI, '').split(root).join('<repo>').slice(-4000)
            : '',
      });
    }
  return results;
}
