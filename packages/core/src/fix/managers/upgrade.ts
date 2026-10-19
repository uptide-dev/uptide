import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseNpm, parsePnpm, parseYarn } from '../../adapters/typescript/lockfile.js';
import { UptideError } from '../../errors.js';
import { satisfies } from '../../fetch/range.js';
import { command, git } from '../process.js';
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
  /** Agent-led (UPT-78): resolutions outside the subtree are reported in `outOfScope`, not refused. */
  acceptOutOfScope?: boolean;
}
/**
 * What a workspace installs, and so what names a lockfile descriptor. A peer range is a
 * promise to consumers, validated and widened in the manifest only (`^18.3.1 || ^19.0.0`):
 * never an install descriptor, a `set resolution` or the range a resolved version is read by.
 */
const INSTALLED = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
export interface InstallReport extends LockDiff {
  manager: string;
  notes?: string[];
  file: string;
  /** npm's lock-only install ERESOLVEd from the old lockfile; the smaller retry that resolved (UPT-107). */
  eresolveRetry?: EresolveRetry;
  /** Packages the repo imports without declaring them that the new lockfile would drop (UPT-109). */
  undeclared?: Undeclared[];
}
export interface Undeclared {
  name: string;
  /** The version the new lockfile keeps, or the one the old lockfile had when it is gone. */
  version: string;
  kept: boolean;
}
export const describeUndeclared = (u: Undeclared): string =>
  `${u.name} ${u.version} is imported by the repo but not declared in package.json. ${u.kept ? `The re-resolve would have dropped it; it was kept at ${u.version}.` : 'The new lockfile no longer has it, so those imports fail.'} Add it to package.json.`;
type RetryStep = 'moved entries' | 'whole lockfile';
export interface EresolveRetry {
  step: RetryStep;
  /** Packages whose lockfile entries were dropped; empty for the whole lockfile. */
  dropped: string[];
  /** What npm reported on the first attempt. */
  conflicts: string[];
}
export const describeEresolveRetry = (r: EresolveRetry): string =>
  `npm's lock-only install hit ERESOLVE from the old lockfile; it resolved ${r.step === 'whole lockfile' ? 'with the whole lockfile re-resolved' : `without the lockfile entries of ${r.dropped.join(', ')}`}`;
/** Every retry ERESOLVEd too; nothing was forced (`--legacy-peer-deps`, `--force`). */
export class InstallBlockedError extends UptideError {
  constructor(readonly blocked: { attempts: string[]; conflicts: string[] }) {
    super(
      'INSTALL_BLOCKED',
      `npm could not resolve the upgrade (ERESOLVE): lock-only from the old lockfile, again without the lockfile entries of the moved packages and the packages whose peers they satisfy, and again with the whole lockfile re-resolved. npm reported:\n${blocked.conflicts.map((c) => `  ${c}`).join('\n')}\nUptide never retries with --legacy-peer-deps or --force. Nothing was changed.`,
    );
  }
}
/** The lines of npm's ERESOLVE report that name packages, in its own words. */
export function eresolveConflicts(output: string): string[] {
  const lines = output.split('\n').map((l) => l.replace(/^npm (?:error|ERR!) ?/, '').trim());
  const named = lines.flatMap((line, i) =>
    /^(While resolving|Found|Conflicting peer dependency): /.test(line) ||
    /^peer \S+ from /.test(line)
      ? [line]
      : line === 'Could not resolve dependency:' && lines[i + 1]
        ? [`${line} ${lines[i + 1]}`]
        : [],
  );
  return [...new Set(named)];
}
const isEresolve = (error: unknown) =>
  error instanceof UptideError &&
  error.code === 'INSTALL_FAILED' &&
  /\bERESOLVE\b/.test(error.message);
/**
 * The old lockfile without the entries of `names` and everything installed below them, or
 * without every installed entry (undefined): npm resolves those afresh. Links stay.
 */
function dropEntries(text: string, names?: Set<string>, keep = new Set<string>()): string {
  const json = JSON.parse(text);
  for (const [key, entry] of Object.entries<{ link?: boolean }>(json.packages ?? {})) {
    const installed = key.split('node_modules/').slice(1);
    if (!installed.length || entry.link) continue;
    const dropped = (n: string) => {
      const name = n.replace(/\/$/, '');
      return !keep.has(name) && (!names || names.has(name));
    };
    if (installed.some(dropped)) delete json.packages[key];
  }
  return `${JSON.stringify(json, null, 2)}\n`;
}
const installedName = (key: string) =>
  key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
