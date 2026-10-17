import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dirtyLines,
  published,
  uptideCommand,
  uptideInvocation,
  uptideVersionInfo,
  version,
} from './version.js';

it('reports the published CLI version, never the private engine manifest', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const cli = JSON.parse(readFileSync(new URL('../../cli/package.json', import.meta.url), 'utf8'));
  expect(pkg.private).toBe(true);
  expect(version).toBe(pkg.version);
  // A report said "Uptide 0.1.0", the engine's version, from a 0.7 CLI.
  expect(uptideVersionInfo().uptideVersion).toBe(cli.version);
  expect(published).toBe(cli.version);
});
it('resolves the public worker entry without a private source or dist path', () => {
  expect(import.meta.resolve('@uptide/core/worker')).toBe(
    new URL('../dist/worker.js', import.meta.url).href,
  );
});
it('does not call a tree dirty for the scratch config the bundler writes while building', () => {
  expect(dirtyLines('')).toEqual([]);
  expect(dirtyLines('?? packages/core/tsup.config.bundled_ab12cd34ef.mjs\n')).toEqual([]);
  expect(dirtyLines('?? tsup.config.bundled_x1.mjs\n M packages/core/src/version.ts\n')).toEqual([
    ' M packages/core/src/version.ts',
  ]);
  // Anything else, a real config edit included, is a dirty tree.
  expect(dirtyLines(' M packages/core/tsup.config.ts\n?? notes.txt\n')).toHaveLength(2);
});

describe('uptideCommand', () => {
  it('keeps portable commands on the installed release channel', () => {
    expect(uptideCommand('0.3.0')).toBe('npx uptide');
    expect(uptideCommand('0.2.0-next.20261003172442')).toBe('npx uptide@next');
    expect(uptideCommand('1.0.0-beta.2')).toBe('npx uptide@beta');
  });
});

describe('uptideInvocation', () => {
  const binary = process.argv[1] ?? '';
  let root: string;
  afterEach(() => {
    process.argv[1] = binary;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it.each([
    ['npx', 'cache/_npx/abc/node_modules/.bin/uptide', 'exec', false],
    ['npx without npm environment', 'cache/_npx/abc/node_modules/.bin/uptide', '', false],
    ['pnpm dlx', 'cache/pnpm/dlx/abc/node_modules/.bin/uptide', '', false],
    ['yarn dlx', 'cache/yarn/dlx-abc/node_modules/.bin/uptide', '', false],
    ['bunx', 'cache/bunx-abc/node_modules/.bin/uptide', '', false],
    ['unknown launcher', 'download/index.js', '', false],
    ['local-only symlink', 'project/node_modules/.bin/uptide', '', false],
    ['local-only resolved binary', 'project/node_modules/uptide/dist/index.js', '', false],
    ['local shim', 'project/node_modules/uptide/dist/index.js', 'run-script', false],
    ['npm exec local', 'project/node_modules/.bin/uptide', 'exec', false],
    ['global on PATH', 'prefix/bin/uptide', '', true],
    ['global resolved binary', 'prefix/lib/node_modules/uptide/dist/index.js', '', true],
    ['global off PATH', 'prefix/bin/uptide', '', false],
    ['shadowed global', 'prefix/bin/uptide', '', false],
  ])('recognizes %s', (name, path, command, installed) => {
    root = mkdtempSync(join(tmpdir(), 'uptide-invocation-'));
    const file = (path: string) => {
      const absolute = join(root, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, '');
      return absolute;
    };
    const local = file('project/node_modules/uptide/dist/index.js');
    const global = file('prefix/lib/node_modules/uptide/dist/index.js');
    mkdirSync(join(root, 'project/node_modules/.bin'));
    mkdirSync(join(root, 'prefix/bin'));
    if (name === 'local shim') file('project/node_modules/.bin/uptide');
    else symlinkSync(local, join(root, 'project/node_modules/.bin/uptide'));
    symlinkSync(global, join(root, 'prefix/bin/uptide'));
    if (!path.startsWith('project/') && !path.startsWith('prefix/')) file(path);
    vi.spyOn(process, 'cwd').mockReturnValue(join(root, 'project/src'));
    const shadow = file('other/bin/uptide');
    vi.stubEnv(
      'PATH',
      name === 'global off PATH'
        ? dirname(shadow)
        : [
            name === 'shadowed global' ? dirname(shadow) : join(root, 'missing'),
            join(root, 'prefix/bin'),
          ].join(delimiter),
    );
    vi.stubEnv('npm_command', command);
    process.argv[1] = join(root, path);
    expect(uptideInvocation('0.3.0')).toBe(installed ? 'uptide' : 'npx uptide');
    expect(uptideInvocation('0.3.0-next.1')).toBe(installed ? 'uptide' : 'npx uptide@next');
  });
});
