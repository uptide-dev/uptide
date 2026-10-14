import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { hoistedPackageDir } from '../adapters/typescript/usages.js';
import type { MigrationPack } from '../packs/types.js';
import { readManifest } from './module-format.js';

/** A pack's lead that a workspace reaches only through an alternate lead it declares. */
export interface StandIn {
  /** The declared alternate (`react-router-dom`). */
  via: string;
  /** The lead's installed package root, wherever the installer put it. */
  dir: string;
  version: string;
}

/** By workspace, then by lead. */
export type StandIns = Record<string, Record<string, StandIn>>;

const linked = (spec: string): boolean => /^(link|workspace|file):/.test(spec);

/**
 * Where `lead` is installed for a workspace that declares `via`: hoisted next to it (npm, Yarn),
 * or beside the alternate's own copy (pnpm keeps a dependency in the store directory of the
 * package that depends on it, out of the workspace's reach).
 */
function leadDir(workspaceDir: string, lead: string, via: string): string | undefined {
  const reachable = hoistedPackageDir(workspaceDir, lead);
  if (reachable) return realpathSync(reachable);
  const alternate = hoistedPackageDir(workspaceDir, via);
  if (!alternate) return undefined;
  const beside = hoistedPackageDir(realpathSync(alternate), lead);
  return beside ? realpathSync(beside) : undefined;
}

/**
 * For each lead asked for by name that a workspace does not declare, the alternate lead it
 * declares instead and the copy of the lead installed through it. Only what was asked for:
 * a workspace's other dependencies are never re-attributed.
 */
export function standInLeads(
  cwd: string,
  workspaces: readonly string[],
  installedByWorkspace: Record<string, Record<string, string>>,
  packs: readonly MigrationPack[],
  only: readonly string[],
): StandIns {
  const found: StandIns = {};
  for (const pack of packs) {
    if (!only.includes(pack.name) || !pack.alternateLeads?.length) continue;
    for (const workspace of workspaces) {
      const declared = installedByWorkspace[workspace] ?? {};
      if (declared[pack.name] !== undefined) continue;
      const via = pack.alternateLeads
        .map((a) => a.name)
        .find((name) => declared[name] !== undefined && !linked(declared[name] as string));
      if (!via) continue;
      const dir = leadDir(resolve(cwd, workspace), pack.name, via);
      const version = dir ? readManifest(dir)?.version : undefined;
      if (!dir || !version) continue;
      found[workspace] = { ...found[workspace], [pack.name]: { via, dir, version } };
    }
  }
  return found;
}
