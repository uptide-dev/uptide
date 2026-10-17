import { relative } from 'node:path';
import type { ts } from 'ts-morph';
import type { DiagnosticCause } from '../../domain/usage.js';
import { augmentationImportCause, isAugmentation, packageOf } from './augmentation-import.js';

/**
 * Root cause of an `unknown`/`any` diagnostic. When an upgrade changes what a package
 * type resolves to, one repo declaration built on it starts producing `unknown`, and
 * every consumer of it errors: thirty-one errors with one fix. The expression at the
 * diagnostic is followed to its declaration, then through initializers, callees and
 * receivers. A repo declaration on that chain is blamed only when its own type differs
 * between the installed version and the target, or when it fails to compile itself; a
 * declaration that compiles unchanged is not a cause, whatever flows through it. When the
 * value flowing into such a declaration is `any` (or an error type), that value is traced
 * to its origin, an import or a declaration, and the origin is blamed. Nothing found means
 * the diagnostic stays on its own.
 */

const MAX_HOPS = 8;

interface Programs {
  overlay: ts.Program;
  base: ts.Program;
  /** The compiler both programs were built with: node kinds and flags are its, not the bundled one's. */
  ts: typeof ts;
}

function deepestAt(tsc: typeof ts, root: ts.Node, position: number): ts.Node {
  let node: ts.Node = root;
  for (;;) {
    let next: ts.Node | undefined;
    tsc.forEachChild(node, (child) => {
      if (!next && child.getStart() <= position && position < child.getEnd()) next = child;
    });
    if (!next) return node;
    node = next;
  }
}

/** The expression whose type the diagnostic complains about: the identifier or access at the position. */
function offendingExpression(tsc: typeof ts, node: ts.Node): ts.Expression | undefined {
  let n: ts.Node | undefined = node;
  while (n && !tsc.isExpression(n)) n = n.parent;
  if (!n) return undefined;
  while (tsc.isPropertyAccessExpression(n.parent) && n.parent.name === n) n = n.parent;
  return n as ts.Expression;
}

/** The same node in the other program, by file, position and width (`a.b` inside `a.b.c` starts at the same place). */
function counterpart(tsc: typeof ts, decl: ts.Node, program: ts.Program): ts.Node | undefined {
  const file = program.getSourceFile(decl.getSourceFile().fileName);
  if (!file) return undefined;
  const width = decl.getEnd() - decl.getStart();
  let node: ts.Node | undefined = deepestAt(tsc, file, decl.getStart());
  while (node && (node.kind !== decl.kind || node.getEnd() - node.getStart() !== width))
    node = node.parent;
  return node;
}

