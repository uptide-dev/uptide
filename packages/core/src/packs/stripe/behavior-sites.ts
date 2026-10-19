import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ts } from 'ts-morph';
import { projectFiles } from '../../check/importers.js';
import type { RecordSite } from '../records.js';

/** Resolve only syntax whose value is visible. Types alone cannot prove an optional key absent. */
export function stripeBehaviorSites(input: {
  root: string;
  workspace: string;
  phase: 'before' | 'after';
}): Omit<RecordSite, 'record'>[] {
  const dir = resolve(input.root, input.workspace);
  const { files, options } = projectFiles(dir);
  const program = ts.createProgram({
    rootNames: files.map((f) => join(dir, f)),
    options: { ...options, noEmit: true, skipLibCheck: true },
  });
  const checker = program.getTypeChecker();
  const symbol = (node: ts.Node) => {
    const s = checker.getSymbolAtLocation(node);
    return s && s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;
  };
  function value(
    node: ts.Expression | undefined,
    seen = new Set<ts.Node>(),
  ): ts.Expression | undefined {
    if (!node || seen.has(node)) return undefined;
    seen.add(node);
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      return value(node.expression, seen);
    if (ts.isIdentifier(node)) {
      const d = symbol(node)?.valueDeclaration;
      if (d && ts.isVariableDeclaration(d)) return value(d.initializer, seen);
    }
    if (ts.isCallExpression(node)) {
      const d = checker.getResolvedSignature(node)?.declaration;
      if (
        d &&
        (ts.isFunctionDeclaration(d) || ts.isArrowFunction(d) || ts.isFunctionExpression(d)) &&
        d.body
      ) {
        if (!ts.isBlock(d.body)) return value(d.body, seen);
        const returns: ts.Expression[] = [];
        const visit = (n: ts.Node): void => {
          if (ts.isReturnStatement(n) && n.expression) returns.push(n.expression);
          else if (!ts.isFunctionLike(n)) ts.forEachChild(n, visit);
        };
        visit(d.body);
        if (returns.length === 1) return value(returns[0], seen);
      }
      return undefined;
    }
    return node;
  }
  type Property = { state: 'present'; value?: ts.Expression } | { state: 'absent' | 'unknown' };
  function property(
    expr: ts.Expression | undefined,
    key: string,
    call: ts.CallExpression,
    seen = new Set<ts.Node>(),
  ): Property {
    if (!expr || seen.has(expr)) return { state: 'unknown' };
    seen.add(expr);
    // Later property assignments count; conditional writes and rebinding are unknown.
    if (ts.isIdentifier(expr)) {
      const binding = symbol(expr);
      let write = false;
      let assigned: ts.Expression | undefined;
      const declaration = binding?.valueDeclaration;
      const block = declaration?.parent?.parent?.parent;
      const scan = (n: ts.Node): void => {
        if (
          ts.isBinaryExpression(n) &&
          n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          n.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        ) {
          const lhs = n.left;
          if (ts.isIdentifier(lhs) && symbol(lhs) === binding) write = true;
          if (
            (ts.isPropertyAccessExpression(lhs) || ts.isElementAccessExpression(lhs)) &&
            symbol(lhs.expression) === binding
          ) {
            const name = ts.isPropertyAccessExpression(lhs)
              ? lhs.name.text
              : lhs.argumentExpression && ts.isStringLiteral(lhs.argumentExpression)
                ? lhs.argumentExpression.text
                : undefined;
            if (name === key || name === undefined) {
              // Only a straight-line assignment before this call proves the parameter explicit.
              if (
                name === key &&
                n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
                ts.isExpressionStatement(n.parent) &&
                n.parent.parent === block &&
                n.getSourceFile() === call.getSourceFile() &&
                n.end < call.getStart()
              )
                assigned = n.right;
              else write = true;
            }
          }
        }
        ts.forEachChild(n, scan);
      };
      scan(expr.getSourceFile());
      if (write) return { state: 'unknown' };
      if (assigned) return { state: 'present', value: assigned };
    }
    const resolved = value(expr);
    if (!resolved || !ts.isObjectLiteralExpression(resolved)) return { state: 'unknown' };
    let result: Property = { state: 'absent' };
    for (const p of resolved.properties) {
      if (ts.isSpreadAssignment(p)) {
        const spread = property(p.expression, key, call, new Set(seen));
        if (spread.state !== 'absent') result = spread;
      } else if (p.name && !ts.isComputedPropertyName(p.name)) {
        if (p.name.getText().replace(/^['"]|['"]$/g, '') === key) {
          result = {
            state: 'present',
            value: ts.isPropertyAssignment(p)
              ? p.initializer
              : ts.isShorthandPropertyAssignment(p)
                ? p.name
                : undefined,
          };
        }
      } else result = { state: 'unknown' };
    }
    return result;
  }
  const sites: Omit<RecordSite, 'record'>[] = [];
  for (const file of files) {
    const source = program.getSourceFile(join(dir, file));
    if (!source) continue;
    const lines = readFileSync(join(dir, file), 'utf8').split('\n');
    let ordinal = 0;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const declaration = checker.getResolvedSignature(node)?.declaration;
        const path = declaration?.getSourceFile().fileName.replaceAll('\\', '/') ?? '';
        // Proven SDK declarations, never a same-named local client or an any receiver.
        const subscription =
          /\/node_modules\/stripe\/(?:types|cjs|esm)\/(?:resources\/)?Subscriptions(?:Resource)?\.d\.ts$/.test(
            path,
          );
        const parameter = declaration?.parameters[0];
        const paramType = parameter && checker.getTypeAtLocation(parameter);
        const checkoutWrapper =
          paramType?.getSymbol()?.getName() === 'SessionCreateParams' &&
          (paramType.getSymbol()?.getDeclarations() ?? []).some((d) =>
            /\/node_modules\/stripe\//.test(d.getSourceFile().fileName),
          );
        const checkout =
          checkoutWrapper ||
          /\/node_modules\/stripe\/(?:types|cjs|esm)\/(?:resources\/)?Checkout\/Sessions(?:Resource)?\.d\.ts$/.test(
            path,
          );
        if (
          (subscription || checkout) &&
          (checkoutWrapper ||
            (ts.isPropertyAccessExpression(node.expression) &&
              node.expression.name.text === 'create'))
        ) {
          const identity = `${subscription ? 'subscriptions' : 'checkout'}.create:${ordinal++}`;
          const params = node.arguments[0];
          let target = params;
          let state: Property;
          if (checkout) {
            const mode = property(params, 'mode', node);
            const literal = mode.state === 'present' ? value(mode.value) : undefined;
            if (!literal || !ts.isStringLiteral(literal) || literal.text !== 'subscription') {
              ts.forEachChild(node, visit);
              return;
            }
            const data = property(params, 'subscription_data', node);
            target = data.state === 'present' ? data.value : undefined;
            state =
              data.state === 'absent'
                ? { state: 'absent' }
                : property(target, 'billing_mode', node);
          } else state = property(target, 'billing_mode', node);
          const resolvedTarget = checkout && target ? value(target) : undefined;
          const anchor =
            resolvedTarget && resolvedTarget.getSourceFile() === source
              ? ts.isVariableDeclaration(resolvedTarget.parent)
                ? resolvedTarget.parent
                : resolvedTarget
              : node;
          const line = source.getLineAndCharacterOfPosition(anchor.getStart(source)).line;
          const mode = state.state === 'present' ? property(state.value, 'type', node) : undefined;
          const modeValue = mode?.state === 'present' ? value(mode.value) : undefined;
          const kept = !!modeValue && ts.isStringLiteral(modeValue) && modeValue.text === 'classic';
          if (state.state !== 'present' || input.phase === 'after')
            sites.push({
              file,
              line: line + 1,
              snippet: (lines[line] ?? '').trim(),
              identity,
              decision: state.state === 'unknown',
              ...(input.phase === 'after' ? { kept } : {}),
            });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...new Map(sites.map((site) => [`${site.file}:${site.line}`, site])).values()];
}
