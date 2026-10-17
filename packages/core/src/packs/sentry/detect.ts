import { ts } from 'ts-morph';
import type { Finding } from '../../domain/report.js';
import type { SourceSite } from '../contract.js';
import type { TransformResult } from '../types.js';
import {
  booleanValue,
  declined,
  initOptions,
  integrationOptions,
  leadingCommentLines,
  nodes,
  objectOf,
  parse,
  propertyAt,
  propertyFor,
  propertyName,
  propertySites,
  requiredModule,
  SENTRY_MODULE,
  sentryBindings,
  sentryCallee,
  siteOf,
  unwrap,
  walk,
  withoutProperty,
  withRenamedKey,
} from './syntax.js';

const SOURCE = /\.[cm]?[jt]sx?$/;
const NEXT_CONFIG = /(?:^|\/)next\.config\.(?:js|mjs|cjs|ts|mts)$/;

/**
 * `Sentry.init` option paths found in a file, as sites. `unless` names options of the same
 * object that keep the path working (`traceLifecycle` keeps `beforeSendTransaction`): an object
 * that sets one is not reported.
 */
export function initOptionSites(paths: readonly string[], unless: readonly string[] = []) {
  return (text: string, file: string): SourceSite[] =>
    SOURCE.test(file)
      ? propertySites(
          initOptions(parse(text, file)).filter((o) => !unless.some((key) => propertyAt(o, key))),
          paths,
        )
      : [];
}

/** Option paths of the named integrations' options objects. */
export function integrationOptionSites(names: readonly string[], paths: readonly string[]) {
  return (text: string, file: string): SourceSite[] =>
    SOURCE.test(file)
      ? propertySites(
          integrationOptions(parse(text, file), names).map((i) => i.object),
          paths,
        )
      : [];
}

/**
 * Remove an init option whose literal value the target makes the default (`enableLogs: true`:
 * logs are captured whenever a logging API is used). Any other value is a decision.
 */
export function removeDefaultedOption(paths: readonly string[], value: boolean) {
  return (text: string, finding: Finding): TransformResult => {
    const source = parse(text, finding.usage.file);
    const hit = propertyFor(initOptions(source), paths, finding);
    if (!hit) return declined(text, 'the reported site is not this Sentry.init option');
    if (booleanValue(hit.property) !== value)
      return declined(
        text,
        `only a literal \`${value}\` is the target's default; another value changes what is sent`,
      );
    const object = hit.property.parent as ts.ObjectLiteralExpression;
    // `_experiments: { enableLogs: true }` alone: the whole `_experiments` goes with it.
    const parent = object.parent;
    if (hit.path.includes('.') && object.properties.length === 1 && ts.isPropertyAssignment(parent))
      return {
        text: withoutProperty(text, parent),
        applied: true,
        reason: `\`${hit.path}\` is removed; v11 does this by default`,
      };
    return {
      text: withoutProperty(text, hit.property),
      applied: true,
      reason: `\`${hit.path}\` is removed; v11 does this by default`,
    };
  };
}

/** Rename an option key of a Sentry integration, keeping its value. */
export function renameIntegrationOption(names: readonly string[], map: Record<string, string>) {
  return (text: string, finding: Finding): TransformResult => {
    const source = parse(text, finding.usage.file);
    const objects = integrationOptions(source, names).map((i) => i.object);
    const hit = propertyFor(objects, Object.keys(map), finding);
    const to = hit && map[hit.path];
    if (!hit || !to) return declined(text, 'this option has no one-to-one replacement');
    const object = hit.property.parent as ts.ObjectLiteralExpression;
    if (object.properties.some((p) => propertyName(p) === to))
      return declined(text, `\`${to}\` is already set: merge the two by hand`);
    const renamed = withRenamedKey(text, hit.property, to);
    return renamed === undefined
      ? declined(text, 'computed option name')
      : { text: renamed, applied: true, reason: `\`${hit.path}\` is \`${to}\`` };
  };
}

// --- @sentry/nextjs: withSentryConfig and its build options -------------------------------

const CONFIG_EXPORTS = new Set(['withSentryConfig', 'SentryBuildOptions']);

