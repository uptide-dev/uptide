import { ts } from 'ts-morph';
import type { Finding } from '../../domain/report.js';
import type { SourceSite } from '../contract.js';
import type { TransformResult } from '../types.js';

/**
 * Where the Prisma 7 changes live. `check` sees no usage of `@prisma/client` (its types are the
 * generated client: RESEARCH.md), so every site is found here, in a Prisma schema, a
 * package.json, a Prisma config, or a source file that constructs or calls the client.
 */

const SOURCE = /\.[cm]?[jt]sx?$/;
const SCHEMA = /\.prisma$/;
const MANIFEST = /(?:^|\/)package\.json$/;
export const CONFIG = /(?:^|\/)prisma\.config\.[cm]?[jt]s$/;

const site = (line: number, column: number, snippet: string, name?: string): SourceSite => ({
  line,
  column,
  snippet: snippet.trim(),
  ...(name ? { name } : {}),
});

// --- schema.prisma ---------------------------------------------------------------------

interface SchemaProperty {
  block: 'datasource' | 'generator';
  key: string;
  value: string;
  line: number;
  column: number;
  text: string;
}

/** The properties of each `datasource` and `generator` block, line by line, comments dropped. */
export function schemaProperties(text: string): SchemaProperty[] {
  const out: SchemaProperty[] = [];
  let block: SchemaProperty['block'] | undefined;
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\s*\/\/.*$/, '');
    const open = /^\s*(datasource|generator)\s+\w+\s*\{\s*$/.exec(line);
    if (open) block = open[1] as SchemaProperty['block'];
    else if (block && /^\s*\}/.test(line)) block = undefined;
    else if (block) {
      const prop = /^(\s*)(\w+)\s*=\s*(.+?)\s*$/.exec(line);
      if (prop)
        out.push({
          block,
          key: prop[2] as string,
          value: prop[3] as string,
          line: i + 1,
          column: (prop[1] ?? '').length + 1,
          text: raw,
        });
    }
  });
  return out;
}

function schemaSites(test: (p: SchemaProperty) => boolean) {
  return (text: string, file: string): SourceSite[] =>
    SCHEMA.test(file)
      ? schemaProperties(text)
          .filter(test)
          .map((p) => site(p.line, p.column, p.text, p.key))
      : [];
}

export const datasourceUrlSites = schemaSites(
  (p) => p.block === 'datasource' && /^(?:url|directUrl|shadowDatabaseUrl)$/.test(p.key),
);
export const mongodbSites = schemaSites(
  (p) => p.block === 'datasource' && p.key === 'provider' && p.value === '"mongodb"',
);
export const clientJsSites = schemaSites(
  (p) => p.block === 'generator' && p.key === 'provider' && p.value === '"prisma-client-js"',
);
export const engineTypeSites = schemaSites(
  (p) => p.block === 'generator' && p.key === 'engineType',
);
const metricsPreviewSites = schemaSites(
  (p) => p.block === 'generator' && p.key === 'previewFeatures' && /"metrics"/.test(p.value),
);

/** `env("NAME")` reads in a datasource: where the app read its URL on 6. */
export function schemaEnvReads(text: string): { line: number; name: string }[] {
  return schemaProperties(text)
    .filter((p) => p.block === 'datasource')
    .flatMap((p) => {
      const env = /env\(\s*"([^"]+)"\s*\)/.exec(p.value);
      return env ? [{ line: p.line, name: env[1] as string }] : [];
    });
}

/** Enum members with `@map`: their runtime value changed in 7.0.0–7.2.x only. */
export function mappedEnumMembers(text: string): number[] {
  const lines: number[] = [];
  let inEnum = false;
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\s*\/\/.*$/, '');
    if (/^\s*enum\s+\w+\s*\{/.test(line)) inEnum = true;
    else if (inEnum && /^\s*\}/.test(line)) inEnum = false;
    else if (inEnum && /^\s*\w+\s+@map\(/.test(line)) lines.push(i + 1);
  });
  return lines;
}

// --- package.json ----------------------------------------------------------------------

