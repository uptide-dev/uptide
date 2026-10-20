import { join, resolve } from 'node:path';
import { projectFiles } from '../../check/importers.js';
import { minVersion, satisfies, validRange } from '../../fetch/range.js';
import { type BehaviorNote, definePack, detected, type Pack, type PackRule } from '../contract.js';
import type { PackContext } from '../types.js';
import {
  ADAPTER_RENAMES,
  adapterRenameSites,
  CONFIG,
  clientAdapterSites,
  clientJsSites,
  configOptionSites,
  datasourceUrlSites,
  engineTypeSites,
  envNotLoadedSites,
  implicitStepSites,
  mappedEnumMembers,
  metricsSites,
  middlewareSites,
  mongodbSites,
  packageJsonPrismaSites,
  REMOVED_ENTRYPOINT,
  removedEntrypointSites,
  removedFlagSites,
  rewriteSkipFlags,
  schemaEnvReads,
  schemaProperties,
  skipFlagSites,
  urlParamSites,
} from './detect.js';

const read = 'read 2026-10-20';
const web =
  'https://github.com/prisma/web/blob/42f314651cb659e885fdf59554196b2ea8efa75d/apps/docs/content/docs';
const GUIDE = `${web}/guides/upgrade-prisma-orm/v7.mdx`;
const release = (tag: string) => `https://github.com/prisma/orm/releases/tag/${tag}`;

/**
 * Every rule finds its sites with `detect`: the compiler-visible changes live in the generated
 * client, which `check` does not regenerate at 7 (RESEARCH.md, "How the compiler sees Prisma").
 */