/** `withSentryConfig`/`SentryBuildOptions` imported or required from the main entry. */
function configImports(source: ts.SourceFile) {
  const found: { name: ts.Node; specifier: ts.StringLiteralLike; others: boolean }[] = [];
  for (const statement of source.statements)
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === '@sentry/nextjs'
    ) {
      const clause = statement.importClause;
      const bindings = clause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      const names = bindings.elements.map((e) => (e.propertyName ?? e.name).text);
      const others = names.some((n) => !CONFIG_EXPORTS.has(n)) || clause?.name !== undefined;
      for (const element of bindings.elements)
        if (CONFIG_EXPORTS.has((element.propertyName ?? element.name).text))
          found.push({
            name: element.propertyName ?? element.name,
            specifier: statement.moduleSpecifier,
            others,
          });
    }
  walk(source, (node) => {
    if (!ts.isVariableDeclaration(node) || !node.initializer) return;
    if (requiredModule(node.initializer) !== '@sentry/nextjs') return;
    if (!ts.isObjectBindingPattern(node.name)) return;
    const call = unwrap(node.initializer);
    const target = ts.isAwaitExpression(call) ? unwrap(call.expression) : call;
    const specifier = ts.isCallExpression(target) ? target.arguments[0] : undefined;
    if (!specifier || !ts.isStringLiteralLike(specifier)) return;
    const names = node.name.elements.map((e) =>
      e.propertyName && ts.isIdentifier(e.propertyName) ? e.propertyName.text : e.name.getText(),
    );
    const others = names.some((n) => !CONFIG_EXPORTS.has(n));
    for (const element of node.name.elements) {
      const name = element.propertyName ?? element.name;
      if (CONFIG_EXPORTS.has(name.getText())) found.push({ name, specifier, others });
    }
  });
  return found;
}

export function configImportSites(text: string, file: string): SourceSite[] {
  if (!SOURCE.test(file)) return [];
  return configImports(parse(text, file)).map((i) => siteOf(i.name, i.name.getText()));
}

/** `@sentry/nextjs/config` exports both names in 10.x and 11.x: only the specifier changes. */
export function moveConfigImport(text: string, finding: Finding): TransformResult {
  const hit = configImports(parse(text, finding.usage.file)).find(
    (i) => siteOf(i.name).line === finding.usage.line,
  );
  if (!hit) return declined(text, 'the reported line does not import withSentryConfig');
  if (hit.others)
    return declined(
      text,
      'the import also takes runtime exports: split it, importing only withSentryConfig from @sentry/nextjs/config',
    );
  const quote = text[hit.specifier.getStart()];
  return {
    text: `${text.slice(0, hit.specifier.getStart())}${quote}@sentry/nextjs/config${quote}${text.slice(hit.specifier.getEnd())}`,
    applied: true,
    reason: 'withSentryConfig is exported from @sentry/nextjs/config',
  };
}

/** Top-level build options removed in 11 and where each moved (MIGRATION.md, `@sentry/nextjs`). */
export const BUILD_OPTIONS: Record<string, string | undefined> = {
  autoInstrumentServerFunctions: 'webpack.autoInstrumentServerFunctions',
  autoInstrumentMiddleware: 'webpack.autoInstrumentMiddleware',
  autoInstrumentAppDirectory: 'webpack.autoInstrumentAppDirectory',
  automaticVercelMonitors: 'webpack.automaticVercelMonitors',
  excludeServerRoutes: 'webpack.excludeServerRoutes',
  disableSentryWebpackConfig: 'webpack.disableSentryConfig',
  disableLogger: 'webpack.treeshake.removeDebugLogging',
  '_experimental.turbopackApplicationKey': 'applicationKey',
  // Inverted, or gone: never moved by rule.
  disableManifestInjection: undefined,
  unstable_sentryWebpackPluginOptions: undefined,
  'webpack.unstable_sentryWebpackPluginOptions': undefined,
};

/** The build options object of each `withSentryConfig(config, options)` call. */
function buildOptions(source: ts.SourceFile): ts.ObjectLiteralExpression[] {
  const bindings = sentryBindings(source, /^@sentry\/nextjs(?:\/config)?$/);
  const found: ts.ObjectLiteralExpression[] = [];
  walk(source, (node) => {
    if (
      ts.isCallExpression(node) &&
      sentryCallee(node.expression, bindings) === 'withSentryConfig'
    ) {
      const object = objectOf(node.arguments[1], source);
      if (object) found.push(object);
    }
  });
  return found;
}

