import { definePack, type Pack } from '../contract.js';
import { scriptsMentioning } from '../reach.js';
import { type BehaviorRecord, recordFindings } from '../records.js';
import { sentryBehavior } from './behavior.js';
import { INVENTORY, NEXT_INVENTORY, releaseGroup, SOURCES } from './meta.js';
import records from './records.json' with { type: 'json' };
import { type Lead, rulesFor } from './rules.js';

/**
 * The Sentry JavaScript SDK 10 → 11 pack, for one package a consumer declares. The SDK's
 * packages are released in lockstep from one tag (`releaseGroup`), so whichever of them leads,
 * the others that are installed move to the same version; the rules and notes are the same
 * knowledge, filtered to what that SDK exports. Sources and classification: RESEARCH.md.
 */
export function sentryPack(lead: Lead): Pack {
  // One record set for every lead, filed under the lead's own name like its rules.
  const own = (records as BehaviorRecord[]).map((r) => ({ ...r, id: `${lead}/${r.id}` }));
  const base = definePack({
    meta: {
      package: lead,
      from: '>=10 <11',
      to: '>=11 <12',
      sources: SOURCES,
      maintainer: 'uptide-dev',
    },
    defaultTarget: '11.7.0',
    releaseGroup: releaseGroup(lead),
    inventory: lead === '@sentry/nextjs' ? [...INVENTORY, ...NEXT_INVENTORY] : INVENTORY,
    // next.config.js/.mjs and the Sentry webpack/Turbopack wiring are outside tsc: only the
    // build sees a withSentryConfig import or build option that 11 removed.
    ...(lead === '@sentry/nextjs' ? { requiresBuild: true } : {}),
    rules: rulesFor(lead),
    behavior: sentryBehavior(lead),
    instructions:
      'Sources read 2026-10-14; see packs/sentry/RESEARCH.md. Migrate only the reported sites. Keep sampling rates, data-collection scope, scrubbing (beforeSend, beforeSendSpan), filtering and error capture what they were on v10 unless the owner chose otherwise: where v11 changed a default or removed a switch, say what you chose in decisions instead of accepting the more permissive behavior. For dataCollection, write the cited baseline with every key; never a cookie or header deny list of your own. Never cast to any, suppress a diagnostic, add a dependency on @sentry/types or @sentry/node-core, or enable tracing, logs or profiling that was off.',
  });
  // A script that only requires `@sentry/core` (or a sibling SDK of the same release) is in no
  // pack's analyzed set otherwise: the compile scope skips JS and `detect` reads importers.
  return {
    ...base,
    records: own,
    runtimeFindings: (input) => [
      ...(base.runtimeFindings?.({
        ...input,
        files: [...(input.files ?? []), ...scriptsMentioning(input, '@sentry/')],
      }) ?? []),
      ...recordFindings(own, { ...input, package: lead }),
    ],
  };
}
