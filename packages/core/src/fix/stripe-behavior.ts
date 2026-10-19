import { join } from 'node:path';
import type { Finding } from '../domain/report.js';
import { ruleFor } from '../packs/contract.js';
import { recordFindings } from '../packs/records.js';
import type { MigrationPack, PackContext } from '../packs/types.js';

/** Reuse the pre-edit client inventory and selected API migrations, never payload api_version. */
export function stripeBehaviorPlan(
  pack: MigrationPack,
  context: PackContext,
  selected: Finding[],
  input: { root: string; workspaces: string[]; from: string; to: string },
) {
  if (pack.name !== 'stripe' || !context.apiVersions) return undefined;
  const stripe = {
    apiVersions: context.apiVersions,
    apiClients: context.apiClients,
    // Raw compiler findings acquire rule ids during transform; classify them here too.
    movingApiPins: selected
      .filter((f) => (f.rule ?? ruleFor(pack.rules, f)?.id) === 'api-version')
      .map((f) => ({ file: f.usage.file, line: f.usage.line })),
  };
  for (const workspace of input.workspaces) {
    for (const finding of recordFindings(pack.records ?? [], {
      ...input,
      workspace,
      package: pack.name,
      stripe,
    })) {
      finding.usage.file =
        workspace === '.' ? finding.usage.file : join(workspace, finding.usage.file);
      if (
        !selected.some(
          (f) =>
            f.rule === finding.rule &&
            f.usage.file === finding.usage.file &&
            f.usage.line === finding.usage.line,
        )
      )
        selected.push(finding);
    }
  }
  return stripe;
}
