import { ts } from 'ts-morph';
import type { FixDiagnostic, FixtureProperty } from './types.js';

export const isTestFile = (file: string): boolean =>
  /(?:^|\/)(?:__tests__|tests?|specs?)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);

/** The properties a TS2739/TS2740/TS2741 diagnostic says an object lacks. */
function missingNames(d: FixDiagnostic): string[] {
  const list =
    d.code === 2741
      ? d.message.match(/^Property '([^']+)' is missing/)?.[1]
      : d.code === 2739 || d.code === 2740
        ? d.message.match(
            /missing the following properties from type '.*': (.*?)(?:, and \d+ more)?\.?$/,
          )?.[1]
        : undefined;
  return list?.split(', ') ?? [];
}

/**
 * The object literal a diagnostic is anchored to. The compiler puts it on the literal itself (an
 * array element), on the name it initializes (`const s: Span = {…}`, `span: {…}`) or on the
 * `return` that returns it.
 */
function pointedAt(source: ts.SourceFile, offset: number): ts.ObjectLiteralExpression | undefined {
  let at: ts.Node = source;
  const find = (node: ts.Node): void => {
    if (node.getStart(source) <= offset && offset < node.end) {
      at = node;
      ts.forEachChild(node, find);
    }
  };
  ts.forEachChild(source, find);
  const parent = at.parent;
  const target =
    ts.isObjectLiteralExpression(at) || ts.isReturnStatement(at)
      ? at
      : parent &&
          (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) &&
          parent.name === at
        ? parent.initializer
        : undefined;
  const object = target && ts.isReturnStatement(target) ? target.expression : target;
  return object && ts.isObjectLiteralExpression(object) ? object : undefined;
}

/** Arguments of exact assertions that are static literals: the expected values a test may change. */
function expectedValues(
  source: ts.SourceFile,
  literal: (node: ts.Expression) => boolean,
): ts.Expression[] {
  const expected: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const { expression: receiver, name } = node.expression;
      const argument =
        ts.isCallExpression(receiver) &&
        ts.isIdentifier(receiver.expression) &&
        receiver.expression.text === 'expect' &&
        ['toBe', 'toEqual', 'toStrictEqual'].includes(name.text)
          ? node.arguments[0]
          : ts.isIdentifier(receiver) &&
              receiver.text === 'assert' &&
              ['equal', 'strictEqual', 'deepEqual', 'deepStrictEqual'].includes(name.text)
            ? node.arguments[1]
            : undefined;
      if (argument && literal(argument)) expected.push(argument);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return expected;
}

/**
 * Only static expected values may change; test inputs, assertions and execution stay intact.
 * The one input change allowed: a property one of `diagnostics` (the edit's starting ones) says
 * an object lacks, added with a literal value to that object only. Each lands in `added`.
 */
export function testEditObjection(
  file: string,
  before: string,
  after: string,
  reason?: string,
  diagnostics: readonly FixDiagnostic[] = [],
  added: FixtureProperty[] = [],
): string | undefined {
  if (!isTestFile(file) || before === after) return undefined;
  if (!reason?.trim())
    return `test edit needs an explanation of the changed upgrade behavior: ${file}`;
  const literal = (node: ts.Expression): boolean =>
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node) ||
    [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(
      node.kind,
    ) ||
    (ts.isArrayLiteralExpression(node) && node.elements.every(literal)) ||
    (ts.isObjectLiteralExpression(node) &&
      node.properties.every(
        (p) =>
          ts.isPropertyAssignment(p) &&
          (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) || ts.isNumericLiteral(p.name)) &&
          literal(p.initializer),
      ));
  const parse = (text: string) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  // Object literals in source order, outside expected values: masking removes those, so one
  // index names the same object before and after the edit.
  const objects = (source: ts.SourceFile): ts.ObjectLiteralExpression[] => {
    const expected = expectedValues(source, literal);
    const found: ts.ObjectLiteralExpression[] = [];
    const visit = (node: ts.Node): void => {
      if (expected.includes(node as ts.Expression)) return;
      if (ts.isObjectLiteralExpression(node)) found.push(node);
      ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
  };
  // Which object, by that index, may gain which properties.
  const allowed = new Map<number, Set<string>>();
  const original = parse(before);
  const beforeObjects = objects(original);
  for (const d of diagnostics) {
    const names = d.file === file ? missingNames(d) : [];
    if (!names.length || d.line < 1 || d.line > original.getLineStarts().length) continue;
    const object = pointedAt(
      original,
      original.getPositionOfLineAndCharacter(d.line - 1, Math.max(0, d.column - 1)),
    );
    const index = object ? beforeObjects.indexOf(object) : -1;
    if (index < 0) continue;
    allowed.set(index, new Set([...(allowed.get(index) ?? []), ...names]));
  }
  const found: FixtureProperty[] = [];
  // Drops the allowed properties from their objects, counting objects in the order `objects`
  // does (a dropped value's own objects are not counted).
  const drop: ts.TransformerFactory<ts.SourceFile> = (context) => (root) => {
    let index = 0;
    const visit = (node: ts.Node): ts.Node => {
      if (!ts.isObjectLiteralExpression(node)) return ts.visitEachChild(node, visit, context);
      const names = allowed.get(index++);
      const kept = node.properties.filter((p) => {
        const add =
          !!names &&
          ts.isPropertyAssignment(p) &&
          (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
          names.has(p.name.text) &&
          literal(p.initializer);
        if (add)
          found.push({
            file,
            line: root.getLineAndCharacterOfPosition(p.getStart(root)).line + 1,
            property: p.name.text,
            value: p.initializer.getText(root),
          });
        return !add;
      });
      if (kept.length === node.properties.length) return ts.visitEachChild(node, visit, context);
      return context.factory.updateObjectLiteralExpression(
        node,
        context.factory.createNodeArray(
          kept.map((p) => ts.visitNode(p, visit) as ts.ObjectLiteralElementLike),
          node.properties.hasTrailingComma,
        ),
      );
    };
    return visit(root) as ts.SourceFile;
  };
  const skeleton = (text: string, additions = false): string => {
    const source = parse(text);
    let masked = text;
    // `null` keeps the masked value's line breaks, so an addition's line is the edited file's.
    for (const argument of expectedValues(source, literal).sort(
      (a, b) => b.getStart(source) - a.getStart(source),
    ))
      masked = `${masked.slice(0, argument.getStart(source))}null${'\n'.repeat(
        argument.getText(source).split('\n').length - 1,
      )}${masked.slice(argument.end)}`;
    const parsed = parse(masked);
    return ts
      .createPrinter()
      .printFile(
        additions && allowed.size
          ? (ts.transform(parsed, [drop]).transformed[0] ?? parsed)
          : parsed,
      );
  };
  if (!before.trim() || !after.trim() || skeleton(before) !== skeleton(after, true))
    return `test edit rejected: only explained expected-value changes are allowed; never delete, skip or weaken tests (${file})`;
  added.push(...found);
  return undefined;
}
