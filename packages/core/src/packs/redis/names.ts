import type { Finding } from '../../domain/report.js';
import type { TransformResult } from '../types.js';

/**
 * v4 enums and the v5 constants that replace them, compared member by member in the published
 * declarations and builds (@redis/client 1.6.1 → 5.12.1, @redis/search 1.2.0 → 5.12.1,
 * @redis/time-series 1.1.0 → 5.12.1; read 2026-10-14). `members` says what differs; `changed`
 * lists the v4 members with no v5 member of the same name and value. Without them, importing
 * the constant under the old name changes nothing.
 */
export const CONSTANTS = new Map<
  string,
  { name: string; members?: string; changed?: string[]; type?: true }
>([
  ['SchemaFieldTypes', { name: 'SCHEMA_FIELD_TYPE' }],
  ['AggregateSteps', { name: 'FT_AGGREGATE_STEPS' }],
  [
    'AggregateGroupByReducers',
    { name: 'FT_AGGREGATE_GROUP_BY_REDUCERS', members: 'TO_LIST is TOLIST', changed: ['TO_LIST'] },
  ],
  ['RedisSearchLanguages', { name: 'REDISEARCH_LANGUAGE' }],
  [
    'SchemaTextFieldPhonetics',
    { name: 'SCHEMA_TEXT_FIELD_PHONETIC', members: 'FM_PT is DM_PT', changed: ['FM_PT'] },
  ],
  ['VectorAlgorithms', { name: 'SCHEMA_VECTOR_FIELD_ALGORITHM' }],
  ['TimeSeriesDuplicatePolicies', { name: 'TIME_SERIES_DUPLICATE_POLICIES' }],
  ['TimeSeriesEncoding', { name: 'TIME_SERIES_ENCODING' }],
  [
    'TimeSeriesAggregationType',
    {
      name: 'TIME_SERIES_AGGREGATION_TYPE',
      members: 'AVERAGE, MINIMUM and MAXIMUM are AVG, MIN and MAX',
      changed: ['AVERAGE', 'MINIMUM', 'MAXIMUM'],
    },
  ],
  [
    'TimeSeriesReducers',
    {
      name: 'TIME_SERIES_REDUCERS',
      members: 'MINIMUM and MAXIMUM are MIN and MAX; RANGE sends "RANGE" instead of "range"',
      changed: ['MINIMUM', 'MAXIMUM', 'RANGE'],
    },
  ],
  [
    'TimeSeriesBucketTimestamp',
    {
      name: 'TIME_SERIES_BUCKET_TIMESTAMP',
      members: 'HIGH is END, MID is MIDDLE',
      changed: ['HIGH', 'MID'],
    },
  ],
  ['GeoReplyWith', { name: 'GEO_REPLY_WITH' }],
  ['ClientKillFilters', { name: 'CLIENT_KILL_FILTERS' }],
  ['FailoverModes', { name: 'FAILOVER_MODES' }],
  ['ClusterSlotStates', { name: 'CLUSTER_SLOT_STATES' }],
  ['RedisFlushModes', { name: 'REDIS_FLUSH_MODES' }],
  ['FilterBy', { name: 'COMMAND_LIST_FILTER_BY' }],
  // A type, renamed with the same shape.
  ['SearchOptions', { name: 'FtSearchOptions', type: true }],
]);

const IMPORT = /^(\s*import\s*\{)([^}]*)(\}\s*from\s*['"](?:redis|@redis\/[\w-]+)['"].*)$/;

/**
 * At the reported import, `{ SchemaFieldTypes }` becomes `{ SCHEMA_FIELD_TYPE as SchemaFieldTypes }`,
 * so every use keeps its name. Declined when the import is not on one line, the file uses a
 * member whose name or value changed, or uses the name as a type (a constant is not one).
 */
export function renameConstant(text: string, finding: Pick<Finding, 'usage'>): TransformResult {
  const lines = text.split('\n');
  const index = finding.usage.line - 1;
  const line = lines[index] ?? '';
  const match = IMPORT.exec(line);
  if (!match) return { text, applied: false, reason: 'the reported line is not a one-line import' };
  const [, open, inner, close] = match as unknown as [string, string, string, string];
  const rest = lines.filter((_, i) => i !== index).join('\n');
  const renamed: string[] = [];
  const specifiers: string[] = [];
  for (const raw of inner.split(',')) {
    const [imported = '', local] = raw.trim().split(/\s+as\s+/);
    const target = CONSTANTS.get(imported);
    if (!target) {
      specifiers.push(raw);
      continue;
    }
    const name = local ?? imported;
    const member = [...rest.matchAll(new RegExp(`(?<![\\w$])${name}\\.(\\w+)`, 'g'))]
      .map((m) => m[1] as string)
      .find((m) => target.changed?.includes(m));
    if (member)
      return { text, applied: false, reason: `${name}.${member} changed in ${target.name}` };
    if (
      !target.type &&
      new RegExp(`(?:[:<|]|\\bextends|\\bkeyof)\\s*${name}(?![\\w$.])`).test(rest)
    )
      return {
        text,
        applied: false,
        reason: `${name} is used as a type; ${target.name} is a value`,
      };
    specifiers.push(raw.replace(raw.trim(), `${target.name} as ${name}`));
    renamed.push(name);
  }
  if (!renamed.length)
    return { text, applied: false, reason: 'no v4 enum is imported on this line' };
  lines[index] = `${open}${specifiers.join(',')}${close}`;
  return {
    text: lines.join('\n'),
    applied: true,
    reason: `${renamed.join(', ')} imported from the v5 constant under the same local name`,
  };
}
