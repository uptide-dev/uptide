import { ts } from 'ts-morph';
import { onReset } from '../../shared-state.js';
import type { SourceSite } from '../contract.js';

/**
 * What the openai rules read from a file's syntax: whether it uses the package, the property
 * chain a call goes through (`client.beta.threads.runs.retrieve`), and which names hold a client.
 * Text alone cannot tell `runs.retrieve(a, b)` on an OpenAI client from any other `retrieve`; the
 * chain and the import can. Nothing here resolves types, so it also sees code typed `any`.
 */
const parsed = new Map<string, ts.SourceFile>();
onReset(() => parsed.clear());

export function parse(text: string): ts.SourceFile {
  let source = parsed.get(text);
  if (!source) {
    source = ts.createSourceFile(
      'consumer.tsx',
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    if (parsed.size >= 16) parsed.delete(parsed.keys().next().value as string);
    parsed.set(text, source);
  }
  return source;
}

export const OPENAI_MODULE = /^openai(?:\/|$)/;

/** Module specifiers of the file's imports, re-exports, `require` and `import()` calls, with their nodes. */
export function moduleReferences(
  source: ts.SourceFile,
): { specifier: string; node: ts.StringLiteralLike; statement: ts.Node }[] {
  const found: { specifier: string; node: ts.StringLiteralLike; statement: ts.Node }[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    )
      found.push({
        specifier: node.moduleSpecifier.text,
        node: node.moduleSpecifier,
        statement: node,
      });
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0] as ts.Expression)
    ) {
      const argument = node.arguments[0] as ts.StringLiteralLike;
      found.push({ specifier: argument.text, node: argument, statement: node });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Whether the file uses the package at all: a rule's sites are only ever in such a file. */
export function usesOpenai(text: string): boolean {
  if (!text.includes('openai')) return false;
  return moduleReferences(parse(text)).some((m) => OPENAI_MODULE.test(m.specifier));
}

/** 1-based line and column of a node's first token. */
export function position(source: ts.SourceFile, node: ts.Node): { line: number; column: number } {
  const at = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: at.line + 1, column: at.character + 1 };
}

export function siteOf(source: ts.SourceFile, node: ts.Node, name?: string): SourceSite {
  const { line, column } = position(source, node);
  return {
    line,
    column,
    snippet: source.text.split('\n')[line - 1]?.trim() ?? '',
    ...(name ? { name } : {}),
  };
}

/** `(x as Y)`, `x!`, `(x)`: the expression underneath, which is what the chain is about. */
export function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  )
    current = current.expression;
  return current;
}

/**
 * The names of a property-access chain, root first: `this.client.beta.threads` →
 * `['this', 'client', 'beta', 'threads']`. A root that is a call or anything else is `()`;
 * an element access (`x['beta']`) is not a chain the rules read.
 */
export function chainOf(node: ts.Expression): string[] | undefined {
  const names: string[] = [];
  let current = unwrap(node);
  while (ts.isPropertyAccessExpression(current)) {
    names.unshift(current.name.text);
    current = unwrap(current.expression);
  }
  if (ts.isIdentifier(current)) names.unshift(current.text);
  else if (current.kind === ts.SyntaxKind.ThisKeyword) names.unshift('this');
  else if (ts.isElementAccessExpression(current)) return undefined;
  else names.unshift('()');
  return names;
}

/** Whether `chain` ends with `suffix`, segment by segment. */
export function endsWith(chain: readonly string[], suffix: readonly string[]): boolean {
  if (chain.length < suffix.length) return false;
  const offset = chain.length - suffix.length;
  return suffix.every((name, i) => chain[offset + i] === name);
}