function typeText(tsc: typeof ts, decl: ts.Node, program: ts.Program): string | undefined {
  const named = tsc.getNameOfDeclaration(decl as ts.Declaration);
  const at = named ?? decl;
  const checker = program.getTypeChecker();
  try {
    // The installed and target copies live in different directories; `import("…")` prefixes must not count as a change.
    return (
      checker
        .typeToString(checker.getTypeAtLocation(at), undefined, tsc.TypeFormatFlags.NoTruncation)
        .replace(/import\("[^"]*"\)\./g, '')
        // The same type prints as `ParamsDictionary` in one program and `core.ParamsDictionary` in another.
        .replace(/\b[A-Za-z_$][\w$]*\.(?=[A-Z])/g, '')
    );
  } catch {
    return undefined;
  }
}

/**
 * A type as text that does not depend on member order: the installed and target programs may
 * list one declaration's members, or a union's, in a different order. Anonymous object types
 * are spelled member by member, sorted; named ones by name, as `typeText` prints them.
 */
function shapeText(tsc: typeof ts, node: ts.Node, program: ts.Program): string | undefined {
  const checker = program.getTypeChecker();
  const print = (t: ts.Type): string =>
    checker
      .typeToString(t, undefined, tsc.TypeFormatFlags.NoTruncation)
      .replace(/import\("[^"]*"\)\./g, '')
      .replace(/\b[A-Za-z_$][\w$]*\.(?=[A-Z])/g, '');
  const shape = (t: ts.Type, depth: number): string => {
    if (depth > 6) return print(t);
    if (t.isUnionOrIntersection())
      return t.types
        .map((m) => shape(m, depth + 1))
        .sort()
        .join(t.isUnion() ? ' | ' : ' & ');
    if (checker.isArrayType(t)) {
      const [element] = checker.getTypeArguments(t as ts.TypeReference);
      return element ? `${shape(element, depth + 1)}[]` : print(t);
    }
    const anonymous = !t.aliasSymbol && ['__type', '__object'].includes(t.symbol?.name ?? '');
    if (!(t.flags & tsc.TypeFlags.Object) || !anonymous) return print(t);
    if (checker.getSignaturesOfType(t, tsc.SignatureKind.Call).length) return print(t);
    return `{ ${checker
      .getPropertiesOfType(t)
      .map(
        (p) =>
          `${p.name}${p.flags & tsc.SymbolFlags.Optional ? '?' : ''}: ${shape(checker.getTypeOfSymbolAtLocation(p, node), depth + 1)}`,
      )
      .sort()
      .join('; ')} }`;
  };
  try {
    return shape(
      checker.getTypeAtLocation(tsc.getNameOfDeclaration(node as ts.Declaration) ?? node),
      0,
    );
  } catch {
    return undefined;
  }
}

export function findCause(
  programs: Programs,
  diagnostic: ts.Diagnostic,
  file: ts.SourceFile,
  repoDir: string,
  /** `file:line` of every new diagnostic, so a declaration failing itself is recognised. */
  erroredLines: Set<string>,
): DiagnosticCause | undefined {
  const tsc = programs.ts;
  if (diagnostic.start === undefined) return undefined;
  if (!/\b(unknown|any)\b/.test(tsc.flattenDiagnosticMessageText(diagnostic.messageText, ' ')))
    return undefined;
  const checker = programs.overlay.getTypeChecker();
  const inRepo = (n: ts.Node): boolean => {
    const f = n.getSourceFile().fileName;
    return f.startsWith(`${repoDir}/`) && !f.includes('/node_modules/');
  };
  const declarationOf = (expr: ts.Node): ts.Declaration | undefined => {
    const symbol = checker.getSymbolAtLocation(expr);
    const target =
      symbol && symbol.flags & tsc.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    return target?.declarations?.[0];
  };
  const lineOf = (n: ts.Node): string => {
    const f = n.getSourceFile();
    const named = tsc.getNameOfDeclaration(n as ts.Declaration);
    return `${relative(repoDir, f.fileName)}:${f.getLineAndCharacterOfPosition((named ?? n).getStart()).line + 1}`;
  };
  const site = `${relative(repoDir, file.fileName)}:${file.getLineAndCharacterOfPosition(diagnostic.start).line + 1}`;
  /** Blame a repo declaration only for a change of its own. The site itself is never its own cause. */
  const judge = (decl: ts.Node): DiagnosticCause | undefined => {
    const at = lineOf(decl);
    if (at === site) return undefined;
    if (erroredLines.has(at))
      return causeAt(tsc, decl, 'which itself fails to compile against the target', repoDir);
    const before = counterpart(tsc, decl, programs.base);
    const after = typeText(tsc, decl, programs.overlay);
    const earlier = before ? typeText(tsc, before, programs.base) : undefined;
    if (after !== undefined && earlier !== undefined && after !== earlier) {
      return causeAt(
        tsc,
        decl,
        `whose type changed from \`${clip(earlier)}\` to \`${clip(after)}\``,
        repoDir,
      );
    }
    return undefined;
  };
  const isAny = (n: ts.Node): boolean =>
    (checker.getTypeAtLocation(n).flags & tsc.TypeFlags.Any) !== 0;
  /** An `any` value's origin: the import or repo declaration it came from. */
  const origin = (start: ts.Node): DiagnosticCause | undefined => {
    let n: ts.Node | undefined = start;
    for (let hop = 0; n && hop < MAX_HOPS; hop++) {
      if (tsc.isParenthesizedExpression(n) || tsc.isAwaitExpression(n) || tsc.isAsExpression(n)) {
        n = n.expression;
        continue;
      }
      if (tsc.isCallExpression(n) || tsc.isNewExpression(n)) {
        n = tsc.isPropertyAccessExpression(n.expression) ? n.expression.expression : n.expression;
        continue;
      }
      if (tsc.isPropertyAccessExpression(n)) {
        n = n.expression;
        continue;
      }
      if (!tsc.isIdentifier(n)) return undefined;
      const symbol = checker.getSymbolAtLocation(n);
      const decl = symbol?.declarations?.[0];
      if (!decl || !inRepo(decl)) return undefined;
      if (tsc.isImportSpecifier(decl) || tsc.isImportClause(decl) || tsc.isNamespaceImport(decl)) {
        const importDecl = decl.getSourceFile() && findImportDeclaration(tsc, decl);
        const from = importDecl
          ? importDecl.moduleSpecifier.getText().replace(/['"]/g, '')
          : 'an import';
        return causeAt(
          tsc,
          decl,
          `imported from \`${from}\`, which is typed \`any\` against the target`,
          repoDir,
        );
      }
      const judged = judge(decl);
      if (judged) return judged;
      if (tsc.isVariableDeclaration(decl) && decl.initializer) {
        n = decl.initializer;
        continue;
      }
      return undefined;
    }
    return undefined;
  };

  let expr: ts.Node | undefined = offendingExpression(tsc, deepestAt(tsc, file, diagnostic.start));
  for (let hop = 0; expr && hop < MAX_HOPS; hop++) {
    if (
      tsc.isParenthesizedExpression(expr) ||
      tsc.isAwaitExpression(expr) ||
      tsc.isAsExpression(expr)
    ) {
      expr = expr.expression;
      continue;
    }
    if (tsc.isCallExpression(expr) || tsc.isNewExpression(expr)) {
      const call = expr;
      const callee = call.expression;
      const target = tsc.isPropertyAccessExpression(callee) ? callee.name : callee;
      const decl = declarationOf(target);
      if (decl && inRepo(decl)) {
        const judged = judge(decl);
        if (judged) return judged;
        // The callee is unchanged and compiles: the fault came in through an argument.
        const anyArg = (call.arguments ?? []).find((a) => isAny(a));
        if (anyArg) return origin(anyArg);
        expr = returnedExpression(tsc, decl);
        continue;
      }
      // A package callee (`schema.safeParse`): the receiver carries the type that changed.
      expr = tsc.isPropertyAccessExpression(callee) ? callee.expression : undefined;
      continue;
    }
    if (tsc.isIdentifier(expr) || tsc.isPropertyAccessExpression(expr)) {
      const target = tsc.isPropertyAccessExpression(expr) ? expr.name : expr;
      const decl = declarationOf(target);
      if (!decl || !inRepo(decl)) {
        if (tsc.isPropertyAccessExpression(expr)) {
          expr = expr.expression;
          continue;
        }
        if (tsc.isIdentifier(expr) && isAny(expr)) return origin(expr);
        return undefined;
      }
      if (tsc.isImportSpecifier(decl) || tsc.isImportClause(decl) || tsc.isNamespaceImport(decl)) {
        return isAny(expr) ? origin(expr) : undefined;
      }
      const judged = judge(decl);
      if (judged) return judged;
      if (tsc.isVariableDeclaration(decl) || tsc.isPropertyDeclaration(decl)) {
        expr = decl.initializer;
        continue;
      }
      if (tsc.isParameter(decl)) {
        const fn = decl.parent;
        // A callback's parameter is typed by whatever the callback was passed to; look there first.
        if (tsc.isCallExpression(fn.parent)) {
          expr = fn.parent;
          continue;
        }
        return judge(fn);
      }
      if (
        (tsc.isPropertySignature(decl) || tsc.isPropertyAssignment(decl)) &&
        tsc.isPropertyAccessExpression(expr)
      ) {
        expr = expr.expression;
        continue;
      }
      return undefined;
    }
    return undefined;
  }
  return undefined;
}

/**
 * The new diagnostic this one is a consequence of (UPT-99): the value at `diagnostic` is
 * followed back with the checker, through variable and destructured declarations, a
 * callback's `any` receiver (`errors.map(e => …)`), members of returned object literals and
 * calls of repository functions, until it reaches the expression of another new diagnostic
 * that is typed `any` at the target (`result.error.errors`, TS2339). A repository function's
 * call is followed only when every return whose type changed between the installed version
 * and the target leads to such an expression; one it cannot trace and nothing is returned.
 * Never by distance: no trace, no origin.
 */
export function flowOrigin(
  programs: Programs,
  diagnostic: ts.Diagnostic,
  file: ts.SourceFile,
  repoDir: string,
  /** Every new diagnostic, by file name. */
  fresh: ReadonlyMap<string, readonly ts.Diagnostic[]>,
): ts.Diagnostic | undefined {
  const tsc = programs.ts;
  if (diagnostic.start === undefined) return undefined;
  const checker = programs.overlay.getTypeChecker();
  const inRepo = (n: ts.Node): boolean => {
    const f = n.getSourceFile().fileName;
    return f.startsWith(`${repoDir}/`) && !f.includes('/node_modules/');
  };
  const isAny = (n: ts.Node): boolean =>
    (checker.getTypeAtLocation(n).flags & tsc.TypeFlags.Any) !== 0;
  const declarationOf = (n: ts.Node): ts.Declaration | undefined => {
    const symbol = checker.getSymbolAtLocation(n);
    const target =
      symbol && symbol.flags & tsc.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    return target?.declarations?.[0];
  };
  const changed = (n: ts.Node): boolean => {
    const before = counterpart(tsc, n, programs.base);
    const earlier = before && shapeText(tsc, before, programs.base);
    const after = shapeText(tsc, n, programs.overlay);
    return earlier === undefined || after === undefined || earlier !== after;
  };
  /** `x as SafeParseReturnType<…>` whose import is itself a new error: the cast is `any` because of it. */
  const castRoot = (n: ts.AsExpression): ts.Diagnostic | undefined => {
    if (!tsc.isTypeReferenceNode(n.type) || !isAny(n)) return undefined;
    let name: ts.EntityName = n.type.typeName;
    while (tsc.isQualifiedName(name)) name = name.left;
    const decl = checker.getSymbolAtLocation(name)?.declarations?.[0];
    if (!decl || !tsc.isImportSpecifier(decl)) return undefined;
    return fresh
      .get(decl.getSourceFile().fileName)
      ?.find(
        (d) =>
          d !== diagnostic &&
          d.start !== undefined &&
          d.start >= decl.getStart() &&
          d.start < decl.getEnd(),
      );
  };
  /** The other new diagnostic at this expression's own position: an access's name, a call's callee. */
  const rootAt = (n: ts.Expression): ts.Diagnostic | undefined => {
    const callee = tsc.isCallExpression(n) ? n.expression : n;
    const at = tsc.isPropertyAccessExpression(callee) ? callee.name : callee;
    const start = at.getStart();
    const root = fresh
      .get(n.getSourceFile().fileName)
      ?.find((d) => d !== diagnostic && d.start === start);
    return root && isAny(n) ? root : undefined;
  };
  const seen = new Set<ts.Node>();
  /** Every expression here whose type changed leads to an origin: the first one, or none. */
  const explained = (
    expressions: readonly ts.Expression[],
    depth: number,
  ): ts.Diagnostic | undefined => {
    let first: ts.Diagnostic | undefined;
    for (const e of expressions) {
      if (!changed(e)) continue;
      const root = origin(e, depth);
      if (!root) return undefined;
      first ??= root;
    }
    return first;
  };
  const origin = (start: ts.Node | undefined, depth: number): ts.Diagnostic | undefined => {
    let n = start;
    while (
      n &&
      (tsc.isParenthesizedExpression(n) ||
        tsc.isAwaitExpression(n) ||
        tsc.isAsExpression(n) ||
        tsc.isNonNullExpression(n))
    ) {
      const root = tsc.isAsExpression(n) ? castRoot(n) : undefined;
      if (root) return root;
      n = n.expression;
    }
    if (!n || depth > MAX_HOPS || seen.has(n)) return undefined;
    seen.add(n);
    if (tsc.isExpression(n)) {
      const root = rootAt(n);
      if (root) return root;
    }
    if (tsc.isCallExpression(n)) {
      const callee = n.expression;
      const decl = declarationOf(tsc.isPropertyAccessExpression(callee) ? callee.name : callee);
      if (decl && inRepo(decl)) return explained(returnedExpressions(tsc, decl), depth + 1);
      return undefined;
    }
    if (tsc.isObjectLiteralExpression(n)) {
      const members = n.properties.flatMap((p) => {
        if (tsc.isPropertyAssignment(p)) return [p.initializer];
        if (tsc.isShorthandPropertyAssignment(p)) return [p.name];
        return [];
      });
      return explained(members, depth + 1);
    }
    if (tsc.isPropertyAccessExpression(n)) {
      if (isAny(n.expression)) return origin(n.expression, depth + 1);
      // A member of the repository's own object (a returned literal's `errors`): its value.
      const symbol = checker.getSymbolAtLocation(n.name);
      for (const decl of symbol?.declarations ?? []) {
        if (!inRepo(decl) || !tsc.isPropertyAssignment(decl)) continue;
        const root = origin(decl.initializer, depth + 1);
        if (root) return root;
      }
      return undefined;
    }
    if (!tsc.isIdentifier(n)) return undefined;
    const value = tsc.isShorthandPropertyAssignment(n.parent)
      ? checker.getShorthandAssignmentValueSymbol(n.parent)?.declarations?.[0]
      : declarationOf(n);
    if (!value || !inRepo(value)) return undefined;
    if (tsc.isVariableDeclaration(value)) return origin(value.initializer, depth + 1);
    if (tsc.isBindingElement(value)) {
      // Destructured: from the value the pattern takes apart.
      let holder: ts.Node = value.parent.parent;
      while (tsc.isBindingElement(holder)) holder = holder.parent.parent;
      return tsc.isVariableDeclaration(holder) ? origin(holder.initializer, depth + 1) : undefined;
    }
    if (tsc.isParameter(value)) {
      // A callback's parameter typed by nothing but an `any` receiver: `errors.map(e => …)`.
      const fn = value.parent;
      const call = fn.parent;
      if (
        (tsc.isArrowFunction(fn) || tsc.isFunctionExpression(fn)) &&
        tsc.isCallExpression(call) &&
        call.arguments.some((a) => a === fn) &&
        tsc.isPropertyAccessExpression(call.expression) &&
        isAny(call.expression.expression)
      )
        return origin(call.expression.expression, depth + 1);
    }
    return undefined;
  };
  return origin(offendingExpression(tsc, deepestAt(tsc, file, diagnostic.start)), 0);
}

/** Every value a function returns: its expression body, or each `return` outside nested functions. */
function returnedExpressions(tsc: typeof ts, decl: ts.Declaration): ts.Expression[] {
  let body: ts.Node | undefined;
  if (tsc.isVariableDeclaration(decl) && decl.initializer) body = decl.initializer;
  else if (tsc.isFunctionLike(decl) && 'body' in decl) body = (decl as { body?: ts.Node }).body;
  else return [];
  if (body && (tsc.isArrowFunction(body) || tsc.isFunctionExpression(body))) {
    if (!tsc.isBlock(body.body)) return [body.body];
    body = body.body;
  }
  if (!body || !tsc.isBlock(body)) return [];
  const returned: ts.Expression[] = [];
  const visit = (n: ts.Node): void => {
    if (tsc.isReturnStatement(n) && n.expression) returned.push(n.expression);
    else if (!tsc.isFunctionLike(n)) tsc.forEachChild(n, visit);
  };
  tsc.forEachChild(body, visit);
  return returned;
}

function findImportDeclaration(tsc: typeof ts, node: ts.Node): ts.ImportDeclaration | undefined {
  let n: ts.Node | undefined = node;
  while (n && !tsc.isImportDeclaration(n)) n = n.parent;
  return n;
}

function returnedExpression(tsc: typeof ts, decl: ts.Declaration): ts.Expression | undefined {
  let body: ts.Node | undefined;
  if (tsc.isVariableDeclaration(decl) && decl.initializer) body = decl.initializer;
  else if (tsc.isFunctionLike(decl) && 'body' in decl) body = (decl as { body?: ts.Node }).body;
  if (!body) return undefined;
  if (tsc.isArrowFunction(body) || tsc.isFunctionExpression(body)) body = body.body;
  if (body && tsc.isExpression(body)) return body;
  let returned: ts.Expression | undefined;
  const visit = (n: ts.Node): void => {
    if (returned) return;
    if (tsc.isReturnStatement(n) && n.expression) returned = n.expression;
    else if (!tsc.isFunctionLike(n)) tsc.forEachChild(n, visit);
  };
  if (body) tsc.forEachChild(body, visit);
  return returned;
}

function clip(text: string): string {
  const one = text.replace(/\s+/g, ' ');
  return one.length > 80 ? `${one.slice(0, 77)}...` : one;
}

function causeAt(tsc: typeof ts, decl: ts.Node, reason: string, repoDir: string): DiagnosticCause {
  const file = decl.getSourceFile();
  let holder: ts.Node = decl;
  let named = tsc.getNameOfDeclaration(decl as ts.Declaration);
  while (!named && holder.parent && !tsc.isSourceFile(holder.parent)) {
    holder = holder.parent;
    if (tsc.isBlock(holder) || tsc.isCallExpression(holder)) break;
    named = tsc.getNameOfDeclaration(holder as ts.Declaration);
  }
  const { line } = file.getLineAndCharacterOfPosition((named ?? decl).getStart());
  return {
    name: named ? named.getText() : '(anonymous)',
    file: relative(repoDir, file.fileName).split('\\').join('/'),
    line: line + 1,
    reason,
  };
}

/** Argument not assignable to parameter; type not assignable (a JSX attribute to its prop). */
const MISMATCH_CODES = new Set([2345, 2322]);

/**
 * A mismatch the compiler reports at an argument whose parameter is a repository declaration:
 * `usePassThroughWheelEvents(ref)` rejected at eleven call sites because the hook's parameter
 * is typed `RefObject<HTMLElement>` and the target's `useRef` now returns
 * `RefObject<HTMLElement | null>`. The one edit is the parameter (or the prop, for a JSX
 * attribute), as the migration guides say; the call sites are evidence. The parameter is
 * blamed only when its declared type names something from outside the repository (a package
 * or library type), and the caller clusters the result: a parameter one site trips is left
 * to that site.
 */
export function parameterCause(
  programs: Programs,
  diagnostic: ts.Diagnostic,
  file: ts.SourceFile,
  repoDir: string,
  /** The repository root: another workspace's source (mapped from `workspace:*`) is the repository's too. */
  rootDir = repoDir,
): DiagnosticCause | undefined {
  const tsc = programs.ts;
  if (diagnostic.start === undefined || !MISMATCH_CODES.has(diagnostic.code)) return undefined;
  const checker = programs.overlay.getTypeChecker();
  const inRepo = (n: ts.Node): boolean => {
    const f = n.getSourceFile().fileName;
    return f.startsWith(`${rootDir}/`) && !f.includes('/node_modules/');
  };
  const node = deepestAt(tsc, file, diagnostic.start);
  let decl: ts.Declaration | undefined;
  // An argument of a call: the parameter it lands on, through the resolved signature.
  for (let n: ts.Node | undefined = node; n && !tsc.isStatement(n); n = n.parent) {
    const parent: ts.Node | undefined = n.parent;
    if (parent && (tsc.isCallExpression(parent) || tsc.isNewExpression(parent))) {
      // The callee of an inner call (`use(boxed())` reported at `boxed`): keep climbing.
      const index = parent.arguments?.indexOf(n as ts.Expression) ?? -1;
      if (index < 0) continue;
      const signature = checker.getResolvedSignature(parent);
      const parameters = signature?.parameters ?? [];
      const parameter = parameters[Math.min(index, parameters.length - 1)];
      decl = parameter?.valueDeclaration;
      break;
    }
    if (parent && tsc.isJsxAttribute(parent) && parent.initializer === n) {
      const symbol = checker.getSymbolAtLocation(parent.name);
      decl = symbol?.declarations?.[0];
      break;
    }
  }
  if (!decl || !inRepo(decl)) return undefined;
  if (!tsc.isParameter(decl) && !tsc.isPropertySignature(decl) && !tsc.isPropertyDeclaration(decl))
    return undefined;
  const typeNode = decl.type;
  if (!typeNode || !namesForeignType(tsc, typeNode, checker, inRepo)) return undefined;
  const site = `${relative(repoDir, file.fileName)}:${file.getLineAndCharacterOfPosition(diagnostic.start).line + 1}`;
  const at = decl.getSourceFile();
  const declLine = `${relative(repoDir, at.fileName)}:${at.getLineAndCharacterOfPosition(decl.getStart()).line + 1}`;
  if (declLine === site) return undefined;
  const what = tsc.isParameter(decl) ? 'parameter' : 'prop';
  const name = tsc.getNameOfDeclaration(decl)?.getText() ?? '(anonymous)';
  const cause = causeAt(
    tsc,
    decl,
    `whose ${what} \`${name}: ${clip(typeNode.getText())}\` no longer accepts what the target gives it; widen the ${what}'s type there`,
    repoDir,
  );
  // The anchor is the parameter itself, not the function that holds it.
  return { ...cause, name, line: cause.line, anchorOnly: true };
}

/** Whether a type annotation refers to a type declared outside the repository. */
function namesForeignType(
  tsc: typeof ts,
  typeNode: ts.TypeNode,
  checker: ts.TypeChecker,
  inRepo: (n: ts.Node) => boolean,
): boolean {
  let foreign = false;
  const visit = (n: ts.Node): void => {
    if (foreign) return;
    if (tsc.isTypeReferenceNode(n) || tsc.isExpressionWithTypeArguments(n)) {
      const name = tsc.isTypeReferenceNode(n) ? n.typeName : n.expression;
      const symbol = checker.getSymbolAtLocation(name);
      const target =
        symbol && symbol.flags & tsc.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      if (target?.declarations?.some((d) => !inRepo(d))) foreign = true;
    }
    tsc.forEachChild(n, visit);
  };
  visit(typeNode);
  return foreign;
}

/** Property missing on a type; property missing with a suggestion. */
const MISSING_MEMBER_CODES = new Set([2339, 2551]);

/**
 * A member the target no longer sees that reaches the installed type through an augmentation
 * the repository takes part in. `declare global { namespace jest { interface Matchers<R> {
 * toMatchPdfSnapshot(): R } } }` in a setup file, read by the installed `expect` and ignored by
 * the target's: every `expect(x).toMatchPdfSnapshot()` then fails with TS2339 or TS2551, and
 * the one edit is the declaration. The member may also come from a package's own types on
 * the same global interface (`jest-image-snapshot` declares `toMatchImageSnapshot` there):
 * then the repository's augmentation of that interface is still where the change goes, since
 * the matchers it registers have to move to the interface the target reads together. The
 * member is resolved in the baseline program, where it still exists; a `declare global` block
 * is anchored at the block, a `declare module "x"` augmentation at the interface inside it,
 * any other repository declaration at itself. One site is enough: the edit is never at the
 * call.
 */
export function augmentationCause(
  programs: Programs,
  diagnostic: ts.Diagnostic,
  file: ts.SourceFile,
  repoDir: string,
  /** The repository root: another workspace's source (mapped from `workspace:*`) is the repository's too. */
  rootDir = repoDir,
): DiagnosticCause | undefined {
  const tsc = programs.ts;
  if (diagnostic.start === undefined || !MISSING_MEMBER_CODES.has(diagnostic.code))
    return undefined;
  const inRepo = (n: ts.Node): boolean => {
    const f = n.getSourceFile().fileName;
    return f.startsWith(`${rootDir}/`) && !f.includes('/node_modules/');
  };
  const name = deepestAt(tsc, file, diagnostic.start);
  if (!tsc.isIdentifier(name) && !tsc.isPrivateIdentifier(name)) return undefined;
  // The baseline still resolves the member; its declaration says where it came from.
  const before = counterpart(tsc, name, programs.base);
  if (!before) return undefined;
  const checker = programs.base.getTypeChecker();
  const member = checker.getSymbolAtLocation(before)?.declarations?.[0];
  if (!member) return undefined;
  let decl: ts.Node | undefined = inRepo(member) ? member : undefined;
  let elsewhere: string | undefined;
  if (!decl) {
    // Declared by a package on an interface the repository augments too: the repository's own
    // augmentation (this workspace's first) is the place.
    const owner = member.parent;
    if (!owner || !tsc.isInterfaceDeclaration(owner)) return undefined;
    const declarations = (checker.getSymbolAtLocation(owner.name)?.declarations ?? []).filter(
      (d) => inRepo(d) && isAugmentation(tsc, d),
    );
    decl =
      declarations.find((d) => d.getSourceFile().fileName.startsWith(`${repoDir}/`)) ??
      declarations[0];
    if (!decl) return augmentationImportCause(programs, before, member, repoDir, rootDir);
    elsewhere = packageOf(member.getSourceFile().fileName);
  }
  const site = `${relative(repoDir, file.fileName)}:${file.getLineAndCharacterOfPosition(diagnostic.start).line + 1}`;
  // The declaration's container: the outermost `declare global`, else the interface (or other
  // named declaration) inside a `declare module "x"` block, else the declaration itself.
  let holder: ts.Node | undefined = tsc.isInterfaceDeclaration(decl) ? decl : undefined;
  let global: ts.ModuleDeclaration | undefined;
  let augmented: string | undefined;
  for (let n: ts.Node | undefined = decl.parent; n && !tsc.isSourceFile(n); n = n.parent) {
    if (tsc.isModuleDeclaration(n)) {
      if (n.flags & tsc.NodeFlags.GlobalAugmentation) global = n;
      else if (tsc.isStringLiteral(n.name)) augmented = n.name.text;
    } else if (
      !holder &&
      (tsc.isInterfaceDeclaration(n) || tsc.isTypeAliasDeclaration(n) || tsc.isClassDeclaration(n))
    )
      holder = n;
  }
  const anchor: ts.Node = global ?? holder ?? decl;
  const at = anchor.getSourceFile();
  const line = at.getLineAndCharacterOfPosition(anchor.getStart()).line + 1;
  if (`${relative(repoDir, at.fileName)}:${line}` === site) return undefined;
  const memberName = tsc.getNameOfDeclaration(member)?.getText() ?? name.getText();
  const path = qualifiedName(tsc, decl, holder);
  const declares = elsewhere
    ? `which augments \`${path}\`, the interface \`${memberName}\` is declared on (by ${elsewhere})`
    : `which declares \`${memberName}\` on \`${path}\``;
  const reason = global
    ? `${declares}, a global augmentation the target no longer reads; declare the matchers on the interface the target reads instead`
    : augmented !== undefined
      ? `${declares} in an augmentation of "${augmented}", a shape the target no longer merges; match the target's declaration there`
      : `${declares}, which the target no longer reads at this site`;
  return {
    name: path,
    file: relative(repoDir, at.fileName).split('\\').join('/'),
    line,
    reason,
    anchorOnly: true,
  };
}

/** `jest.Matchers` for a member inside `namespace jest { interface Matchers }`; the holder's name alone otherwise. */
function qualifiedName(tsc: typeof ts, decl: ts.Node, holder: ts.Node | undefined): string {
  const parts: string[] = [];
  const named = holder ? tsc.getNameOfDeclaration(holder as ts.Declaration)?.getText() : undefined;
  if (named) parts.push(named);
  for (
    let n: ts.Node | undefined = (holder ?? decl).parent;
    n && !tsc.isSourceFile(n);
    n = n.parent
  ) {
    if (
      tsc.isModuleDeclaration(n) &&
      tsc.isIdentifier(n.name) &&
      !(n.flags & tsc.NodeFlags.GlobalAugmentation)
    )
      parts.unshift(n.name.text);
  }
  return (
    parts.join('.') ||
    (tsc.getNameOfDeclaration(decl as ts.Declaration)?.getText() ?? '(anonymous)')
  );
}