export function buildOptionSites(text: string, file: string): SourceSite[] {
  if (!NEXT_CONFIG.test(file) && !SOURCE.test(file)) return [];
  return propertySites(buildOptions(parse(text, file)), Object.keys(BUILD_OPTIONS));
}

/**
 * Move a removed top-level build option to where 11 reads it, merging into object literals
 * already there. Declines when the destination is set, or is not a literal it can read.
 */
export function moveBuildOption(text: string, finding: Finding): TransformResult {
  const source = parse(text, finding.usage.file);
  const objects = buildOptions(source);
  const hit = propertyFor(objects, Object.keys(BUILD_OPTIONS), finding);
  const to = hit && BUILD_OPTIONS[hit.path];
  if (!hit || !to)
    return declined(text, 'this option has no one-to-one replacement: see the migration guide');
  if (!ts.isPropertyAssignment(hit.property)) return declined(text, 'shorthand option value');
  const root = objects.find((o) => propertyAt(o, hit.path) === hit.property);
  if (!root) return declined(text, 'the option is not in the build options object');
  const value = hit.property.initializer.getText();
  const path = to.split('.');
  // Deepest existing object literal along the destination path.
  let container = root;
  let depth = 0;
  while (depth < path.length - 1) {
    const next = container.properties.find((p) => propertyName(p) === path[depth]);
    if (!next) break;
    if (!ts.isPropertyAssignment(next))
      return declined(text, `\`${path[depth]}\` is not a literal`);
    const inner = unwrap(next.initializer);
    if (!ts.isObjectLiteralExpression(inner))
      return declined(text, `\`${path.slice(0, depth + 1).join('.')}\` is not an object literal`);
    container = inner;
    depth++;
  }
  if (container.properties.some((p) => propertyName(p) === path[depth]))
    return declined(text, `\`${to}\` is already set: merge the two by hand`);
  const nested = path
    .slice(depth)
    .reduceRight(
      (inner, key) => (inner === value ? `${key}: ${value}` : `${key}: { ${inner} }`),
      value,
    );
  // Same object, nothing to merge into: replace the option where it stands.
  if (container === root && hit.property.parent === root) {
    const property = hit.property;
    return {
      text: text.slice(0, property.getStart()) + nested + text.slice(property.getEnd()),
      applied: true,
      reason: `\`${hit.path}\` is \`${to}\``,
    };
  }
  // Insert into the existing container, with the option's own comment lines, then remove the
  // old option (the later offset first).
  const first = container.properties[0];
  const lineStart = (pos: number) => text.lastIndexOf('\n', pos - 1) + 1;
  const ownLine = first && lineStart(first.getStart()) > container.getStart();
  const indent = ownLine
    ? (text.slice(lineStart(first.getStart()), first.getStart()).match(/^[ \t]*/)?.[0] ?? '')
    : `${text.slice(lineStart(container.getStart())).match(/^[ \t]*/)?.[0] ?? ''}  `;
  const comments = leadingCommentLines(text, hit.property)
    .map((c) => `\n${indent}${c}`)
    .join('');
  const insertAt = container.getStart() + 1;
  const insertion = `${comments}\n${indent}${nested},${ownLine || !first ? '' : `\n${indent}`}`;
  const removed = withoutProperty(text, hit.property);
  const shift = removed.length - text.length;
  const at = insertAt > hit.property.getStart() ? insertAt + shift : insertAt;
  // A one-line container continues on the next line, without the space after its brace.
  const rest = ownLine || !first ? removed.slice(at) : removed.slice(at).replace(/^[ \t]+/, '');
  return {
    text: removed.slice(0, at) + insertion + rest,
    applied: true,
    reason: `\`${hit.path}\` is \`${to}\``,
  };
}

// --- Renamed exports and integration names ------------------------------------------------

export const RENAMED_EXPORTS: Record<string, string> = {
  inboundFiltersIntegration: 'eventFiltersIntegration',
  instrumentLangGraph: 'instrumentStateGraph',
  spanToStreamedSpanJSON: 'spanToJSON',
  bfcacheIntegration: 'bfcacheMetricsIntegration',
  otlpIntegration: 'openTelemetryIntegration',
};

