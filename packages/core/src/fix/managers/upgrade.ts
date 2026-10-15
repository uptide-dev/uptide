import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNpm, parsePnpm, parseYarn } from '../../adapters/typescript/lockfile.js';
import { UptideError } from '../../errors.js';
import { satisfies } from '../../fetch/range.js';
import { command } from '../process.js';
import { assertManagerAvailable } from './availability.js';
import { assertLockScope, type LockDiff, type LockGraph, type Targets } from './lock-guard.js';
import { type PackageManager, updateArgs } from './manager.js';
import { npmGraph, npmPeerReresolutions, preserveNpmLibc } from './npm-lock.js';
import { pnpmGraph, yarnGraph } from './text-lock.js';
export interface Upgrade {
  name: string;
  version: string;
  workspaces: string[];
  files: string[];
  /**
   * What moves with it, each at the version that agrees (`check/companions.ts`): one install,
   * and the lockfile may change inside any of their subtrees, never outside them.
   */
  also?: { name: string; version: string }[];
  /**
   * `@types` stubs the plan removes (`check/removed.ts`), already taken out of the manifests:
   * the lockfile may lose them and what only they reached, nothing more.
   */
  remove?: string[];
  /** Packages whose peer edges the user explicitly overrides, without changing their ranges. */
  allowedPeers?: string[];
}
/**
 * What a workspace installs, and so what names a lockfile descriptor. A peer range is a
 * promise to consumers, validated and widened in the manifest only (`^18.3.1 || ^19.0.0`):
 * never an install descriptor, a `set resolution` or the range a resolved version is read by.
 */
