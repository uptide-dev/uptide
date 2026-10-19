import { ts } from 'ts-morph';
import type { FixDiagnostic } from './types.js';

export const isTestFile = (file: string): boolean =>
  /(?:^|\/)(?:__tests__|tests?|specs?)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);

/**
 * Properties the compiler says an object in `file` lacks (TS2739/TS2740/TS2741): ones the
 * upgraded types made required. Adding one to a fixture is the compiler's fix, not a weaker test.
 */
export function missingProperties(
  diagnostics: readonly FixDiagnostic[],
  file: string,
): Set<string> {
  const names = new Set<string>();
  for (const d of diagnostics) {
    if (d.file !== file) continue;
    const list =
      d.code === 2741
        ? d.message.match(/^Property '([^']+)' is missing/)?.[1]
        : d.code === 2739 || d.code === 2740
          ? d.message.match(
              /missing the following properties from type '.*': (.*?)(?:, and \d+ more)?\.?$/,
            )?.[1]
          : undefined;
    for (const name of list?.split(', ') ?? []) names.add(name);
  }
  return names;
}

/**
 * Only static expected values may change; test inputs, assertions and execution stay intact.
 * The one input change allowed: adding a literal-valued property the compiler named in `missing`.
 */
export function testEditObjection(
  file: string,
  before: string,
  after: string,
  reason?: string,
  missing: ReadonlySet<string> = new Set(),
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
  // Drops `missing` properties from object literals (expected values are already masked) and
  // records each as `name: value`, so existing ones must survive the edit unchanged.
  const required =
    (dropped: string[]): ts.TransformerFactory<ts.SourceFile> =>
    (context) =>
    (root) => {
      const drop = (node: ts.Node): ts.Node => {
        const visited = ts.visitEachChild(node, drop, context);
        if (!ts.isObjectLiteralExpression(node) || !ts.isObjectLiteralExpression(visited))
          return visited;
        const kept = visited.properties.filter((_, i) => {
          const original = node.properties[i];
          const add =
            original &&
            ts.isPropertyAssignment(original) &&
            (ts.isIdentifier(original.name) || ts.isStringLiteral(original.name)) &&
            missing.has(original.name.text) &&
            literal(original.initializer);
          if (add) dropped.push(original.getText());
          return !add;
        });
        return kept.length === visited.properties.length
          ? visited
          : context.factory.updateObjectLiteralExpression(
              visited,
              context.factory.createNodeArray(kept, visited.properties.hasTrailingComma),
            );
      };
      return drop(root) as ts.SourceFile;
    };
  const skeleton = (text: string, dropped: string[] = []): string => {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
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
    let masked = text;
    for (const argument of expected.sort((a, b) => b.getStart(source) - a.getStart(source)))
      masked = `${masked.slice(0, argument.getStart(source))}null${masked.slice(argument.end)}`;
    const parsed = ts.createSourceFile(file, masked, ts.ScriptTarget.Latest, true);
    return ts
      .createPrinter()
      .printFile(
        missing.size
          ? (ts.transform(parsed, [required(dropped)]).transformed[0] ?? parsed)
          : parsed,
      );
  };
  const existing: string[] = [];
  const added: string[] = [];
  const same =
    !!before.trim() && !!after.trim() && skeleton(before, existing) === skeleton(after, added);
  // Every property that was already there is still there, with the same value.
  const kept = existing.every((p) => {
    const i = added.indexOf(p);
    if (i >= 0) added.splice(i, 1);
    return i >= 0;
  });
  if (!same || !kept)
    return `test edit rejected: only explained expected-value changes are allowed; never delete, skip or weaken tests (${file})`;
  return undefined;
}