/** References to a renamed export: import specifiers, `Sentry.x`, and locals bound to them. */
function renamedReferences(source: ts.SourceFile) {
  const bindings = sentryBindings(source);
  const found: { node: ts.Identifier; from: string }[] = [];
  walk(source, (node) => {
    if (ts.isImportSpecifier(node)) {
      const declaration = node.parent.parent.parent;
      const from = ts.isStringLiteral(declaration.moduleSpecifier)
        ? declaration.moduleSpecifier.text
        : '';
      const imported = node.propertyName ?? node.name;
      if (SENTRY_MODULE.test(from) && ts.isIdentifier(imported) && RENAMED_EXPORTS[imported.text])
        found.push({ node: imported, from: imported.text });
      return;
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      if (
        bindings.namespaces.has(node.expression.text) &&
        ts.isIdentifier(node.name) &&
        RENAMED_EXPORTS[node.name.text]
      )
        found.push({ node: node.name, from: node.name.text });
      return;
    }
    if (ts.isIdentifier(node) && RENAMED_EXPORTS[node.text]) {
      const parent = node.parent;
      // Only an unaliased import's own binding renames with it; aliases keep their name.
      const bound = bindings.named.get(node.text);
      if (
        bound?.imported === node.text &&
        !ts.isImportSpecifier(parent) &&
        !(ts.isPropertyAccessExpression(parent) && parent.name === node) &&
        !(ts.isPropertyAssignment(parent) && parent.name === node) &&
        !ts.isBindingElement(parent)
      )
        found.push({ node, from: node.text });
    }
  });
  return found;
}

export function renamedExportSites(text: string, file: string): SourceSite[] {
  if (!SOURCE.test(file)) return [];
  const source = parse(text, file);
  // A file that declares the new name itself would collide; it stays assisted but reported.
  return renamedReferences(source).map((r) => siteOf(r.node, r.from));
}

export function renameExport(text: string, finding: Finding): TransformResult {
  const source = parse(text, finding.usage.file);
  const references = renamedReferences(source);
  const hit = references.find((r) => siteOf(r.node).line === finding.usage.line);
  if (!hit) return declined(text, 'the reported line does not use a renamed Sentry export');
  const to = RENAMED_EXPORTS[hit.from] as string;
  if (hit.from === 'otlpIntegration')
    return declined(
      text,
      'otlpIntegration lost its options and no longer sets up an exporter: configure your own exporter first',
    );
  // References to the new name are fine (a sibling site already renamed); a local declaration
  // of it, or an import of it from elsewhere, would collide.
  if (declares(source, to)) return declined(text, `\`${to}\` is already declared in this file`);
  const onLine = references.filter((r) => siteOf(r.node).line === finding.usage.line);
  let result = text;
  for (const r of onLine.sort((a, b) => b.node.getStart() - a.node.getStart()))
    result =
      result.slice(0, r.node.getStart()) + RENAMED_EXPORTS[r.from] + result.slice(r.node.getEnd());
  return { text: result, applied: true, reason: `\`${hit.from}\` is \`${to}\`` };
}

function declares(source: ts.SourceFile, name: string): boolean {
  let found = false;
  walk(source, (node) => {
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isBindingElement(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    )
      found = true;
    if (ts.isImportSpecifier(node) && node.name.text === name) {
      const from = node.parent.parent.parent.moduleSpecifier;
      if (!ts.isStringLiteral(from) || !SENTRY_MODULE.test(from.text)) found = true;
    }
  });
  return found;
}

export const RENAMED_INTEGRATIONS: Record<string, string> = {
  InboundFilters: 'EventFilters',
  OtlpIntegration: 'OpenTelemetry',
};

/**
 * Integration names compared as strings: `integration.name !== 'InboundFilters'` or
 * `getIntegrationByName('InboundFilters')`. The compiler sees a string; v11 never matches it.
 */
function integrationNameLiterals(source: ts.SourceFile): ts.StringLiteralLike[] {
  return nodes(source, ts.isStringLiteralLike).filter((literal) => {
    if (!RENAMED_INTEGRATIONS[literal.text]) return false;
    const parent = literal.parent;
    if (ts.isBinaryExpression(parent)) {
      const other = parent.left === literal ? parent.right : parent.left;
      return (
        [
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
          ts.SyntaxKind.EqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsToken,
        ].includes(parent.operatorToken.kind) &&
        ts.isPropertyAccessExpression(unwrap(other)) &&
        (unwrap(other) as ts.PropertyAccessExpression).name.text === 'name'
      );
    }
    if (ts.isCallExpression(parent))
      return (
        ts.isPropertyAccessExpression(parent.expression) &&
        parent.expression.name.text === 'getIntegrationByName'
      );
    if (ts.isArrayLiteralExpression(parent)) return true;
    return false;
  });
}