const INSTALLED = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
export interface InstallReport extends LockDiff {
  manager: string;
  file: string;
}
export function lockGraph(pm: PackageManager, text: string, target: Targets): LockGraph {
  return pm.kind === 'npm'
    ? npmGraph(text, target)
    : pm.kind === 'pnpm'
      ? pnpmGraph(text, target)
      : yarnGraph(text, target);
}
async function run(root: string, pm: PackageManager, args: string[]): Promise<void> {
  const result = await command(root, pm.bin, args, 300_000, {
    ...pm.env,
    YARN_ENABLE_IMMUTABLE_INSTALLS: 'false',
  });
  if (result.code)
    throw new UptideError(
      'INSTALL_FAILED',
      `${pm.bin} ${args.join(' ')} failed${result.timeout ? ' (timeout)' : ''}: ${result.output}`,
    );
}
/** Resolution changes are checked before they can become an upgrade commit. */
export async function upgradeInstall(root: string, upgrade: Upgrade): Promise<InstallReport> {
  const pm = await assertManagerAvailable(root);
  const lockfile = join(root, pm.lockfile);
  const beforeText = readFileSync(lockfile, 'utf8');
  const moves = [{ name: upgrade.name, version: upgrade.version }, ...(upgrade.also ?? [])];
  const names = moves.map((m) => m.name);
  const removed = upgrade.remove ?? [];
  const before = lockGraph(pm, beforeText, [...names, ...removed]);
  const originals = new Map(
    upgrade.workspaces.map((w) => {
      const file = join(w, 'package.json');
      return [file, readFileSync(join(root, file), 'utf8')];
    }),
  );
  const rootManifest = join(root, 'package.json');
  const rootText = readFileSync(rootManifest, 'utf8');
  const yarn = pm.kind.startsWith('yarn');
  try {
    if (yarn) {
      const json = JSON.parse(rootText);
      json.resolutions = {
        ...json.resolutions,
        ...Object.fromEntries(moves.map((m) => [m.name, m.version])),
      };
      writeFileSync(rootManifest, `${JSON.stringify(json, null, 2)}\n`);
    } else {
      // Resolve an exact version first, then restore range style; npm and pnpm reuse this
      // satisfying lock entry. A range alone resolves the newest release in it: `^4.0.1` gives
      // a second @ai-sdk/provider next to the 4.0.1 that ai pins.
      for (const [file, text] of originals) {
        const json = JSON.parse(text);
        for (const section of INSTALLED)
          for (const m of moves) {
            const spec = json[section]?.[m.name];
            if (!spec) continue;
            const alias = spec.startsWith('npm:') ? spec.slice(0, spec.lastIndexOf('@') + 1) : '';
            json[section][m.name] = `${alias}${m.version}`;
          }
        writeFileSync(join(root, file), `${JSON.stringify(json, null, 2)}\n`);
      }
    }
    await run(root, pm, updateArgs(pm, root, upgrade.workspaces));
  } finally {
    for (const [file, text] of originals) writeFileSync(join(root, file), text);
    if (yarn) writeFileSync(rootManifest, rootText);
  }
  if (pm.kind === 'yarn-berry') {
    // Restoring a broad range drops Yarn's temporary resolution; pin its descriptor in the
    // lockfile instead. A range the plan rewrote (`^14.0.0` → `^16.1.0`) is as broad as one it
    // kept: left alone, Yarn resolves its newest match (16.3.3), not the planned version.
    const descriptors = new Map<string, string>();
    for (const [, text] of originals) {
      const json = JSON.parse(text);
      for (const section of INSTALLED)
        for (const move of moves) {
          const spec = json[section]?.[move.name];
          if (!spec) continue;
          const alias = /^(npm:(?:@[^/\s]+\/)?[^@\s]+@)(.+)$/.exec(spec);
          const range = alias?.[2] ?? spec;
          // Exact self-resolutions make Yarn's resolver recurse into itself.
          if (range === move.version || !satisfies(move.version, range)) continue;
          descriptors.set(
            `${move.name}@${spec.startsWith('npm:') ? spec : `npm:${spec}`}`,
            `${alias?.[1] ?? 'npm:'}${move.version}`,
          );
        }
    }
    for (const [descriptor, resolution] of descriptors)
      await run(root, pm, [
        ...(pm.via === 'corepack' ? ['yarn'] : []),
        'set',
        'resolution',
        descriptor,
        resolution,
      ]);
  }
  // Let the real manager reconcile the final manifest, including its original range operator.
  await run(root, pm, updateArgs(pm, root, upgrade.workspaces));
  const written = readFileSync(lockfile, 'utf8');
  const afterText =
    pm.kind === 'npm' && Number(pm.actualVersion?.split('.')[0]) < 11
      ? preserveNpmLibc(beforeText, written)
      : written;
  const scope = [...new Set([...names, ...(upgrade.allowedPeers ?? [])])];
  const after = lockGraph(pm, afterText, [...names, ...removed]);
  const peerReresolved = pm.kind === 'npm' ? npmPeerReresolutions(before, after, names, scope) : [];
  let diff: LockDiff;
  try {
    diff = assertLockScope(
      before,
      after,
      scope,
      peerReresolved.flatMap((p) => p.records),
      removed,
    );
  } catch (error) {
    if (pm.kind === 'npm' && error instanceof UptideError && error.code === 'LOCKFILE_OUT_OF_SCOPE')
      error.message = `${pm.kind} ${pm.actualVersion ?? '(version unknown)'}: ${error.message}`;
    throw error;
  }
  if (afterText !== written) writeFileSync(lockfile, afterText);
  if (peerReresolved.length) diff.peerReresolved = peerReresolved;
  // Every package that moved resolved the version asked for, in every workspace declaring it.
  for (const workspace of upgrade.workspaces) {
    const json = JSON.parse(readFileSync(join(root, workspace, 'package.json'), 'utf8'));
    const ranges = new Map<string, string>();
    for (const section of INSTALLED)
      for (const m of moves) if (json[section]?.[m.name]) ranges.set(m.name, json[section][m.name]);
    const parse = pm.kind === 'npm' ? parseNpm : pm.kind === 'pnpm' ? parsePnpm : parseYarn;
    const resolved = parse(afterText, { importer: workspace, declared: ranges });
    for (const m of moves) {
      if (!ranges.has(m.name)) continue;
      const installed = resolved.get(m.name);
      if (installed !== m.version)
        throw new UptideError(
          'INSTALL_FAILED',
          `Requested ${m.name}@${m.version}, but ${workspace} resolved ${installed ?? 'nothing'}; verification cannot use a different target.`,
        );
    }
  }
  await run(root, pm, pm.args);
  if (readFileSync(lockfile, 'utf8') !== afterText)
    throw new UptideError(
      'LOCKFILE_OUT_OF_SCOPE',
      'Verification install changed the validated lockfile',
    );
  return { ...diff, manager: pm.kind, file: pm.lockfile };
}