interface Script {
  line: number;
  column: number;
  name: string;
  value: string;
  text: string;
}

/** Each script of the top-level `scripts` object, on the line that declares it. */
export function scripts(text: string): Script[] {
  const lines = text.split('\n');
  const open = lines.findIndex(
    (line, i) => /^\s*"scripts"\s*:\s*\{/.test(line) && depthAt(lines, i) === 1,
  );
  if (open < 0) return [];
  const out: Script[] = [];
  for (let i = open + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\s*\}/.test(line)) break;
    const m = /^(\s*)"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(line);
    if (m)
      out.push({
        line: i + 1,
        column: (m[1] ?? '').length + 1,
        name: m[2] as string,
        value: m[3] as string,
        text: line,
      });
  }
  return out;
}

/** JSON object depth at the start of line `index` (strings skipped). */
function depthAt(lines: string[], index: number): number {
  let depth = 0;
  for (const line of lines.slice(0, index))
    for (const token of line.replace(/"(?:[^"\\]|\\.)*"/g, '""').matchAll(/[{}]/g))
      depth += token[0] === '{' ? 1 : -1;
  return depth;
}

/** The `prisma …` commands of a script, each as its arguments (`db push --skip-generate`). */
export function prismaCommands(value: string): string[] {
  return value.split(/&&|\|\||;|\|/).flatMap((part) => {
    const m =
      /(?:^|\s)(?:(?:npx|bunx|pnpx)\s+(?:--?\S+\s+)*|(?:pnpm|yarn|bun)\s+(?:exec\s+|dlx\s+|x\s+)?|\S*node_modules\/\.bin\/)?prisma\s+(.*)$/.exec(
        part.trim(),
      );
    return m ? [(m[1] ?? '').trim()] : [];
  });
}

/** A database command of the CLI: it needs the datasource URL. */
const DB_COMMAND =
  /^(?:migrate\s+(?:dev|deploy|reset|status|resolve|diff)|db\s+(?:push|pull|seed|execute)|studio)\b/;
/** Loads an env file before the command: dotenv-cli, Node's flag, env-cmd, Bun. */
const LOADS_ENV = /\bdotenv(?:x)?\b|--env-file|\benv-cmd\b|(?:^|\s)bunx?\s/;

export function envNotLoadedSites(text: string, file: string): SourceSite[] {
  if (!MANIFEST.test(file)) return [];
  return scripts(text)
    .filter(
      (s) => !LOADS_ENV.test(s.value) && prismaCommands(s.value).some((c) => DB_COMMAND.test(c)),
    )
    .map((s) => site(s.line, s.column, s.text, s.name));
}

/** `migrate dev`/`migrate reset` without `--skip-seed`, `migrate dev`/`db push` without `--skip-generate`. */
export function implicitStepSites(text: string, file: string): SourceSite[] {
  if (!MANIFEST.test(file)) return [];
  const implicit = (command: string) =>
    (/^migrate\s+(?:dev|reset)\b/.test(command) && !/--skip-seed\b/.test(command)) ||
    (/^(?:migrate\s+dev|db\s+push)\b/.test(command) && !/--skip-generate\b/.test(command));
  return scripts(text)
    .filter((s) => {
      const commands = prismaCommands(s.value);
      // A script that runs `prisma generate` itself after the command does not rely on it.
      return commands.some(implicit) && !commands.some((c, i) => i > 0 && /^generate\b/.test(c));
    })
    .map((s) => site(s.line, s.column, s.text, s.name));
}

const SKIP_FLAG = /--skip-(?:generate|seed)\b/;

export function skipFlagSites(text: string, file: string): SourceSite[] {
  if (!MANIFEST.test(file)) return [];
  return scripts(text)
    .filter((s) =>
      prismaCommands(s.value).some(
        (c) => /^(?:migrate\s+dev|db\s+push)\b/.test(c) && SKIP_FLAG.test(c),
      ),
    )
    .map((s) => site(s.line, s.column, s.text, s.name));
}

