import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ts } from 'ts-morph';
import { filesImporting, projectFiles } from '../../check/importers.js';
import { isTestFile } from '../../fix/test-edits.js';
import { bundledHost } from '../../fix/verify.js';
import { packInventory } from '../inventory.js';
import type { RecordSite } from '../records.js';
import { INVENTORY, LOCKSTEP, NEXT_INVENTORY } from './meta.js';
import { initOptions, propertyName, sentryBindings, sentryCallee, unwrap, walk } from './syntax.js';

/** The guide's v10 baseline for headers and query parameters: these keys are never sent. */
const SCRUBBED = ['forwarded', '-ip', 'remote-', 'via', '-user'];
const SOURCE = /\.[cm]?[jt]sx?$/;
/** The options a typed spread may set that decide whether an init is a site. */
const SPREAD_KEYS = ['dataCollection', 'sendDefaultPii', 'enabled'];

/**
 * The `Sentry.init` options of one workspace whose data collection widens on v11 (record
 * `data-collection-defaults`), resolved with the type checker through imports, consts and the
 * function that returns the options.
 *
 * - `before`: options with no `dataCollection` and `sendDefaultPii` not `true`, the v10
 *   restrictive default. A computed `sendDefaultPii` is a decision; a spread the checker cannot
 *   see, `enabled: false` and test files are no site.
 * - `after`: options whose `dataCollection` is missing, collects more than the guide's
 *   baseline in any category (a cookie deny list, an unset `queues`, a value the checker cannot
 *   see) or leaves `frameContextLines` at v11's 5. Those sites stay open, so a partial edit is
 *   never reported as kept.
 */
