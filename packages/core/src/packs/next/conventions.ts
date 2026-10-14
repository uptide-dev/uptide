import { Node, Project, SyntaxKind } from 'ts-morph';
import type { Finding } from '../../domain/report.js';
import type { SourceSite } from '../contract.js';
import type { TransformResult } from '../types.js';

const middlewareFile = /^(?:src\/)?middleware\.(?:ts|js)$/;
const configFile = /^next\.config\.(?:js|mjs|ts|cjs)$/;
const parse = (text: string) =>
  new Project({ useInMemoryFileSystem: true }).createSourceFile('input.ts', text);
function site(node: Node): SourceSite {
  const source = node.getSourceFile();
  const { line, column } = source.getLineAndColumnAtPos(node.getStart());
  return { line, column, snippet: source.getFullText().split('\n')[line - 1]?.trim() ?? '' };
}

// Narrow port of @next/codemod@16.4.0 middleware-to-proxy: exported function branch.
// Scope-aware rename preserves references. Runtime switches are never silently erased.
export function middlewareSites(text: string, file: string): SourceSite[] {
  if (!middlewareFile.test(file)) return [];
  const source = parse(text);
  const fn = source
    .getFunctions()
    .find((f) => f.isExported() && (f.getName() === 'middleware' || f.isDefaultExport()));
  return fn ? [site(fn)] : [];
}
export function renameMiddleware(text: string, finding: Finding): TransformResult {
  const decline = {
    text,
    applied: false,
    reason: 'middleware runtime or export needs manual review',
  };
  if (!middlewareFile.test(finding.usage.file)) return decline;
  const source = parse(text);
  const fn = source
    .getFunctions()
    .find((f) => f.isExported() && (f.getName() === 'middleware' || f.isDefaultExport()));
  if (!fn || site(fn).line !== finding.usage.line) return decline;
  if (
    source
      .getDescendantsOfKind(SyntaxKind.Identifier)
      .some((n) => ['runtime', 'proxy', 'NextMiddleware', 'MiddlewareConfig'].includes(n.getText()))
  )
    return decline;
  if (
    source
      .getDescendantsOfKind(SyntaxKind.PropertyAssignment)
      .some((p) => ['runtime', "'runtime'", '"runtime"'].includes(p.getName()))
  )
    return decline;
  if (source.getExportDeclarations().length) return decline;
  if (fn.getName()) fn.rename('proxy');
  return {
    text: source.getFullText(),
    applied: true,
    reason: 'rename exported middleware and convention file together',
    edits: [
      {
        kind: 'rename',
        file: finding.usage.file,
        to: finding.usage.file.replace(/middleware\.(ts|js)$/, 'proxy.$1'),
      },
    ],
  };
}

// Resolve only a direct exported object or a single const binding, never arbitrary nested
// objects named eslint. Wrappers, spreads and executable values remain assisted.
function eslintProperties(text: string, file: string) {
  if (!configFile.test(file)) return [];
  const source = parse(text);
  const roots: Node[] = source.getExportAssignments().map((e) => e.getExpression());
  for (const statement of source.getStatements()) {
    if (!Node.isExpressionStatement(statement)) continue;
    const expression = statement.getExpression();
    if (
      Node.isBinaryExpression(expression) &&
      expression.getLeft().getText() === 'module.exports' &&
      expression.getOperatorToken().getText() === '='
    )
      roots.push(expression.getRight());
  }
  return roots.flatMap((root) => {
    let value = root;
    if (Node.isIdentifier(value)) {
      const declaration = source.getVariableDeclaration(value.getText());
      if (declaration?.getVariableStatement()?.getDeclarationKind() !== 'const') return [];
      const initializer = declaration.getInitializer();
      if (!initializer) return [];
      value = initializer;
    }
    if (!Node.isObjectLiteralExpression(value)) return [];
    return value
      .getProperties()
      .filter(Node.isPropertyAssignment)
      .filter((p) => ['eslint', "'eslint'", '"eslint"'].includes(p.getName()));
  });
}
export function eslintConfigSites(text: string, file: string): SourceSite[] {
  return eslintProperties(text, file).map(site);
}
export function removeEslintConfig(text: string, finding: Finding): TransformResult {
  const property = eslintProperties(text, finding.usage.file).find(
    (p) => site(p).line === finding.usage.line && site(p).column === finding.usage.column,
  );
  const initializer = property?.getInitializer();
  if (
    !property ||
    !initializer ||
    !Node.isObjectLiteralExpression(initializer) ||
    initializer
      .getProperties()
      .some(
        (p) =>
          !Node.isPropertyAssignment(p) ||
          Node.isComputedPropertyName(p.getNameNode()) ||
          !['true', 'false'].includes(p.getInitializer()?.getText() ?? ''),
      )
  )
    return { text, applied: false, reason: 'eslint value is dynamic or may have side effects' };
  const followingComma = property.getNextSiblingIfKind(SyntaxKind.CommaToken);
  const precedingComma = property.getPreviousSiblingIfKind(SyntaxKind.CommaToken);
  const start = !followingComma && precedingComma ? precedingComma.getStart() : property.getStart();
  const end = followingComma?.getEnd() ?? property.getEnd();
  return {
    text: text.slice(0, start) + text.slice(end),
    applied: true,
    reason: 'remove obsolete static Next eslint config; lint tooling remains a review decision',
  };
}
