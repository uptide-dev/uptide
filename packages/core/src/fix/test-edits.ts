import { ts } from 'ts-morph';

export const isTestFile = (file: string): boolean =>
  /(?:^|\/)(?:__tests__|tests?|specs?)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);

/** Only static expected values may change; test inputs, assertions and execution stay intact. */
export function testEditObjection(
  file: string,
  before: string,
  after: string,
  reason?: string,
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
  const skeleton = (text: string): string => {
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
    return ts
      .createPrinter()
      .printFile(ts.createSourceFile(file, masked, ts.ScriptTarget.Latest, true));
  };
  if (!before.trim() || !after.trim() || skeleton(before) !== skeleton(after))
    return `test edit rejected: only explained expected-value changes are allowed; never delete, skip or weaken tests (${file})`;
  return undefined;
}