const rules: PackRule[] = [
  {
    id: 'client-adapter',
    summary:
      '`new PrismaClient()` needs a driver adapter (or `accelerateUrl`) in 7, and `datasources`/`datasourceUrl` are removed: without one the constructor throws',
    severity: 'breaking',
    kinds: ['type', 'signature'],
    symbols: /^TS(?:2353|2554|2345)$/,
    message: /'adapter'|datasources|datasourceUrl|Expected 1 arguments/,
    detect: clientAdapterSites,
    guide:
      "Pass the driver adapter for the schema's database provider: `new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })` (`@prisma/adapter-pg`; SQLite `PrismaBetterSqlite3({ url })` from `@prisma/adapter-better-sqlite3`, MySQL/MariaDB `PrismaMariaDb`, SQL Server `PrismaMssql`, Neon `PrismaNeon`). The connection string is the value `datasources.db.url`/`datasourceUrl` passed, else the variable the schema's `url = env(…)` named, read where the code runs (7 loads no .env file). Keep every other option (`log`, `errorFormat`, `omit`, `transactionOptions`). With an Accelerate URL (`prisma://`, `prisma+postgres://`) pass `accelerateUrl` instead and keep `.$extends(withAccelerate())`; never give that URL to an adapter. Pool size and timeouts now come from the driver (connection-url-params). The adapter package is a new dependency: if it is not installed, say so in the decision for the owner instead of editing around it. Never cast the options to `any`.",
  },
  {
    id: 'schema-datasource-url',
    summary:
      '`url`, `directUrl` and `shadowDatabaseUrl` are no longer allowed in a schema datasource (P1012): the CLI reads them from `prisma.config.ts`',
    severity: 'breaking',
    kinds: [],
    symbols: /$^/,
    detect: datasourceUrlSites,
    guide:
      'Remove the property from the datasource block and put the URL in `prisma.config.ts` next to package.json: `import { defineConfig, env } from "prisma/config"; export default defineConfig({ schema: "prisma/schema.prisma", datasource: { url: env("DATABASE_URL") } })`, keeping a `migrations` block if the project has one. Where `directUrl` was set, the CLI uses `url` for migrations: give `url` the direct (non-pooled) URL and keep the pooled one for the runtime adapter. `shadowDatabaseUrl` moves to `datasource.shadowDatabaseUrl`. `env()` throws when the variable is unset; `process.env.X ?? ""` lets `prisma generate` run without a database. 7 loads no .env file: add `import "dotenv/config"` only when the project already has dotenv.',
  },
  {
    id: 'package-json-prisma',
    summary:
      'the `"prisma"` key of package.json (`schema`, `seed`) is ignored in 7: the schema path and the seed command move to `prisma.config.ts`',
    severity: 'breaking',
    kinds: [],
    symbols: /$^/,
    detect: packageJsonPrismaSites,
    guide:
      'Move `prisma.schema` to `schema` and `prisma.seed` to `migrations.seed` in `prisma.config.ts`, then remove the `"prisma"` key. The command stays as it is.',
  },
  {
    id: 'cli-skip-flags',
    summary:
      '`--skip-generate` (`migrate dev`, `db push`) and `--skip-seed` (`migrate dev`) are removed in 7, which never generates or seeds there',
    severity: 'breaking',
    kinds: [],
    symbols: /$^/,
    detect: skipFlagSites,
    rewrite: (text, finding) => rewriteSkipFlags(text, finding),
    guide: 'Drop the flag: 7 does what it asked for by default.',
  },
  {
    id: 'cli-removed-flags',
    summary:
      'CLI flags and commands removed in 7: `db execute --schema/--url`, `migrate diff --from-url/--to-url/--*-schema-datasource/--*-schema-datamodel/--shadow-database-url`, `generate --data-proxy/--accelerate/--no-engine/--allow-no-models`, `db pull --local-d1`, `prisma introspect`, and the removed `PRISMA_*` variables',
    severity: 'breaking',
    kinds: [],
    symbols: /$^/,
    detect: removedFlagSites,
    guide:
      '`db execute` and `migrate diff` read the database from `prisma.config.ts`: `--from-url`/`--from-schema-datasource` become `--from-config-datasource` (`--to-…` the same), `--*-schema-datamodel` becomes `--*-schema`, `--shadow-database-url` moves to `datasource.shadowDatabaseUrl`. `prisma introspect` is `prisma db pull`. Drop `generate --data-proxy/--accelerate/--no-engine` and the removed `PRISMA_*` variables.',
  },
  {
    id: 'config-removed-options',
    summary:
      '`engine` and `adapter` are removed from `prisma.config.ts` in 7: the client takes the adapter',
    severity: 'breaking',
    kinds: ['type'],
    symbols: /^TS2353$/,
    message: /'(?:engine|adapter)' does not exist in type 'PrismaConfig'/,
    detect: configOptionSites,
    guide:
      'Remove `engine` (7 has one engine). An `adapter` in the config becomes `datasource.url` for the CLI, and the adapter is passed to `new PrismaClient({ adapter })` instead.',
  },
  {
    id: 'mongodb-unsupported',
    summary: 'Prisma 7 does not support MongoDB yet: stay on Prisma 6',
    severity: 'breaking',
    kinds: [],
    symbols: /$^/,
    detect: mongodbSites,
    guide:
      'Do not upgrade this project: the upgrade guide says to stay on Prisma 6 for MongoDB. Record it as a decision for the owner.',
  },
  {
    id: 'client-middleware',
    summary:
      '`$use` middleware and `Prisma.Middleware` are removed in 7: query extensions (`$extends`) replace them',
    severity: 'breaking',
    kinds: ['type', 'removed'],
    symbols: /(?:\$use|Middleware|^TS2339$|^TS2694$)/,
    message: /(?:^$|\$use|Middleware)/,
    detect: middlewareSites,
    guide:
      '`prisma.$use(async (params, next) => …)` becomes a query extension: `const prisma = base.$extends({ query: { $allModels: { async $allOperations({ model, operation, args, query }) { … return query(args) } } } })`, where `params.model`/`params.action`/`params.args` are `model`/`operation`/`args` and `next(params)` is `query(args)`. `$extends` returns a new client: export and use that one; the base client no longer runs the middleware. Keep the order of several middlewares (the first `$use` is the outermost extension).',
  },
  {
    id: 'metrics-removed',
    summary:
      'the metrics preview feature is removed in 7: `$metrics` and `previewFeatures = ["metrics"]` (P1012) are gone',
    severity: 'breaking',
    kinds: ['type'],
    symbols: /(?:\$metrics|^TS2339$)/,
    message: /(?:^$|\$metrics)/,
    detect: metricsSites,
    guide:
      'Remove "metrics" from `previewFeatures`. There is no Prisma replacement for `$metrics`: read pool metrics from the driver (`pg`\'s `Pool` counts) or count queries in a `$extends` query extension, and say which in the decision for the owner.',
  },
  {
    id: 'adapter-renames',
    summary: `driver adapter classes renamed in 7: ${Object.entries(ADAPTER_RENAMES)
      .map(([from, to]) => `${from} → ${to}`)
      .join(', ')}`,
    severity: 'breaking',
    kinds: ['removed', 'renamed'],
    symbols: new RegExp(`(?:^|[:#.])(?:${Object.keys(ADAPTER_RENAMES).join('|')})$`),
    detect: adapterRenameSites,
    guide: `Import the new name: ${Object.entries(ADAPTER_RENAMES)
      .map(([from, to]) => `\`${from}\` is \`${to}\``)
      .join(', ')}; the constructor arguments are the same.`,
  },
  {
    id: 'removed-entrypoints',
    summary:
      'entry points removed in 7: `@prisma/client/runtime/library`, `runtime/binary`, `runtime/edge`, `runtime/react-native`, `/wasm`, `/react-native`',
    severity: 'breaking',
    kinds: ['removed', 'type'],
    symbols: new RegExp(`${REMOVED_ENTRYPOINT.source.slice(1, -1)}|^TS2307$`),
    message: /(?:^$|@prisma\/client\/(?:runtime|wasm|react-native))/,
    detect: removedEntrypointSites,
    guide:
      '`@prisma/client/runtime/library` is `@prisma/client/runtime/client` (already exported by 6.19): `Decimal`, `PrismaClientKnownRequestError`, `JsonValue`, `Sql` and the other public names are there; the Decimal.js internals, `Metric*` and `objectEnumValues` are not. `@prisma/client/wasm` is `@prisma/client/edge` in 7 (`/edge` now means what `/wasm` did). React Native and the binary engine are gone.',
  },
  {
    id: 'client-js-generator',
    summary:
      'the `prisma-client-js` generator is deprecated in 7: `prisma-client` generates the client into the project, with an `output` path',
    severity: 'deprecated',
    kinds: [],
    symbols: /$^/,
    detect: clientJsSites,
    guide:
      '`provider = "prisma-client"` with `output = "../src/generated/prisma"` (any path in the project), then import `PrismaClient` and `Prisma` from `<output>/client` instead of `@prisma/client`. Its output is ESM unless `moduleFormat = "cjs"`. It does not generate `Prisma.dmmf` or `Prisma.validator`. 7 still supports `prisma-client-js`: switch only when the owner wants to.',
  },
  {
    id: 'engine-type',
    summary:
      '`engineType` in the generator is unused in 7 (the library and binary engines are removed)',
    severity: 'deprecated',
    kinds: [],
    symbols: /$^/,
    detect: engineTypeSites,
    guide: 'Remove the `engineType` line: 7 ignores it.',
  },
];

const files = (context: PackContext) => context.inventory ?? [];
const schemas = (context: PackContext) => files(context).filter((f) => f.file.endsWith('.prisma'));

/** Where the repository allows Node below 20.19 or TypeScript below 5.4. */
function belowMinimums(context: PackContext): string[] {
  const hits: string[] = [];
  for (const { file, text } of files(context)) {
    const ranges: [string, string | undefined, string][] = [];
    if (/(?:^|\/)package\.json$/.test(file)) {
      try {
        const manifest = JSON.parse(text) as {
          engines?: { node?: string };
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        ranges.push(['Node', manifest.engines?.node, '20.19.0']);
        ranges.push([
          'TypeScript',
          manifest.devDependencies?.typescript ?? manifest.dependencies?.typescript,
          '5.4.0',
        ]);
      } catch {}
    } else if (/(?:^|\/)\.(?:nvmrc|node-version)$/.test(file))
      ranges.push(['Node', text.trim().replace(/^v/, ''), '20.19.0']);
    for (const [what, range, min] of ranges) {
      const lowest = range && validRange(range) ? minVersion(range) : undefined;
      if (lowest && !satisfies(lowest, `>=${min}`))
        hits.push(`\`${file}\` allows ${what} ${JSON.stringify(range)}`);
    }
  }
  return hits;
}

