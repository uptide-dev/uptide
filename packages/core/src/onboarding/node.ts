// `uptide/onboarding/node`: what reads the repository from disk. Everything else in
// onboarding is pure and lives in `./index.ts`, which must also load in a browser bundle.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { UptideError } from '../errors.js';
import { type LoadedConfig, MAX_CONFIG_BYTES, parseUptideConfig } from './config.js';
import { UPTIDE_CONFIG_FILE } from './schema.js';

export { snapshotFromDisk } from './snapshot.js';

/**
 * The configuration for a run in `cwd`: `explicit` when given (relative to `cwd`; it must
 * exist), else the nearest `uptide.yml` from `cwd` up to the Git root. Undefined when none.
 */
export function loadUptideConfig(cwd: string, explicit?: string): LoadedConfig | undefined {
  const read = (path: string): LoadedConfig => {
    if (statSync(path).size > MAX_CONFIG_BYTES)
      throw new UptideError(
        'INVALID_CONFIG',
        `${path} is larger than ${MAX_CONFIG_BYTES / 1024} KB`,
      );
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
