import { minVersion, satisfies, validRange } from '../../fetch/range.js';
import type { BehaviorNote } from '../contract.js';
import type { PackContext } from '../types.js';
import { clientDefaultSites, searchDialectSites, V6_DEFAULTS } from './detect.js';

/** Whether an upgrade from `from` to `to` crosses into `major` (4 → 6 crosses 5 and 6). */
export function crosses(major: number, from: string, to: string): boolean {
  return satisfies(from, `<${major}.0.0-0`) && satisfies(to, `>=${major}.0.0-0`);
}

/** Where the repository says it runs Node below `version`: `engines.node`, `.nvmrc`. */
function nodeBelow(context: PackContext, version: string): string | false {
  const hits: string[] = [];
  for (const { file, text } of context.inventory ?? []) {
    let range: string | undefined;
    if (/(?:^|\/)package\.json$/.test(file)) {
      try {
        range = (JSON.parse(text) as { engines?: { node?: string } }).engines?.node;
      } catch {
        range = undefined;
      }
    } else if (/(?:^|\/)\.(?:nvmrc|node-version)$/.test(file))
      range = text.trim().replace(/^v/, '');
    const lowest = range && validRange(range) ? minVersion(range) : undefined;
    if (lowest && !satisfies(lowest, `>=${version}`))
      hits.push(`\`${file}\` allows Node ${JSON.stringify(range)}`);
  }
  return hits.length ? hits.join('; ') : false;
}

/** Sources read 2026-10-14 at node-redis b64bacb; see RESEARCH.md for each line. */
export const redisBehavior: BehaviorNote[] = [
  // ---- 4 → 5 ----
  {
    id: 'node-18',
    summary: 'redis 5 requires Node.js 18 or later (`engines`: ">= 18", ">= 18.19.0" from 5.12)',
    reported: ['decision'],
    applies: (context) => {
      if (!crosses(5, context.from, context.to) || crosses(6, context.from, context.to))
        return false;
      const below = nodeBelow(context, '18.19.0');
      return below ? `redis 5 requires Node.js >= 18.19.0: ${below}` : false;
    },
  },
  {
    id: 'search-dialect-2',
    summary:
      "redis 5 sends DIALECT 2 with search queries (FT.SEARCH, FT.AGGREGATE, FT.EXPLAIN, FT.PROFILE, FT.SPELLCHECK) that pass no DIALECT, which can change their results where the server default is dialect 1. Pass `DIALECT: 1` to keep 4's queries, or confirm the results under dialect 2",
    reported: ['finding'],
    severity: 'deprecated',
    detect: (text, file) => searchDialectSites(text, file),
  },
  {
    id: 'pipeline-discards-unwritten',
    summary:
      '`multi().execAsPipeline()` in redis 5 discards the commands it had not written when the socket drops; 4 rejected but still ran them on the server',
    reported: ['decision'],
    applies: (context) => crosses(5, context.from, context.to),
  },
  // ---- 5 → 6 ----
  {
    id: 'client-defaults',
    summary: `redis 6 changes client defaults: RESP3 instead of RESP2 (reply shapes of some commands, legacy callback replies), a 5 s command timeout instead of none, keepAliveInitialDelay 30 s instead of 5 s, and maintNotifications "auto" under RESP3. To keep 5's behavior, set ${V6_DEFAULTS.map((d) => `\`${d.keep}\``).join(', ')}`,
    reported: ['finding', 'decision'],
    severity: 'deprecated',
    detect: (text, file) => clientDefaultSites(text, file),
    applies: (context) => crosses(6, context.from, context.to),
  },
  {
    id: 'node-20',
    summary: 'redis 6 requires Node.js 20 or later (`engines`: ">= 20.0.0")',
    reported: ['decision'],
    applies: (context) => {
      if (!crosses(6, context.from, context.to)) return false;
      const below = nodeBelow(context, '20.0.0');
      return below ? `redis 6 requires Node.js >= 20: ${below}` : false;
    },
  },
  {
    id: 'plain-object-replies',
    summary:
      'redis 6 returns object replies (HGETALL, CONFIG GET, XRANGE messages, FT.SEARCH documents and others) as plain objects instead of null-prototype objects: only code or tests that check the prototype see it',
    reported: ['decision'],
    applies: (context) => crosses(6, context.from, context.to),
  },
];

/** The major each note belongs to: a 5 → 6 upgrade never reports the 4 → 5 notes. */
export const NOTE_MAJOR: Record<string, 5 | 6> = {
  'node-18': 5,
  'search-dialect-2': 5,
  'pipeline-discards-unwritten': 5,
  'client-defaults': 6,
  'node-20': 6,
  'plain-object-replies': 6,
};