const behavior: BehaviorNote[] = [
  {
    id: 'env-not-loaded',
    summary:
      'Prisma 7 loads no .env file: neither the CLI (`migrate`, `db`, `studio`) nor the client at runtime, which on 6 read the URL its schema named. A script that relied on it needs `dotenv` (or `--env-file`), and the app must have the variable set where the client is created',
    reported: ['finding', 'decision'],
    severity: 'deprecated',
    detect: envNotLoadedSites,
    applies: (context) => {
      const reads = schemas(context).flatMap(({ file, text }) =>
        schemaEnvReads(text).map((r) => `\`${file}:${r.line}\` reads ${r.name} with env()`),
      );
      return reads.length
        ? `Prisma 7 loads no .env file, for the CLI or for the client at runtime. On 6 the client loaded it for the URL its schema read: ${reads.join('; ')}. Make sure that variable is set where the app runs (or load the file with dotenv), and run CLI scripts with it loaded`
        : false;
    },
  },
  {
    id: 'cli-implicit-steps',
    summary:
      '`prisma migrate dev` and `migrate reset` no longer run the seed script, and `migrate dev` and `db push` no longer run `prisma generate`: run `prisma db seed` and `prisma generate` explicitly where the workflow relied on them',
    reported: ['finding', 'decision'],
    severity: 'deprecated',
    detect: implicitStepSites,
  },
  {
    id: 'connection-url-params',
    summary:
      'the v6 connection URL parameters `connection_limit`, `pool_timeout`, `connect_timeout`, `max_idle_connection_lifetime` and `max_connection_lifetime` are not read by the 7 driver adapters: set the pool on the adapter (`max`, `connectionTimeoutMillis`, `idleTimeoutMillis` for pg), whose defaults differ (pg: no connection timeout, where 6 had 5 s)',
    reported: ['finding', 'decision'],
    severity: 'deprecated',
    detect: urlParamSites,
  },
  {
    id: 'ssl-validation',
    summary:
      'with the pg driver, Prisma 7 validates the database server certificate, where 6 ignored an invalid one: a self-signed certificate now fails with P1010 unless the CA is trusted (`NODE_EXTRA_CA_CERTS`) or the adapter gets `ssl: { rejectUnauthorized: false }`',
    reported: ['decision'],
    applies: (context) =>
      schemas(context).some(({ text }) =>
        schemaProperties(text).some(
          (p) =>
            p.block === 'datasource' &&
            p.key === 'provider' &&
            /"(?:postgresql|postgres|cockroachdb)"/.test(p.value),
        ),
      ),
  },
  {
    id: 'mapped-enum-values',
    summary:
      'Prisma 7.0.0 to 7.2.x generate an enum member with `@map` as its mapped value ("pending"), where 6 and 7.3.0+ use its name ("PENDING"): target 7.3.0 or later to keep the values',
    reported: ['decision'],
    applies: (context) => {
      if (satisfies(context.to, '>=7.3.0')) return false;
      const sites = schemas(context).flatMap(({ file, text }) =>
        mappedEnumMembers(text).map((line) => `\`${file}:${line}\``),
      );
      return sites.length
        ? `Prisma ${context.to} generates mapped enum members as their @map value, unlike 6 and 7.3.0+: ${sites.join(', ')}. Target 7.3.0 or later`
        : false;
    },
  },
  {
    id: 'runtime-minimums',
    summary: 'Prisma 7 requires Node.js ^20.19, ^22.12 or >=24, and TypeScript 5.4 or later',
    reported: ['decision'],
    applies: (context) => {
      const hits = belowMinimums(context);
      return hits.length
        ? `Prisma 7 requires Node.js ^20.19 || ^22.12 || >=24 and TypeScript >=5.4: ${hits.join('; ')}`
        : false;
    },
  },
];