/** Every call in the file whose callee is `<receiver>.<method>`, with the receiver's chain. */
export function methodCalls(
  source: ts.SourceFile,
): { call: ts.CallExpression; method: ts.Identifier; chain: string[] }[] {
  const found: { call: ts.CallExpression; method: ts.Identifier; chain: string[] }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) {
        const chain = chainOf(callee.expression);
        if (chain) found.push({ call: node, method: callee.name, chain });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * Names that hold an OpenAI client in this file: variables, parameters and properties
 * initialized with `new OpenAI(...)` / `new AzureOpenAI(...)` (as imported here) or typed with
 * them. Properties are `this.<name>`. A resource reached from one of these is the SDK's.
 */
export function clientNames(source: ts.SourceFile): Set<string> {
  const { classes, namespaces } = clientClasses(source);
  const isClient = (expression: ts.Expression | undefined): boolean => {
    const value = expression && unwrap(expression);
    if (!value || !ts.isNewExpression(value)) return false;
    const chain = chainOf(value.expression);
    if (!chain) return false;
    return chain.length === 1
      ? classes.has(chain[0] as string)
      : chain.length === 2 &&
          namespaces.has(chain[0] as string) &&
          ['OpenAI', 'AzureOpenAI'].includes(chain[1] as string);
  };
  const isClientType = (type: ts.TypeNode | undefined): boolean =>
    !!type &&
    ts.isTypeReferenceNode(type) &&
    (ts.isIdentifier(type.typeName)
      ? classes.has(type.typeName.text)
      : ts.isIdentifier(type.typeName.left) &&
        namespaces.has(type.typeName.left.text) &&
        ['OpenAI', 'AzureOpenAI'].includes(type.typeName.right.text));
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isPropertyDeclaration(node)) &&
      (ts.isIdentifier(node.name) || ts.isPrivateIdentifier(node.name)) &&
      (isClient(node.initializer) || isClientType(node.type))
    )
      names.add(ts.isPropertyDeclaration(node) ? `this.${node.name.text}` : node.name.text);
    // `constructor(private client: OpenAI)` is also `this.client`.
    if (
      ts.isParameter(node) &&
      ts.isIdentifier(node.name) &&
      node.modifiers?.some((m) => PARAMETER_PROPERTY.has(m.kind)) &&
      isClientType(node.type)
    )
      names.add(`this.${node.name.text}`);
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      isClient(node.right)
    ) {
      const chain = chainOf(node.left);
      if (chain?.length === 1) names.add(chain[0] as string);
      if (chain?.length === 2 && chain[0] === 'this') names.add(`this.${chain[1]}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

/**
 * Local names of the client classes this file imports from `openai` (default, `OpenAI`,
 * `AzureOpenAI`, aliases included, or destructured from `require`), and namespace imports.
 */
export function clientClasses(source: ts.SourceFile): {
  classes: Set<string>;
  namespaces: Set<string>;
} {
  const classes = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === 'openai'
    ) {
      const clause = statement.importClause;
      if (clause?.name) classes.add(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements)
          if (['OpenAI', 'AzureOpenAI'].includes((element.propertyName ?? element.name).text))
            classes.add(element.name.text);
    }
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer && unwrap(declaration.initializer);
        if (
          init &&
          ts.isCallExpression(init) &&
          ts.isIdentifier(init.expression) &&
          init.expression.text === 'require' &&
          ts.isStringLiteralLike(init.arguments[0] as ts.Expression) &&
          (init.arguments[0] as ts.StringLiteralLike).text === 'openai'
        ) {
          if (ts.isIdentifier(declaration.name)) classes.add(declaration.name.text);
          else if (ts.isObjectBindingPattern(declaration.name))
            for (const element of declaration.name.elements)
              if (ts.isIdentifier(element.name)) classes.add(element.name.text);
        }
      }
  }
  return { classes, namespaces };
}

/** Whether a chain's root (`client`, `this.client`) is one of `clientNames`. */
export function rootIsClient(
  chain: readonly string[],
  clients: ReadonlySet<string>,
  depth: number,
): boolean {
  const root = chain.slice(0, chain.length - depth);
  return root.length === 1
    ? clients.has(root[0] as string)
    : root.length === 2 && root[0] === 'this' && clients.has(`this.${root[1]}`);
}

/** An argument the rewrite may move without changing what runs: a name, a member, a literal. */
export function inert(node: ts.Expression): boolean {
  const value = unwrap(node);
  if (
    ts.isIdentifier(value) ||
    ts.isStringLiteralLike(value) ||
    ts.isNumericLiteral(value) ||
    value.kind === ts.SyntaxKind.ThisKeyword
  )
    return true;
  if (ts.isPropertyAccessExpression(value)) return inert(value.expression);
  return false;
}

const PARAMETER_PROPERTY = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.PublicKeyword,
  ts.SyntaxKind.PrivateKeyword,
  ts.SyntaxKind.ProtectedKeyword,
  ts.SyntaxKind.ReadonlyKeyword,
]);
