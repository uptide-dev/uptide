import type { Finding } from '../domain/report.js';
import { ruleFor } from './contract.js';
import type { MigrationPack, TransformResult } from './types.js';

/** The rule a site, or the edit made there, belongs to. */
function ruleIdOf(pack: MigrationPack, finding: Finding, result?: TransformResult) {
  return result?.rule ?? finding.rule ?? pack.ruleOf?.(finding) ?? ruleFor(pack.rules, finding)?.id;
}

/** A site of a rule no real upgrade exercised: assisted, whatever its rewrite says (UPT-48). */
export function isUnexercised(
  pack: MigrationPack,
  finding: Finding,
  result?: TransformResult,
): boolean {
  const id = ruleIdOf(pack, finding, result);
  return id !== undefined && (pack.unexercised ?? []).includes(id);
}

/**
 * The pack as its record allows it to run: an edit of an unexercised rule is refused, so `fix`
 * hands the site to the agent with the guide. Detection is unchanged.
 */
export function withUnexercised(
  pack: MigrationPack,
  unexercised: readonly string[] | undefined,
): MigrationPack {
  if (!unexercised?.length) return pack;
  const wrapped: MigrationPack = {
    ...pack,
    unexercised,
    transform(text, finding, context) {
      const result = pack.transform(text, finding, context);
      if (!result.applied || !isUnexercised(wrapped, finding, result)) return result;
      return {
        text,
        applied: false,
        reason: `no real upgrade in the ground truth exercised the ${ruleIdOf(pack, finding, result)} rewrite yet: assisted`,
      };
    },
  };
  return wrapped;
}
