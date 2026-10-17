import { definePack, type Pack } from '../contract.js';
import { scriptsMentioning } from '../reach.js';
import { sentryBehavior } from './behavior.js';
import { releaseGroup, SOURCES } from './meta.js';
import { type Lead, rulesFor } from './rules.js';

/** Config the compiler may not reach: init files, next.config, manifests and runtime pins. */
const INVENTORY = [
  'package.json',
  '{.nvmrc,.node-version}',
  '**/*{sentry,Sentry,instrument}*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}',
  '**/sentry/**/*.{ts,tsx,js,jsx,mjs,cjs}',
];
const NEXT_INVENTORY = [
  'next.config.{js,mjs,cjs,ts,mts}',
  '{middleware,proxy,src/middleware,src/proxy}.{ts,js}',
];

/**
 * The Sentry JavaScript SDK 10 → 11 pack, for one package a consumer declares. The SDK's
 * packages are released in lockstep from one tag (`releaseGroup`), so whichever of them leads,
 * the others that are installed move to the same version; the rules and notes are the same
 * knowledge, filtered to what that SDK exports. Sources and classification: RESEARCH.md.
 */
export function sentryPack(lead: Lead): Pack {
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
      'Sources read 2026-10-14; see packs/sentry/RESEARCH.md. Migrate only the reported sites. Keep sampling rates, data-collection scope, scrubbing (beforeSend, beforeSendSpan), filtering and error capture what they were on v10 unless the owner chose otherwise: where v11 changed a default or removed a switch, say what you chose in decisions instead of accepting the more permissive behavior. Never cast to any, suppress a diagnostic, add a dependency on @sentry/types or @sentry/node-core, or enable tracing, logs or profiling that was off.',
  });
  // A script that only requires `@sentry/core` (or a sibling SDK of the same release) is in no
  // pack's analyzed set otherwise: the compile scope skips JS and `detect` reads importers.
  return {
    ...base,
    runtimeFindings: (input) =>
      base.runtimeFindings?.({
        ...input,
        files: [...(input.files ?? []), ...scriptsMentioning(input, '@sentry/')],
      }) ?? [],
  };
}