/**
 * 7 neither generates after `migrate dev`/`db push` nor seeds after `migrate dev`, which is what
 * the flags turned off: without them the command does what it did. Only the flags go.
 */
export function rewriteSkipFlags(text: string, finding: Pick<Finding, 'usage'>): TransformResult {
  const script = scripts(text).find((s) => s.line === finding.usage.line);
  if (!script) return { text, applied: false, reason: 'the reported line is not a script' };
  // Every skip flag of the script must belong to `migrate dev` or `db push`.
  const count = (s: string) => s.match(/--skip-(?:generate|seed)\b/g)?.length ?? 0;
  const owned = prismaCommands(script.value)
    .filter((c) => /^(?:migrate\s+dev|db\s+push)\b/.test(c))
    .reduce((n, c) => n + count(c), 0);
  if (owned === 0 || owned !== count(script.value))
    return { text, applied: false, reason: 'a skip flag on another command: drop it by hand' };
  const lines = text.split('\n');
  const index = finding.usage.line - 1;
  const value = script.value.replace(/\s--skip-(?:generate|seed)\b/g, '');
  lines[index] = (lines[index] ?? '').replace(`"${script.value}"`, `"${value}"`);
  return {
    text: lines.join('\n'),
    applied: true,
    reason: '`--skip-generate` and `--skip-seed` are gone: 7 never generates or seeds there',
  };
}

const REMOVED_FLAGS =
  /^(?:db\s+execute\b.*--(?:schema|url)\b|migrate\s+diff\b.*--(?:(?:from|to)-(?:url|schema-datasource|schema-datamodel|local-d1)|shadow-database-url)\b|generate\b.*--(?:data-proxy|accelerate|no-engine|allow-no-models)\b|db\s+pull\b.*--(?:local-d1|url)\b|introspect\b)/;
const REMOVED_ENV =
  /\bPRISMA_(?:CLI_QUERY_ENGINE_TYPE|CLIENT_ENGINE_TYPE|QUERY_ENGINE_BINARY|QUERY_ENGINE_LIBRARY|GENERATE_SKIP_AUTOINSTALL|SKIP_POSTINSTALL_GENERATE|GENERATE_IN_POSTINSTALL|GENERATE_DATAPROXY|GENERATE_NO_ENGINE|CLIENT_NO_RETRY|MIGRATE_SKIP_GENERATE|MIGRATE_SKIP_SEED)=/;

export function removedFlagSites(text: string, file: string): SourceSite[] {
  if (!MANIFEST.test(file)) return [];
  return scripts(text)
    .filter(
      (s) =>
        REMOVED_ENV.test(s.value) || prismaCommands(s.value).some((c) => REMOVED_FLAGS.test(c)),
    )
    .map((s) => site(s.line, s.column, s.text, s.name));
}