export function integrationNameSites(text: string, file: string): SourceSite[] {
  if (!SOURCE.test(file)) return [];
  const source = parse(text, file);
  if (!sentryBindings(source).namespaces.size && !sentryBindings(source).named.size) return [];
  return integrationNameLiterals(source).map((l) => siteOf(l, l.text));
}

export function renameIntegrationName(text: string, finding: Finding): TransformResult {
  const source = parse(text, finding.usage.file);
  const hits = integrationNameLiterals(source).filter((l) => siteOf(l).line === finding.usage.line);
  if (!hits.length) return declined(text, 'no renamed integration name on the reported line');
  let result = text;
  for (const literal of hits.sort((a, b) => b.getStart() - a.getStart())) {
    const quote = text[literal.getStart()];
    result = `${result.slice(0, literal.getStart())}${quote}${RENAMED_INTEGRATIONS[literal.text]}${quote}${result.slice(literal.getEnd())}`;
  }
  return {
    text: result,
    applied: true,
    reason: 'the integration reports itself under its v11 name',
  };
}

// --- Compiler-blind: span JSON read through any/unknown -------------------------------------

/** `SpanJSON` fields that `StreamedSpanJSON` renamed (MIGRATION.md, beforeSendSpan). */
const SPAN_JSON_FIELDS = new Set(['description', 'op', 'data', 'timestamp']);

/**
 * Reads of v10 span JSON fields where v11 passes the streamed format: on the parameter of a
 * `beforeSendSpan` callback, and on what `spanToJSON` returns. A callback typed `any` (or
 * declared apart from `Sentry.init`) compiles either way; the field is just undefined.
 */
function spanJsonReads(source: ts.SourceFile): ts.Node[] {
  const bindings = sentryBindings(source);
  const holders = new Set<string>();
  const roots: ts.Node[] = [];
  // Callback parameters of `beforeSendSpan`, inline or named in the same file.
  for (const object of initOptions(source)) {
    const property = object.properties.find((p) => propertyName(p) === 'beforeSendSpan');
    if (!property) continue;
    let fn: ts.Node | undefined;
    if (ts.isMethodDeclaration(property)) fn = property;
    else if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
      const value = ts.isPropertyAssignment(property)
        ? unwrap(property.initializer)
        : property.name;
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) fn = value;
      else if (ts.isIdentifier(value))
        fn =
          nodes(source, ts.isFunctionDeclaration).find((f) => f.name?.text === value.text) ??
          nodes(source, ts.isVariableDeclaration).find(
            (d) => ts.isIdentifier(d.name) && d.name.text === value.text && d.initializer,
          )?.initializer;
      else if (
        ts.isCallExpression(value) &&
        sentryCallee(value.expression, bindings) === 'withStreamedSpan'
      ) {
        const inner = value.arguments[0] && unwrap(value.arguments[0]);
        if (inner && (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner))) fn = inner;
      }
    }
    if (
      fn &&
      (ts.isArrowFunction(fn) ||
        ts.isFunctionExpression(fn) ||
        ts.isFunctionDeclaration(fn) ||
        ts.isMethodDeclaration(fn))
    ) {
      const parameter = fn.parameters[0];
      if (parameter && ts.isIdentifier(parameter.name)) {
        holders.add(parameter.name.text);
        roots.push(fn);
      }
    }
  }
  // `const json = spanToJSON(span)` and `spanToJSON(span).op`.
  const reads: ts.Node[] = [];
  walk(source, (node) => {
    if (ts.isCallExpression(node) && sentryCallee(node.expression, bindings) === 'spanToJSON') {
      const parent = node.parent;
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
        holders.add(parent.name.text);
        roots.push(parent.parent.parent.parent ?? source);
      }
      if (ts.isPropertyAccessExpression(parent) && SPAN_JSON_FIELDS.has(parent.name.text))
        reads.push(parent.name);
    }
  });
  for (const root of roots)
    walk(root, (node) => {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        holders.has(node.expression.text) &&
        SPAN_JSON_FIELDS.has(node.name.text)
      )
        reads.push(node.name);
      if (
        ts.isElementAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        holders.has(node.expression.text) &&
        ts.isStringLiteral(node.argumentExpression) &&
        SPAN_JSON_FIELDS.has(node.argumentExpression.text)
      )
        reads.push(node.argumentExpression);
      // `const { description, op } = span`
      if (
        ts.isVariableDeclaration(node) &&
        ts.isObjectBindingPattern(node.name) &&
        node.initializer &&
        ts.isIdentifier(node.initializer) &&
        holders.has(node.initializer.text)
      )
        for (const element of node.name.elements) {
          const key = (element.propertyName ?? element.name).getText();
          if (SPAN_JSON_FIELDS.has(key)) reads.push(element);
        }
    });
  return [...new Set(reads)];
}