const base = definePack({
  meta: {
    package: '@prisma/client',
    from: '>=6 <7',
    to: '>=7 <8',
    sources: [
      { title: `Prisma ORM upgrade guide to v7, prisma/web 42f3146 (${read})`, url: GUIDE },
      { title: `Prisma ORM 7.0.0 release notes (${read})`, url: release('7.0.0') },
      {
        title: `Prisma ORM 7.3.0 release notes, mapped enums reverted (${read})`,
        url: release('7.3.0'),
      },
      {
        title: `Connection pool defaults for v7 driver adapters, prisma/web 42f3146 (${read})`,
        url: `${web}/orm/v7/prisma-client/setup-and-configuration/databases-connections/connection-pool.mdx`,
      },
      {
        title: `Environment variables in Prisma ORM 6, prisma/web 42f3146 (${read})`,
        url: `${web}/orm/v6/more/dev-environment/environment-variables.mdx`,
      },
      {
        title: `Published declarations and builds: @prisma/client 6.19.3, 7.10.1; prisma 6.19.3, 7.10.1 (${read})`,
        url: 'https://registry.npmjs.org/@prisma/client',
      },
    ],
    maintainer: 'uptide-dev',
  },
  defaultTarget: '7.10.1',
  inventory: [
    'package.json',
    '**/*.prisma',
    'prisma.config.{ts,mts,cts,js,mjs,cjs}',
    '{.nvmrc,.node-version}',
  ],
  // `prisma` and `@prisma/client` move together (the guide's "Update packages"); every adapter is
  // published at each client version and renamed its classes at 7.0.0 (RESEARCH.md).
  releaseGroup: [
    { name: 'prisma', source: `${GUIDE}#L36-L44` },
    ...[
      'pg',
      'neon',
      'planetscale',
      'd1',
      'libsql',
      'better-sqlite3',
      'mariadb',
      'mssql',
      'ppg',
    ].map((name) => ({ name: `@prisma/adapter-${name}`, source: release('7.0.0') })),
  ],
  rules,
  behavior,
  instructions:
    'Sources read 2026-10-20 (prisma/web 42f3146, release notes 7.0.0 to 7.10.1); see RESEARCH.md. Migrate only the reported site, and keep what the code does: the same database, the same connection string, the same client options. Add no dependency: when the site needs a driver adapter or dotenv the project does not have, write that into the decision for the owner. Run `prisma generate` after a schema or config change. Never cast PrismaClient options or the client to any, and never suppress a diagnostic to get a clean compile.',
});