/** The top-level `"prisma"` object (`schema`, `seed`): 7 ignores it. */
export function packageJsonPrismaSites(text: string, file: string): SourceSite[] {
  if (!MANIFEST.test(file)) return [];
  const lines = text.split('\n');
  return lines.flatMap((line, i) =>
    /^\s*"prisma"\s*:\s*\{/.test(line) && depthAt(lines, i) === 1
      ? [site(i + 1, line.search(/\S/) + 1, line, 'prisma')]
      : [],
  );
}

// --- TypeScript and JavaScript ---------------------------------------------------------

function parse(text: string, file: string): ts.SourceFile {
  const kind = /\.[cm]?jsx?$/.test(file)
    ? ts.ScriptKind.JSX
    : /\.tsx$/.test(file)
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

function nodeSite(node: ts.Node, name?: string): SourceSite {
  const source = node.getSourceFile();
  const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return site(line + 1, character + 1, source.text.split('\n')[line] ?? '', name);
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

function unwrap(node: ts.Expression): ts.Expression {
  let e = node;
  while (
    ts.isParenthesizedExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isAwaitExpression(e) ||
    ts.isNonNullExpression(e) ||
    ts.isSatisfiesExpression(e)
  )
    e = e.expression;
  return e;
}

/** A module a Prisma client comes from: `@prisma/client`, a generated client, a local re-export. */
const CLIENT_MODULE = /prisma|generated|(?:^|\/)client(?:\/index)?(?:\.[cm]?[jt]s)?$/i;

/** The string a module specifier is: a literal, or a variable of this file initialized with one. */
function specifierText(source: ts.SourceFile, node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (!ts.isIdentifier(node)) return undefined;
  let found: string | undefined;
  walk(source, (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === node.text &&
      n.initializer &&
      ts.isStringLiteralLike(n.initializer)
    )
      found = n.initializer.text;
  });
  return found;
}

/** `require(x)` or `import(x)`, through `await`, parentheses and casts. */
function loadedModule(source: ts.SourceFile, node: ts.Expression): string | undefined {
  const e = unwrap(node);
  if (!ts.isCallExpression(e)) return undefined;
  const isRequire = ts.isIdentifier(e.expression) && e.expression.text === 'require';
  const isImport = e.expression.kind === ts.SyntaxKind.ImportKeyword;
  return isRequire || isImport ? specifierText(source, e.arguments[0]) : undefined;
}

/** Local names bound to a Prisma `PrismaClient` class: imported, required or dynamically imported. */
function clientNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  walk(source, (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      CLIENT_MODULE.test(node.moduleSpecifier.text)
    ) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings))
        for (const el of bindings.elements)
          if ((el.propertyName ?? el.name).text === 'PrismaClient') names.add(el.name.text);
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isObjectBindingPattern(node.name)
    ) {
      const from = loadedModule(source, node.initializer);
      if (from === undefined || !CLIENT_MODULE.test(from)) return;
      for (const el of node.name.elements) {
        const imported = el.propertyName ?? el.name;
        if (
          ts.isIdentifier(imported) &&
          imported.text === 'PrismaClient' &&
          ts.isIdentifier(el.name)
        )
          names.add(el.name.text);
      }
    }
  });
  return names;
}

const propertyName = (p: ts.ObjectLiteralElementLike): string | undefined =>
  p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : undefined;

/**
 * `new PrismaClient(…)` that 7 rejects: no options, or options with neither `adapter` nor
 * `accelerateUrl`. The site is a `datasources`/`datasourceUrl` property when there is one (what
 * the adapter replaces), else the `new`. Options the file builds elsewhere, or spreads, are not
 * read: those are not sites.
 */
export function clientAdapterSites(text: string, file: string): SourceSite[] {
  if (!SOURCE.test(file) || !text.includes('PrismaClient')) return [];
  const source = parse(text, file);
  const names = clientNames(source);
  if (names.size === 0) return [];
  const sites: SourceSite[] = [];
  walk(source, (node) => {
    if (
      !ts.isNewExpression(node) ||
      !ts.isIdentifier(node.expression) ||
      !names.has(node.expression.text)
    )
      return;
    const options = node.arguments?.[0];
    if (!options) {
      sites.push(nodeSite(node, 'PrismaClient'));
      return;
    }
    if (!ts.isObjectLiteralExpression(options)) return;
    if (options.properties.some((p) => ts.isSpreadAssignment(p))) return;
    const keys = options.properties.map(propertyName);
    if (keys.includes('adapter') || keys.includes('accelerateUrl')) return;
    const datasource = options.properties.find((p) =>
      ['datasources', 'datasourceUrl'].includes(propertyName(p) ?? ''),
    );
    sites.push(
      datasource ? nodeSite(datasource, propertyName(datasource)) : nodeSite(node, 'PrismaClient'),
    );
  });
  return sites;
}

/** `client.$use((params, next) => …)`: the removed middleware API, and `Prisma.Middleware`. */
export function middlewareSites(text: string, file: string): SourceSite[] {
  if (!SOURCE.test(file) || !/\$use\b|\bMiddleware\b/.test(text)) return [];
  const sites: SourceSite[] = [];
  walk(parse(text, file), (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === '$use' &&
      node.arguments.length === 1
    )
      sites.push(nodeSite(node, '$use'));
    if (
      ts.isQualifiedName(node) &&
      ts.isIdentifier(node.left) &&
      node.left.text === 'Prisma' &&
      node.right.text === 'Middleware'
    )
      sites.push(nodeSite(node, 'Prisma.Middleware'));
  });
  return sites;
}

