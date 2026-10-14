import type { MigrationPack } from './types.js';

/**
 * Asked for by an alternate lead's name (`react-router-dom`), the pack that names it (the one
 * for `react-router`); asked for by its own name, the pack itself.
 */
export function packLeading(
  name: string,
  packs: readonly MigrationPack[],
): MigrationPack | undefined {
  return (
    packs.find((p) => p.name === name) ??
    packs.find((p) => p.alternateLeads?.some((a) => a.name === name))
  );
}

/** The name a request stands for: the lead of the pack that names it as an alternate, else itself. */
export function leadName(name: string, packs: readonly MigrationPack[]): string {
  return packLeading(name, packs)?.name ?? name;
}

/** Each name once, alternates replaced by their lead, in the order first asked for. */
export function leadNames(names: readonly string[], packs: readonly MigrationPack[]): string[] {
  return [...new Set(names.map((name) => leadName(name, packs)))];
}