/** The moved packages and every locked package that declares one of them as a peer. */
function peerHolders(text: string, moved: string[]): Set<string> {
  const names = new Set(moved);
  const packages = JSON.parse(text).packages ?? {};
  for (const [key, entry] of Object.entries<{ peerDependencies?: Record<string, string> }>(
    packages,
  ))
    if (key.includes('node_modules/') && moved.some((m) => entry.peerDependencies?.[m]))
      names.add(installedName(key));
  return names;
}
/** `names` and every locked package that depends on one of them, transitively. */
function requirers(text: string, names: string[]): Set<string> {
  const found = new Set(names);
  const entries = Object.entries<Record<string, Record<string, string> | undefined>>(
    JSON.parse(text).packages ?? {},
  ).filter(([key]) => key.includes('node_modules/'));
  for (let size = 0; size !== found.size; ) {
    size = found.size;
    for (const [key, entry] of entries)
      if (
        [entry.dependencies, entry.optionalDependencies, entry.peerDependencies].some((edges) =>
          [...found].some((n) => edges?.[n]),
        )
      )
        found.add(installedName(key));
  }
  return found;
}
/** What a bare import reaches in an npm lockfile: the root's and each workspace's top level. */
function topLevel(text: string): Map<string, string> {
  return new Map(
    Object.entries<{ version?: string }>(JSON.parse(text).packages ?? {}).flatMap(([key, e]) => {
      const installed = key.split('node_modules/').slice(1);
      return installed.length === 1 && e.version ? [[installed[0] as string, e.version]] : [];
    }),
  );
}
const IMPORT =
  /\b(?:from|import|require)\s*\(?\s*['"]((?:@[\w.-]+\/)?[\w-][\w.-]*)(?:\/[^'"]*)?['"]/g;
/** Packages `afterText` no longer has at the top level that tracked source imports by name. */
function droppedImports(root: string, beforeText: string, afterText: string): string[] {
  const after = topLevel(afterText);
  const gone = new Set([...topLevel(beforeText).keys()].filter((name) => !after.has(name)));
  const imported = new Set<string>();
  if (gone.size)
    for (const file of git(root, 'ls-files', '-z').split('\0'))
      if (
        /\.[cm]?[jt]sx?$/.test(file) &&
        !file.split('/').includes('node_modules') &&
        existsSync(join(root, file))
      )
        for (const [, name] of readFileSync(join(root, file), 'utf8').matchAll(IMPORT))
          if (gone.has(name as string)) imported.add(name as string);
  return [...imported].sort();
}
/**
 * `attempt` from the old lockfile, then (npm ERESOLVE only) from smaller ones, smallest
 * re-resolve first (UPT-107). Returns the lockfile the successful attempt started from.
 * A retry that drops a package the repo imports undeclared runs again keeping that package and
 * every locked package that requires it; if that ERESOLVEs, the first retry stands (UPT-109).
 */
async function resolving(
  pm: PackageManager,
  lockfile: string,
  beforeText: string,
  moved: string[],
  attempt: () => Promise<void>,
): Promise<{ start: string; retry?: EresolveRetry; imports?: string[] }> {
  let failure: unknown;
  try {
    await attempt();
    return { start: beforeText };
  } catch (error) {
    if (pm.kind !== 'npm' || !isEresolve(error)) throw error;
    failure = error;
  }
  const conflicts = eresolveConflicts((failure as Error).message);
  const holders = peerHolders(beforeText, moved);
  const steps: [RetryStep, Set<string> | undefined][] = [
    ['moved entries', holders],
    ['whole lockfile', undefined],
  ];
  for (const [step, names] of steps) {
    const start = dropEntries(beforeText, names);
    writeFileSync(lockfile, start);
    try {
      await attempt();
    } catch (error) {
      if (!isEresolve(error)) throw error;
      failure = error;
      continue;
    }
    const retry = { step, dropped: names ? [...names].sort() : [], conflicts };
    const resolved = readFileSync(lockfile, 'utf8');
    const imports = droppedImports(dirname(lockfile), beforeText, resolved);
    if (!imports.length) return { start, retry };
    const keep = requirers(beforeText, imports);
    for (const name of moved) keep.delete(name);
    const kept = dropEntries(beforeText, names, keep);
    writeFileSync(lockfile, kept);
    try {
      await attempt();
      const dropped = retry.dropped.filter((name) => !keep.has(name));
      return { start: kept, retry: { ...retry, dropped }, imports };
    } catch (error) {
      if (!isEresolve(error)) throw error;
      writeFileSync(lockfile, resolved);
      return { start, retry, imports };
    }
  }
  throw new InstallBlockedError({
    attempts: ['lock-only', ...steps.map(([step]) => step)],
    conflicts: eresolveConflicts((failure as Error).message),
  });
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
/**
 * The manager's own reconcile of the final manifests. npm 11.6 drops optional platform packages
 * (sharp's `@emnapi/*`) on a lock-only install and writes a lockfile its own `npm ci` rejects; a
 * second pass writes one it accepts (UPT-29).
 */
async function reconcile(root: string, pm: PackageManager, workspaces: string[]): Promise<void> {
  await run(root, pm, updateArgs(pm, root, workspaces));
  if (pm.kind === 'npm') await run(root, pm, updateArgs(pm, root, workspaces));
}
/**
 * Resolve exact versions, then restore the manifests; the caller's install reconciles them.
 * npm and pnpm reuse the satisfying lock entry. A range alone resolves the newest release in
 * it: `^4.0.1` gives a second @ai-sdk/provider next to the 4.0.1 that ai pins. Yarn takes
 * root `resolutions`, the root manifest's version first.
 */
async function installPinned(
  root: string,
  pm: PackageManager,
  workspaces: string[],
  names: string[],
  pin: (file: string, name: string) => string | undefined,
): Promise<void> {
  const originals = new Map(
    workspaces.map((w) => {
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
      const files = ['package.json', ...originals.keys()];
      const pins = new Map<string, string>();
      for (const name of names) {
        const version = files.map((f) => pin(f, name)).find(Boolean);
        if (version) pins.set(name, version);
      }
      json.resolutions = { ...json.resolutions, ...Object.fromEntries(pins) };
      writeFileSync(rootManifest, `${JSON.stringify(json, null, 2)}\n`);
    } else {
      for (const [file, text] of originals) {
        const json = JSON.parse(text);
        for (const section of INSTALLED)
          for (const name of names) {
            const spec: string | undefined = json[section]?.[name];
            const version = pin(file, name);
            if (!spec || !version) continue;
            const alias = spec.startsWith('npm:') ? spec.slice(0, spec.lastIndexOf('@') + 1) : '';
            json[section][name] = `${alias}${version}`;
          }
        writeFileSync(join(root, file), `${JSON.stringify(json, null, 2)}\n`);
      }
    }
    await run(root, pm, updateArgs(pm, root, workspaces));
  } finally {
    for (const [file, text] of originals) writeFileSync(join(root, file), text);
    if (yarn) writeFileSync(rootManifest, rootText);
  }
}
/**
 * The lockfile the same install writes at the parent commit (HEAD of the isolated worktree):
 * the plan's files at HEAD, the original lockfile, the same manager, flags and steps, with each
 * moved package pinned to the version it already has. A plain install would be a no-op: pnpm
 * only rewrites (re-serializes, prunes) a lockfile once a manifest changes. Undefined when it
 * cannot be produced; everything is restored either way, and the caller's final install puts
 * node_modules back.
 */
async function parentLock(
  root: string,
  pm: PackageManager,
  { files, workspaces }: Upgrade,
  names: string[],
  lockfile: string,
  beforeText: string,
  /** The lockfile the upgrade's install started from: `beforeText` less any dropped entries. */
  startText: string,
): Promise<string | undefined> {
  const current = new Map(
    files
      .filter((f) => existsSync(join(root, f)))
      .map((f) => [f, readFileSync(join(root, f), 'utf8')]),
  );
  const afterText = readFileSync(lockfile, 'utf8');
  try {
    for (const file of current.keys()) {
      let text: string | undefined;
      try {
        text = git(root, 'show', `HEAD:${file}`);
      } catch {
        // Added by the plan: absent at the parent.
      }
      if (text === undefined) rmSync(join(root, file));
      else writeFileSync(join(root, file), `${text}\n`);
    }
    writeFileSync(lockfile, startText);
    const parse = pm.kind === 'npm' ? parseNpm : pm.kind === 'pnpm' ? parsePnpm : parseYarn;
    const locked = new Map<string, Map<string, string>>();
    for (const workspace of workspaces) {
      const json = JSON.parse(readFileSync(join(root, workspace, 'package.json'), 'utf8'));
      const ranges = new Map<string, string>();
      for (const section of INSTALLED)
        for (const name of names) if (json[section]?.[name]) ranges.set(name, json[section][name]);
      locked.set(
        join(workspace, 'package.json'),
        parse(beforeText, { importer: workspace, declared: ranges }),
      );
    }
    await installPinned(root, pm, workspaces, names, (file, name) => locked.get(file)?.get(name));
    await reconcile(root, pm, workspaces);
    return readFileSync(lockfile, 'utf8');
  } catch {
    return undefined;
  } finally {
    for (const [file, text] of current) writeFileSync(join(root, file), text);
    writeFileSync(lockfile, afterText);
  }
}
/** Resolution changes are checked before they can become an upgrade commit. */
export async function upgradeInstall(root: string, upgrade: Upgrade): Promise<InstallReport> {
  const pm = await assertManagerAvailable(root);
  const lockfile = join(root, pm.lockfile);
  const beforeText = readFileSync(lockfile, 'utf8');
  const moves = [{ name: upgrade.name, version: upgrade.version }, ...(upgrade.also ?? [])];
  const names = moves.map((m) => m.name);
  const version = new Map(moves.map((m) => [m.name, m.version]));
  const removed = upgrade.remove ?? [];
  const before = lockGraph(pm, beforeText, [...names, ...removed]);
  const originals = new Map(
    upgrade.workspaces.map((w) => {
      const file = join(w, 'package.json');
      return [file, readFileSync(join(root, file), 'utf8')];
    }),
  );
  const { start, retry, imports } = await resolving(pm, lockfile, beforeText, names, async () => {
    await installPinned(root, pm, upgrade.workspaces, names, (_, name) => version.get(name));
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
    await reconcile(root, pm, upgrade.workspaces);
  });
  const written = readFileSync(lockfile, 'utf8');
  const afterText =
    pm.kind === 'npm' && Number(pm.actualVersion?.split('.')[0]) < 11
      ? preserveNpmLibc(beforeText, written)
      : written;
  const scope = [...new Set([...names, ...(upgrade.allowedPeers ?? [])])];
  const after = lockGraph(pm, afterText, [...names, ...removed]);
  const guard = (from: LockGraph, accept?: boolean): LockDiff => {
    const peers = pm.kind === 'npm' ? npmPeerReresolutions(from, after, names, scope) : [];
    const diff = assertLockScope(
      from,
      after,
      scope,
      peers.flatMap((p) => p.records),
      removed,
      accept,
    );
    if (peers.length) diff.peerReresolved = peers;
    return diff;
  };
  let diff: LockDiff;
  try {
    try {
      diff = guard(before);
    } catch (error) {
      if (!(error instanceof UptideError && error.code === 'LOCKFILE_OUT_OF_SCOPE')) throw error;
      // Attribute only what the upgrade adds over the same install at the parent commit.
      const parentText = await parentLock(root, pm, upgrade, names, lockfile, beforeText, start);
      if (parentText === undefined) {
        if (!upgrade.acceptOutOfScope) throw error;
        diff = guard(before, true);
      } else {
        const parent = lockGraph(
          pm,
          pm.kind === 'npm' && Number(pm.actualVersion?.split('.')[0]) < 11
            ? preserveNpmLibc(beforeText, parentText)
            : parentText,
          [...names, ...removed],
        );
        diff = guard(parent, upgrade.acceptOutOfScope);
        const churn = assertLockScope(before, parent, scope, [], removed, true).outOfScope;
        if (churn?.length) diff.parentChurn = churn;
      }
    }
  } catch (error) {
    if (pm.kind === 'npm' && error instanceof UptideError && error.code === 'LOCKFILE_OUT_OF_SCOPE')
      error.message = `${pm.kind} ${pm.actualVersion ?? '(version unknown)'}: ${error.message}`;
    throw error;
  }
  if (afterText !== written) writeFileSync(lockfile, afterText);
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
  // Never declared on the repo's behalf: kept in the lockfile where it can be, reported always.
  const undeclared: Undeclared[] = [];
  if (pm.kind === 'npm') {
    const [was, now] = [topLevel(beforeText), topLevel(afterText)];
    const lost = droppedImports(root, beforeText, afterText);
    for (const name of [...new Set([...(imports ?? []), ...lost])].sort()) {
      const version = now.get(name);
      undeclared.push(
        version
          ? { name, version, kept: true }
          : { name, version: was.get(name) as string, kept: false },
      );
    }
  }
  return {
    ...diff,
    manager: pm.kind,
    ...(pm.note ? { notes: [pm.note] } : {}),
    file: pm.lockfile,
    ...(retry ? { eresolveRetry: retry } : {}),
    ...(undeclared.length ? { undeclared } : {}),
  };
}
