import childProcess from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { onReset } from '../../shared-state.js';
import { consumerCompilerDir } from './compiler.js';
import type { LoadedRepo } from './repo.js';

export const parentTypecheckNotes = new Map<string, Set<string>>();

let parents = new WeakMap<LoadedRepo, Map<string, number> | null>();
onReset(() => {
  parents = new WeakMap();
  parentTypecheckNotes.clear();
});

/** TS 7 has no compiler API: compare the unchanged parent with its installed tsc. */
export function parentTypecheckFailure(
  repo: LoadedRepo,
  files: string[],
  baselineErrors: number,
): string | undefined {
  const config = repo.tsconfig ?? repo.inheritedTsconfig;
  if (!config) return undefined;
  let counts = parents.get(repo);
  if (counts === undefined) {
    const own = consumerCompilerDir(dirname(config));
    if (!own) return undefined;
    const manifest = JSON.parse(readFileSync(join(own, 'package.json'), 'utf8')) as {
      bin?: string | { tsc?: string };
    };
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.tsc;
    if (!bin) return undefined;
    // Always call tsc directly: this adapter has no authorization to run package scripts.
    const notes = parentTypecheckNotes.get(repo.dir) ?? new Set<string>();
    notes.add(
      `Parent type-check: ran ${relative(repo.dir, resolve(own, bin))} --project ${relative(repo.dir, config)} directly (no package scripts).`,
    );
    parentTypecheckNotes.set(repo.dir, notes);
    const scratch = mkdtempSync(join(tmpdir(), 'uptide-parent-tsc-'));
    let output: string | undefined;
    try {
      output = childProcess.execFileSync(
        process.execPath,
        [
          resolve(own, bin),
          '--project',
          config,
          '--noEmit',
          '--pretty',
          'false',
          '--tsBuildInfoFile',
          join(scratch, 'parent.tsbuildinfo'),
        ],
        {
          cwd: repo.dir,
          encoding: 'utf8',
          timeout: 60_000,
          maxBuffer: 16 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
    } catch (error) {
      const failure = error as { status?: number; stdout?: unknown };
      if (
        (failure.status === 1 || failure.status === 2) &&
        typeof failure.stdout === 'string' &&
        /error TS\d+:/.test(failure.stdout)
      )
        output = failure.stdout;
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    counts = output === undefined ? null : new Map();
    if (counts && output) {
      for (const line of output.split(/\r?\n/)) {
        const diagnostic = /^(.*)\(\d+,\d+\): error TS\d+:/.exec(line);
        if (diagnostic) {
          const file = resolve(repo.dir, diagnostic[1] as string);
          counts.set(file, (counts.get(file) ?? 0) + 1);
        } else if (/error TS\d+:/.test(line)) {
          counts = null;
          break;
        }
      }
    }
    parents.set(repo, counts);
  }
  if (counts === null)
    return 'Uptide setup problem: the repo’s parent type-check could not be verified; compile signal skipped';
  const ownErrors = files.reduce((n, file) => n + (counts.get(file) ?? 0), 0);
  if (ownErrors !== baselineErrors)
    return `Uptide setup problem: parent baseline has ${baselineErrors} errors but the repo’s own type-check has ${ownErrors} on the same files; compile signal skipped`;
  return undefined;
}
