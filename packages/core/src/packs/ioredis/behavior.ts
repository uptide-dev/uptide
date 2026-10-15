import { parse } from 'yaml';
import { minVersion, satisfies, validRange } from '../../fetch/range.js';
import type { BehaviorNote } from '../contract.js';
import type { PackContext } from '../types.js';
import {
  clientDefaultSites,
  connectListenerSites,
  handshakeAuthSites,
  subscriberModeSites,
} from './detect.js';

/** Sources read 2026-10-14; see RESEARCH.md for each line. */
const guide = 'https://github.com/redis/ioredis/wiki/Upgrading-from-v5-to-v6';
const files = (context: PackContext) => context.inventory ?? [];
const manifests = (context: PackContext) =>
  files(context).flatMap((f) => {
    if (!/(?:^|\/)package\.json$/.test(f.file)) return [];
    try {
      return [{ file: f.file, pkg: JSON.parse(f.text) as Record<string, unknown> }];
    } catch {
      return [];
    }
  });
const declared = (pkg: Record<string, unknown>, name: string): string | undefined => {
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const range = (pkg[field] as Record<string, string> | undefined)?.[name];
    if (range) return range;
  }
  return undefined;
};
/** The declared range admits a release below `version` (or cannot be read as a range). */
const admitsBelow = (range: string, version: string) => {
  if (!validRange(range)) return true;
  const lowest = minVersion(range);
  return lowest === undefined || !satisfies(lowest, `>=${version}`);
};

/**
 * Packages that install their own ioredis 5 (an exact or caret dependency, not a peer): a v6
 * client handed to them is a second, incompatible class to TypeScript, and their own connections
 * keep speaking v5. Versions from each package's published manifest, read 2026-10-14.
 */
const BUNDLES_V5: { name: string; below?: string; fix: string }[] = [
  {
    name: 'bullmq',
    below: '6.0.0',
    fix: 'bullmq 6 makes ioredis an optional peer (a major upgrade of its own)',
  },
  { name: 'bull', fix: 'every bull 4 release depends on ioredis ^5' },
  { name: '@hocuspocus/extension-redis', fix: 'it depends on ioredis ~5.6.1' },
  { name: '@chat-adapter/state-ioredis', fix: 'it depends on ioredis ^5.4.1' },
  { name: 'cache-manager-ioredis-yet', fix: 'deprecated; it depends on ioredis ^5.4.1' },
];

export function bundledCopies(context: PackContext): string | false {
  const hits = manifests(context).flatMap(({ file, pkg }) =>
    BUNDLES_V5.flatMap(({ name, below, fix }) => {
      const range = declared(pkg, name);
      if (!range || (below && !admitsBelow(range, below))) return [];
      return [`\`${file}\` declares ${name} ${JSON.stringify(range)} (${fix})`];
    }),
  );
  return hits.length ? hits.join('; ') : false;
}

/** Instrumentation that patches ioredis only for the version ranges it lists. */
const INSTRUMENTATION: { name: string; below: string; why: string }[] = [
  {
    name: '@opentelemetry/instrumentation-ioredis',
    below: '0.70.0',
    why: 'releases before 0.70.0 patch ioredis >=2 <6 only',
  },
  {
    name: '@opentelemetry/auto-instrumentations-node',
    below: '0.80.0',
    why: 'releases before 0.80.0 bundle instrumentation-ioredis <0.70.0',
  },
];

export function instrumentationGaps(context: PackContext): string | false {
  const hits = manifests(context).flatMap(({ file, pkg }) =>
    INSTRUMENTATION.flatMap(({ name, below, why }) => {
      const range = declared(pkg, name);
      return range && admitsBelow(range, below)
        ? [`\`${file}\` declares ${name} ${JSON.stringify(range)} (${why})`]
        : [];
    }),
  );
  return hits.length ? hits.join('; ') : false;
}

export function staleTypes(context: PackContext): string | false {
  const hits = manifests(context)
    .filter(({ pkg }) => declared(pkg, '@types/ioredis'))
    .map(({ file }) => `\`${file}\` declares @types/ioredis`);
  return hits.length ? hits.join('; ') : false;
}

const NODE = '20.0.0';

