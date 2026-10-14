import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InstalledDependency } from '../check/companions.js';
import { standInLeads } from '../check/stand-ins.js';
import type { Manifest } from '../list/evidence.js';
import type { MigrationPack } from '../packs/types.js';

/**
 * The pack's lead where no workspace declares it but one declares an alternate lead
 * (`react-router` through `react-router-dom`): at the version installed through it, in the
 * workspaces that declare the alternate. Planned like a declared lead, so its release group
 * moves with it; `declareLead` then writes it into the manifest.
 */
export function standInDependencies(
  root: string,
  pack: MigrationPack | undefined,
  declared: readonly InstalledDependency[],
): InstalledDependency[] {
  if (!pack?.alternateLeads?.length || declared.some((d) => d.name === pack.name)) return [];
  const byWorkspace: Record<string, Record<string, string>> = {};
  for (const d of declared)
    for (const w of d.workspaces) byWorkspace[w] = { ...byWorkspace[w], [d.name]: d.version };
  const found = standInLeads(root, Object.keys(byWorkspace), byWorkspace, [pack], [pack.name]);
  const leads = new Map<string, InstalledDependency>();
  for (const [workspace, standIns] of Object.entries(found)) {
    const standIn = standIns[pack.name];
    if (!standIn) continue;
    const known = leads.get(standIn.version);
    if (known) known.workspaces.push(workspace);
    else
      leads.set(standIn.version, {
        name: pack.name,
        version: standIn.version,
        manifest: JSON.parse(readFileSync(join(standIn.dir, 'package.json'), 'utf8')) as Manifest,
        workspaces: [workspace],
      });
  }
  return [...leads.values()];
}