export function dataCollectionSites(input: {
  root: string;
  workspace: string;
  phase: 'before' | 'after';
}): Omit<RecordSite, 'record'>[] {
  const dir = resolve(input.root, input.workspace);
  const { files, options } = projectFiles(dir);
  // Every file that imports an SDK, in a tsconfig or not (a Vite app's `tsconfig.app.json`),
  // and the config files the pack reads; never a nested package's own files.
  const importing = filesImporting(dir, LOCKSTEP);
  const extra = packInventory(input.root, input.workspace, [...INVENTORY, ...NEXT_INVENTORY]);
  const names = [...new Set([...files, ...importing, ...extra])].filter(
    // A test's init sends nothing anywhere a user is: no site.
    (f) =>
      SOURCE.test(f) &&
      !isTestFile(f) &&
      !nested(dir, f) &&
      read(join(dir, f)).includes('@sentry/'),
  );
  if (!names.length) return [];
  const programOptions = { ...options, allowJs: true, noEmit: true, skipLibCheck: true };
  // ts-morph's own libs: `import('@sentry/react').then(…)` needs Promise to resolve `init`.
  const program = ts.createProgram({
    rootNames: names.map((f) => join(dir, f)),
    options: programOptions,
    host: bundledHost(programOptions),
  });
  const checker = program.getTypeChecker();
  const declared = (symbol: ts.Symbol | undefined) => {
    const s =
      symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const d = s?.valueDeclaration;
    return d && ts.isVariableDeclaration(d) && d.initializer ? d.initializer : undefined;
  };
  /** The expression a value comes from: through consts, imports and a single `return`. */
  const value = (node: ts.Expression | undefined, depth = 0): ts.Expression | undefined => {
    if (!node || depth > 8) return undefined;
    const e = unwrap(node);
    if (ts.isIdentifier(e)) return value(declared(checker.getSymbolAtLocation(e)), depth + 1);
    if (ts.isCallExpression(e)) {
      const d = checker.getResolvedSignature(e)?.declaration;
      if (!d || !('body' in d) || !d.body) return undefined;
      if (!ts.isBlock(d.body)) return value(d.body, depth + 1);
      const returns: ts.Expression[] = [];
      const visit = (n: ts.Node): void => {
        if (ts.isReturnStatement(n) && n.expression) returns.push(n.expression);
        else if (!ts.isFunctionLike(n)) ts.forEachChild(n, visit);
      };
      visit(d.body);
      return returns.length === 1 ? value(returns[0], depth + 1) : undefined;
    }
    return e;
  };
  const object = (node: ts.Expression | undefined) => {
    const v = value(node);
    return v && ts.isObjectLiteralExpression(v) ? v : undefined;
  };
  /** A property's value, `{ dataCollection }` shorthand included. */
  const propertyValue = (p: ts.ObjectLiteralElementLike): ts.Expression | undefined =>
    ts.isPropertyAssignment(p)
      ? value(p.initializer)
      : ts.isShorthandPropertyAssignment(p)
        ? value(declared(checker.getShorthandAssignmentValueSymbol(p)))
        : undefined;
  /** `init(…)` declared by an installed Sentry SDK: `import('@sentry/react').then(({ init }) => …)`. */
  const sentryInit = (call: ts.CallExpression) => {
    const callee = call.expression;
    const name = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : undefined;
    const file =
      name === 'init' && checker.getResolvedSignature(call)?.declaration?.getSourceFile();
    return !!file && /[\\/]node_modules[\\/]@sentry[\\/]/.test(file.fileName);
  };
  /** The objects a spread may add: both sides of `a ? {…} : {…}`, the right of `a && {…}`. */
  const spread = (node: ts.Expression): ts.ObjectLiteralExpression[] | undefined => {
    const e = unwrap(node);
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
      return spread(e.right);
    if (ts.isConditionalExpression(e)) {
      const a = spread(e.whenTrue);
      const b = spread(e.whenFalse);
      return a && b && [...a, ...b];
    }
    const o = object(e);
    return o && [o];
  };
  /**
   * An options object's properties with resolved spreads merged in, later keys winning;
   * undefined when a spread cannot be seen and the object does not set `dataCollection` itself.
   */
  const spreadInto = new Set<ts.ObjectLiteralExpression>();
  const properties = (o: ts.ObjectLiteralExpression, depth = 0) => {
    const own = new Map<string, ts.ObjectLiteralElementLike>();
    let hidden = false;
    for (const p of o.properties) {
      if (ts.isSpreadAssignment(p)) {
        const inner = depth < 4 ? spread(p.expression) : undefined;
        const merged = inner?.map((i) => properties(i, depth + 1));
        if (!inner || !merged || merged.some((m) => !m)) {
          // A value the checker types but cannot follow (`...config`) adds only what its type
          // declares: those keys are unknown, the rest are not there.
          const type = checker.getTypeAtLocation(p.expression);
          if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) hidden = true;
          else for (const k of SPREAD_KEYS) if (type.getProperty(k)) own.set(k, p);
        } else
          for (const [i, m] of inner.entries()) {
            spreadInto.add(m);
            for (const [k, v] of merged[i] ?? []) own.set(k, v);
          }
        continue;
      }
      const name = propertyName(p);
      if (name) own.set(name, p);
    }
    return hidden && !own.has('dataCollection') ? undefined : own;
  };

  const found = new Map<ts.ObjectLiteralExpression, ts.SourceFile>();
  for (const name of names) {
    const source = program.getSourceFile(join(dir, name));
    if (!source) continue;
    for (const o of initOptions(source)) found.set(o, source);
    const bindings = sentryBindings(source);
    walk(source, (node) => {
      if (
        ts.isCallExpression(node) &&
        (sentryCallee(node.expression, bindings) === 'init' || sentryInit(node))
      ) {
        const o = object(node.arguments[0]);
        if (o) found.set(o, o.getSourceFile());
      }
    });
  }
  const sites: (Omit<RecordSite, 'record'> & { object: ts.ObjectLiteralExpression })[] = [];
  for (const [o, source] of found) {
    const props = properties(o);
    if (!props) continue;
    const file = source.fileName.startsWith(`${dir}/`)
      ? source.fileName.slice(dir.length + 1)
      : undefined;
    if (!file) continue;
    const { line } = source.getLineAndCharacterOfPosition(o.getStart(source));
    const at = {
      object: o,
      file,
      line: line + 1,
      snippet: source.text.split('\n')[line]?.trim() ?? '',
    };
    const enabled = props.get('enabled');
    if (enabled && propertyValue(enabled)?.kind === ts.SyntaxKind.FalseKeyword) continue;
    const collection = props.get('dataCollection');
    if (input.phase === 'after') {
      if (!collection || !baseline(propertyValue(collection))) sites.push(at);
      continue;
    }
    if (collection) continue; // The owner chose a collection on v10 already.
    const pii = props.get('sendDefaultPii');
    const flag = pii && propertyValue(pii);
    if (flag?.kind === ts.SyntaxKind.TrueKeyword) continue; // v11's default is what it collected.
    if (pii && flag?.kind !== ts.SyntaxKind.FalseKeyword) {
      sites.push({
        ...at,
        decision: true,
        decisionReason: `sendDefaultPii is computed here (\`${pii.getText()}\`): keep the dataCollection baseline where it was false, drop it where it was true`,
      });
      continue;
    }
    sites.push(
      pii ? { ...at, edit: 'replace sendDefaultPii: false with the dataCollection baseline' } : at,
    );
  }
  // A typed options object spread into another one is part of that one's site, not its own.
  return sites.filter((s) => !spreadInto.has(s.object)).map(({ object: _, ...s }) => s);

  /** At least as restrictive as the guide's v10 baseline in every category, v10's context lines kept. */
  function baseline(node: ts.Expression | undefined): boolean {
    const o = node && ts.isObjectLiteralExpression(node) ? node : undefined;
    if (!o) return false;
    const get = (from: ts.ObjectLiteralExpression, key: string) => {
      const p = from.properties.find((q) => propertyName(q) === key);
      return p && propertyValue(p);
    };
    const off = (e: ts.Expression | undefined) => e?.kind === ts.SyntaxKind.FalseKeyword;
    const scrubbed = (e: ts.Expression | undefined): boolean => {
      if (off(e)) return true;
      if (!e || !ts.isObjectLiteralExpression(e)) return false;
      const deny = get(e, 'deny');
      const keys = deny && ts.isArrayLiteralExpression(deny) ? strings(deny) : [];
      return SCRUBBED.every((k) => keys.includes(k));
    };
    const pair = (key: string, a: string, b: string) => {
      const e = get(o, key);
      return !!e && ts.isObjectLiteralExpression(e) && off(get(e, a)) && off(get(e, b));
    };
    const headers = get(o, 'httpHeaders');
    const bodies = get(o, 'httpBodies');
    return (
      off(get(o, 'userInfo')) &&
      off(get(o, 'cookies')) &&
      (scrubbed(headers) ||
        (!!headers &&
          ts.isObjectLiteralExpression(headers) &&
          scrubbed(get(headers, 'request')) &&
          scrubbed(get(headers, 'response')))) &&
      !!bodies &&
      ts.isArrayLiteralExpression(bodies) &&
      bodies.elements.length === 0 &&
      scrubbed(get(o, 'urlQueryParams')) &&
      pair('genAI', 'inputs', 'outputs') &&
      off(get(o, 'databaseQueryData')) &&
      off(get(o, 'queues')) &&
      pair('graphQL', 'document', 'variables') &&
      // v10's seven lines of source context (v11 defaults to five): the edit is exact only with it.
      get(o, 'frameContextLines')?.getText() === '7'
    );
  }

  /** The string literals of an array, spreads of const arrays included. */
  function strings(array: ts.ArrayLiteralExpression, depth = 0): string[] {
    return array.elements.flatMap((e) => {
      if (ts.isStringLiteralLike(e)) return [e.text];
      if (ts.isSpreadElement(e) && depth < 4) {
        const inner = value(e.expression);
        return inner && ts.isArrayLiteralExpression(inner) ? strings(inner, depth + 1) : [];
      }
      return [];
    });
  }
}

function read(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** Under a directory of `dir` with its own package.json: another workspace's file. */
function nested(dir: string, file: string): boolean {
  for (let at = dirname(file); at !== '.' && at !== '/'; at = dirname(at))
    if (existsSync(join(dir, at, 'package.json'))) return true;
  return false;
}
