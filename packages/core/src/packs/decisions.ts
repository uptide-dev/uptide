import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packInventory } from './inventory.js';
import type { MigrationPack, PackContext } from './types.js';

/** Snapshot declared evidence before migration, including root CI/runtime pins in a monorepo. */
export function decisionInventory(
  root: string,
  workspaces: string[],
  pack: MigrationPack,
): NonNullable<PackContext['inventory']> {
  const files = new Set(
    workspaces.flatMap((workspace) =>
      packInventory(root, workspace, pack.inventory).map((file) => join(workspace, file)),
    ),
  );
  if (!workspaces.includes('.')) {
    for (const file of packInventory(
      root,
      '.',
      pack.inventory?.filter(
        (pattern) =>
          pattern.startsWith('.github/') ||
          pattern.includes('.nvmrc') ||
          pattern.includes('.node-version'),
      ),
    ))
      files.add(file);
  }
  return [...files].sort().map((file) => ({ file, text: readFileSync(join(root, file), 'utf8') }));
}

/** An explicit hook owns the section, even when it deliberately returns no decisions. */
export function packDecisions(
  pack: MigrationPack,
  context: PackContext,
  rules: readonly string[],
  followed?: Parameters<NonNullable<MigrationPack['decisions']>>[2],
): string[] {
  if (pack.decisions) return pack.decisions(context, rules, followed);
  return (pack.behavior ?? []).flatMap((note) => {
    if (!note.reported.includes('decision')) return [];
    const applies = note.applies ? note.applies(context) : true;
    return applies ? [`- ${typeof applies === 'string' ? applies : note.summary}`] : [];
  });
}