/** `client.$metrics` and `previewFeatures = ["metrics"]`. */
export function metricsSites(text: string, file: string): SourceSite[] {
  if (SCHEMA.test(file)) return metricsPreviewSites(text, file);
  if (!SOURCE.test(file) || !text.includes('$metrics')) return [];
  const sites: SourceSite[] = [];
  walk(parse(text, file), (node) => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === '$metrics')
      sites.push(nodeSite(node, '$metrics'));
  });
  return sites;
}

/** Entry points `@prisma/client` 7 no longer exports (its `package.json` `exports`). */
export const REMOVED_ENTRYPOINT =
  /^@prisma\/client\/(?:wasm|react-native|generator-build|runtime\/(?:library|binary|edge|react-native|wasm-engine-edge))(?:\.js)?$/;

export function removedEntrypointSites(text: string, file: string): SourceSite[] {
  if (!SOURCE.test(file) || !text.includes('@prisma/client/')) return [];
  const source = parse(text, file);
  const sites: SourceSite[] = [];
  walk(source, (node) => {
    let specifier: string | undefined;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
      specifier = ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
    else if (ts.isCallExpression(node)) specifier = loadedModule(source, node);
    else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      specifier = node.argument.literal.text;
    if (specifier !== undefined && REMOVED_ENTRYPOINT.test(specifier))
      sites.push(nodeSite(node, specifier));
  });
  return sites;
}

/** Adapter classes 7.0.0 renamed (release notes); 6.19 exports only the old names. */
export const ADAPTER_RENAMES: Record<string, string> = {
  PrismaBetterSQLite3: 'PrismaBetterSqlite3',
  PrismaD1HTTP: 'PrismaD1Http',
  PrismaLibSQL: 'PrismaLibSql',
  PrismaNeonHTTP: 'PrismaNeonHttp',
};

export function adapterRenameSites(text: string, file: string): SourceSite[] {
  if (!SOURCE.test(file) || !text.includes('@prisma/adapter-')) return [];
  const sites: SourceSite[] = [];
  walk(parse(text, file), (node) => {
    if (
      !ts.isImportDeclaration(node) ||
      !ts.isStringLiteral(node.moduleSpecifier) ||
      !node.moduleSpecifier.text.startsWith('@prisma/adapter-')
    )
      return;
    const bindings = node.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings))
      for (const el of bindings.elements) {
        const name = (el.propertyName ?? el.name).text;
        if (ADAPTER_RENAMES[name]) sites.push(nodeSite(el, name));
      }
  });
  return sites;
}

/** v6 connection URL parameters the v7 driver adapters do not read (connection pool page). */
const URL_PARAM =
  /[?&](?:connection_limit|pool_timeout|connect_timeout|max_idle_connection_lifetime|max_connection_lifetime)=/;

export function urlParamSites(text: string, file: string): SourceSite[] {
  if (!SOURCE.test(file) || !URL_PARAM.test(text)) return [];
  return text.split('\n').flatMap((line, i) => {
    const at = line.search(URL_PARAM);
    return at >= 0 && !/^\s*(?:\/\/|\*)/.test(line) ? [site(i + 1, at + 1, line)] : [];
  });
}

/** `engine` and `adapter` in a Prisma config: removed in 7. */
export function configOptionSites(text: string, file: string): SourceSite[] {
  if (!CONFIG.test(file)) return [];
  const sites: SourceSite[] = [];
  walk(parse(text, file), (node) => {
    const config =
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'defineConfig'
        ? node.arguments[0]
        : ts.isExportAssignment(node)
          ? unwrap(node.expression)
          : undefined;
    if (config && ts.isObjectLiteralExpression(config))
      for (const p of config.properties) {
        const name = propertyName(p);
        if (name === 'engine' || name === 'adapter') sites.push(nodeSite(p, name));
      }
  });
  return sites;
}