export function spanJsonSites(text: string, file: string): SourceSite[] {
  if (!SOURCE.test(file)) return [];
  const byLine = new Map<number, SourceSite>();
  for (const node of spanJsonReads(parse(text, file))) {
    const site = siteOf(node, node.getText().replace(/['"]/g, ''));
    if (!byLine.has(site.line)) byLine.set(site.line, site);
  }
  return [...byLine.values()];
}

// --- Compiler-blind: sendFeedback rejects with an Error ----------------------------------

/**
 * A `sendFeedback` rejection handled as a string: v10 rejected with a plain string on send
 * failures, v11 always with an `Error`. The catch parameter is `unknown`/`any`: the compiler
 * accepts `typeof e === 'string'`, `${e}` or `e.includes(...)` either way.
 */
function feedbackStringHandlers(source: ts.SourceFile): ts.Node[] {
  const bindings = sentryBindings(source);
  const found: ts.Node[] = [];
  const stringUses = (body: ts.Node, name: string) => {
    walk(body, (node) => {
      const isName = (n: ts.Node) => ts.isIdentifier(n) && n.text === name;
      if (
        ts.isTypeOfExpression(node) &&
        isName(unwrap(node.expression)) &&
        ts.isBinaryExpression(node.parent) &&
        [node.parent.left, node.parent.right].some(
          (side) => ts.isStringLiteral(side) && side.text === 'string',
        )
      )
        found.push(node);
      if (ts.isTemplateSpan(node) && isName(unwrap(node.expression))) found.push(node.expression);
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
        [node.left, node.right].some((side) => isName(unwrap(side))) &&
        [node.left, node.right].some(
          (side) => ts.isStringLiteralLike(side) || ts.isTemplateExpression(side),
        )
      )
        found.push(node);
      if (
        ts.isPropertyAccessExpression(node) &&
        isName(unwrap(node.expression)) &&
        [
          'includes',
          'startsWith',
          'endsWith',
          'toLowerCase',
          'toUpperCase',
          'trim',
          'split',
          'length',
        ].includes(node.name.text)
      )
        found.push(node);
    });
  };
  walk(source, (node) => {
    if (!ts.isCallExpression(node) || sentryCallee(node.expression, bindings) !== 'sendFeedback')
      return;
    // `.catch((e) => ...)` on the call.
    const access = node.parent;
    if (
      ts.isPropertyAccessExpression(access) &&
      access.name.text === 'catch' &&
      ts.isCallExpression(access.parent)
    ) {
      const handler = access.parent.arguments[0] && unwrap(access.parent.arguments[0]);
      if (handler && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) {
        const parameter = handler.parameters[0];
        if (parameter && ts.isIdentifier(parameter.name))
          stringUses(handler.body, parameter.name.text);
      }
    }
    // `try { await sendFeedback(...) } catch (e) { ... }`.
    let up: ts.Node = node;
    while (up.parent && !ts.isFunctionLike(up.parent)) {
      if (ts.isTryStatement(up.parent) && up.parent.tryBlock === up) {
        const clause = up.parent.catchClause;
        const variable = clause?.variableDeclaration;
        if (clause && variable && ts.isIdentifier(variable.name))
          stringUses(clause.block, variable.name.text);
        break;
      }
      up = up.parent;
    }
  });
  return found;
}

export function feedbackRejectionSites(text: string, file: string): SourceSite[] {
  if (!SOURCE.test(file)) return [];
  const byLine = new Map<number, SourceSite>();
  for (const node of feedbackStringHandlers(parse(text, file))) {
    const site = siteOf(node, 'sendFeedback');
    if (!byLine.has(site.line)) byLine.set(site.line, site);
  }
  return [...byLine.values()];
}

// --- Calls to Sentry exports ---------------------------------------------------------------

/** Calls to these Sentry exports, anchored at the callee's name. */
export function callSites(
  names: readonly string[],
  accept: (call: ts.CallExpression, name: string) => boolean = () => true,
) {
  return (text: string, file: string): SourceSite[] => {
    if (!SOURCE.test(file)) return [];
    const source = parse(text, file);
    const bindings = sentryBindings(source);
    return nodes(source, ts.isCallExpression).flatMap((call) => {
      const name = sentryCallee(call.expression, bindings);
      if (!name || !names.includes(name) || !accept(call, name)) return [];
      const callee = unwrap(call.expression);
      return [siteOf(ts.isPropertyAccessExpression(callee) ? callee.name : callee, name)];
    });
  };
}

/**
 * Error-handler calls that pass options: `setupExpressErrorHandler(app, { shouldHandleError })`,
 * `setupFastifyErrorHandler(app, {...})`, `expressErrorHandler({...})`. The options moved to the
 * integration; a call without them is only deprecated.
 */
export function passesHandlerOptions(call: ts.CallExpression, name: string): boolean {
  return call.arguments.length >= (name === 'expressErrorHandler' ? 1 : 2);
}

/** `withStreamedSpan(fn)` is `fn` in v11: the wrapper is a deprecated no-op. */
export function unwrapStreamedSpan(text: string, finding: Finding): TransformResult {
  const source = parse(text, finding.usage.file);
  const bindings = sentryBindings(source);
  const call = nodes(source, ts.isCallExpression).find((c) => {
    if (sentryCallee(c.expression, bindings) !== 'withStreamedSpan') return false;
    const callee = unwrap(c.expression);
    return (
      siteOf(ts.isPropertyAccessExpression(callee) ? callee.name : callee).line ===
      finding.usage.line
    );
  });
  if (call?.arguments.length !== 1 || !call.arguments[0])
    return declined(text, 'not a single-argument withStreamedSpan call');
  return {
    text: text.slice(0, call.getStart()) + call.arguments[0].getText() + text.slice(call.getEnd()),
    applied: true,
    reason: 'withStreamedSpan is a no-op in v11: the callback already receives streamed spans',
  };
}

// --- Modules and preloads -----------------------------------------------------------------

/** Imports and requires of modules v11 no longer publishes. */
export const REMOVED_MODULES =
  /^@sentry\/(?:types|node-core(?:\/.*)?|[\w-]+\/(?:loader|preload|init)|bundler-plugins\/webpack5|cloudflare\/nodejs_compat)$/;

export function removedModuleSites(text: string, file: string): SourceSite[] {
  if (!SOURCE.test(file)) return [];
  const source = parse(text, file);
  const sites: SourceSite[] = [];
  walk(source, (node) => {
    let specifier: ts.Expression | undefined;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      specifier = node.moduleSpecifier;
    else if (ts.isCallExpression(node) && requiredModule(node)) specifier = node.arguments[0];
    if (specifier && ts.isStringLiteralLike(specifier) && REMOVED_MODULES.test(specifier.text))
      sites.push(siteOf(node, specifier.text));
  });
  return sites;
}

/**
 * package.json scripts that preload Sentry with `--require`/`-r` (no longer initializes) or
 * through a removed `@sentry/x/preload|init|loader` entry point.
 */
export function preloadSites(text: string, file: string): SourceSite[] {
  if (!/(?:^|\/)package\.json$/.test(file)) return [];
  // Line by line inside "scripts", so each site is the line that declares the script.
  const lines = text.split('\n');
  const open = lines.findIndex((line) => /^\s*"scripts"\s*:\s*\{/.test(line));
  if (open < 0) return [];
  const sites: SourceSite[] = [];
  for (let i = open + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\s*\}/.test(line)) break;
    const script = /^(\s*)"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(line);
    if (!script) continue;
    const value = script[3] ?? '';
    const required = [...value.matchAll(/(?:--require|-r)[ =](\S+)/g)].map((m) => m[1] ?? '');
    const sentry =
      required.some((m) => /sentry|instrument/i.test(m)) ||
      /@sentry\/[\w-]+\/(?:preload|init|loader)\b/.test(value);
    if (sentry)
      sites.push({
        line: i + 1,
        column: (script[1] ?? '').length + 1,
        snippet: line.trim(),
        name: script[2] ?? '',
      });
  }
  return sites;
}