/** A source file worth parsing: it names the client, an adapter, an entry point or a URL parameter. */
const MENTIONS =
  /PrismaClient|\$use|\$metrics|Prisma\.Middleware|@prisma\/|connection_limit|pool_timeout|connect_timeout|_connection_lifetime/;

/**
 * @prisma/client >=6 <7 → >=7 <8. `check` finds no usage of the package (its types are the
 * generated client), so the pack reads the workspace's TypeScript project itself, as well as
 * its inventory. Where a Prisma config already existed on 6, the CLI loaded no .env file then
 * either: `env-not-loaded` has nothing to report for its scripts.
 */
export const prismaClientPack: Pack = {
  ...base,
  runtimeFindings(input) {
    const inventory = input.files ?? [];
    const configured = inventory.some((f) => CONFIG.test(f));
    const sources = projectFiles(resolve(input.root, input.workspace)).files;
    const all = [...new Set([...input.usages.map((u) => u.file), ...inventory, ...sources])].sort();
    return all.flatMap((file) => {
      const text = input.read(join(input.workspace, file));
      if (text === undefined) return [];
      if (/\.[cm]?[jt]sx?$/.test(file) && !CONFIG.test(file) && !MENTIONS.test(text)) return [];
      return detected(base, { file, text, from: input.from, to: input.to }).filter(
        (f) => !(configured && f.rule === 'env-not-loaded'),
      );
    });
  },
};