/** Declarations that permit Node below 20, or none at all; never a guess from the running Node. */
export function nodeEvidence(context: PackContext): string | false {
  const found: { where: string; version: string }[] = [];
  for (const { file, text } of files(context)) {
    if (/(?:^|\/)package\.json$/.test(file)) {
      try {
        const node = (JSON.parse(text) as { engines?: { node?: string } }).engines?.node;
        if (node) found.push({ where: `\`${file}\` engines.node`, version: node });
      } catch {
        /* An unreadable manifest is reported as unknown below. */
      }
    } else if (/(?:^|\/)(?:\.nvmrc|\.node-version)$/.test(file)) {
      found.push({ where: `\`${file}\``, version: text.trim() });
    } else if (/\.github\/workflows\/.*\.ya?ml$/.test(file)) {
      try {
        const workflow = parse(text) as {
          jobs?: Record<
            string,
            {
              steps?: { with?: Record<string, unknown> }[];
              strategy?: { matrix?: Record<string, unknown> };
            }
          >;
        };
        for (const job of Object.values(workflow?.jobs ?? {}))
          for (const step of job.steps ?? []) {
            const value = step.with?.['node-version'];
            if (value === undefined) continue;
            const matrix = /^\$\{\{\s*matrix\.([\w-]+)\s*\}\}$/.exec(String(value));
            const versions = matrix ? job.strategy?.matrix?.[matrix[1] as string] : value;
            for (const version of Array.isArray(versions) ? versions : [versions])
              if (version !== undefined)
                found.push({ where: `\`${file}\` node-version`, version: String(version) });
          }
      } catch {
        /* As above. */
      }
    }
  }
  const readable = found
    .map((hit) => ({ ...hit, lowest: minVersion(hit.version.replace(/^v(?=\d)/, '')) }))
    .filter((hit) => hit.lowest);
  const low = readable.filter((hit) => !satisfies(hit.lowest as string, `>=${NODE}`));
  if (low.length)
    return low
      .map((hit) => `${hit.where} ${JSON.stringify(hit.version)} permits Node below 20`)
      .join('; ');
  return readable.length
    ? false
    : 'No Node version is declared in package.json engines, .nvmrc/.node-version or CI; ioredis 6 requires Node 20 or newer';
}

function note(
  id: string,
  summary: string,
  evidence: (context: PackContext) => string | false,
): BehaviorNote {
  return {
    id,
    summary,
    reported: ['decision'],
    applies(context) {
      const hit = evidence(context);
      return hit && `${hit}: ${summary}`;
    },
  };
}

export const ioredisBehavior: BehaviorNote[] = [
  {
    id: 'client-defaults',
    summary:
      'clients built without explicit protocol, retryStrategy and keepAlive change behavior in ioredis 6: RESP3 handshake (HELLO 3, AUTH inside it), exponential reconnect backoff capped at 5 s plus jitter instead of linear up to 2 s, and TCP keep-alive after 30 s instead of off. Choose per client: keep the v6 defaults, or pin protocol: 2 / the v5 retryStrategy (Math.min(times * 50, 2000)) / keepAlive: 0. Never change them silently.',
    reported: ['finding', 'decision'],
    severity: 'deprecated',
    detect: clientDefaultSites,
  },
  {
    id: 'subscriber-mode',
    summary:
      'under RESP3 a subscribed connection keeps mode "normal" and accepts regular commands: a comparison with mode \'subscriber\' silently stops matching unless the client pins protocol: 2',
    reported: ['finding'],
    severity: 'breaking',
    detect: subscriberModeSites,
  },
  {
    id: 'offline-queue-connect',
    summary:
      'with enableOfflineQueue: false, commands sent from a "connect" listener can reject before the RESP3 handshake finishes; send them from "ready", or keep the offline queue',
    reported: ['finding'],
    severity: 'breaking',
    detect: connectListenerSites,
  },
  {
    id: 'handshake-auth',
    summary:
      'ioredis 6 authenticates inside HELLO 3 (command name "hello", credentials in its arguments): code that recognizes the AUTH command by name to redact or classify it misses the password',
    reported: ['finding'],
    severity: 'breaking',
    detect: handshakeAuthSites,
  },
  note(
    'node-20',
    'ioredis 6 requires Node.js 20 or newer; raise the declared runtime and CI before upgrading.',
    nodeEvidence,
  ),
  note(
    'bundled-copies',
    'these packages install their own ioredis 5: a v6 client passed to them fails to type-check as a second class, and their own connections keep v5 defaults. Choose: upgrade the dependent to a release that peers on ioredis (a migration of its own), pass connection options instead of a client, or keep ioredis 5 until it does. Never cast the client to silence the compiler.',
    bundledCopies,
  ),
  note(
    'instrumentation',
    'tracing instrumentation that only patches ioredis <6 keeps compiling and silently stops recording Redis spans; upgrade it with ioredis.',
    instrumentationGaps,
  ),
  note(
    'stale-types',
    '@types/ioredis is a deprecated stub (ioredis ships its own types since v5); remove it rather than let it shadow or confuse the bundled declarations.',
    staleTypes,
  ),
  note(
    'string-prototype',
    'ioredis 6.0.0 switches String.prototype out of V8 fast mode when it defines VerbatimString, slowing string-heavy code process-wide; the fix (redis/ioredis#2206) is not in a stable release at the read date. Measure, or wait for the release that carries it.',
    (context) => (context.to === '6.0.0' ? `the target is ${context.to}` : false),
  ),
  {
    id: 'also-review',
    summary: `Also review the [ioredis v5 to v6 upgrade guide](${guide}): replyMapping "resp3" is opt-in and changes reply shapes and TypeScript return types; Cluster takes RESP options under redisOptions, Sentinel at the top level.`,
    reported: ['decision'],
  },
];
