import {
  type CallExpression,
  type Expression,
  Node,
  Project,
  type SourceFile,
  SyntaxKind,
} from 'ts-morph';
import type { SourceSite } from '../contract.js';

/** Methods whose first argument is a path: every HTTP verb Express 4 routes, `all`, `use`, `route`. */
const ROUTING = new Set([
  'all',
  'use',
  'route',
  'get',
  'post',
  'put',
  'delete',
  'patch',
  'options',
  'head',
]);

/** Express types a receiver can be declared as: an app or a router. */
const TYPES = /^(?:express\.)?(?:Express|Application|Router|IRouter)$/;

export function parse(text: string): SourceFile {
  return new Project({ useInMemoryFileSystem: true }).createSourceFile('consumer.ts', text, {
    overwrite: true,
  });
}

interface Names {
  /** Locals bound to the module: default import, namespace, `import x = require`, `const x = require`. */
  module: Set<string>;
  /** Locals bound to `Router`. */
  router: Set<string>;
}

function expressNames(source: SourceFile): Names {
  const module = new Set<string>();
  const router = new Set<string>();
  for (const declaration of source.getImportDeclarations()) {
    if (declaration.getModuleSpecifierValue() !== 'express') continue;
    const fallback = declaration.getDefaultImport();
    if (fallback) module.add(fallback.getText());
    const namespace = declaration.getNamespaceImport();
    if (namespace) module.add(namespace.getText());
    for (const element of declaration.getNamedImports())
      if (element.getName() === 'Router')
        router.add((element.getAliasNode() ?? element.getNameNode()).getText());
  }
  for (const node of source.getDescendantsOfKind(SyntaxKind.ImportEqualsDeclaration))
    if (/^require\(\s*['"]express['"]\s*\)$/.test(node.getModuleReference().getText()))
      module.add(node.getName());
  for (const variable of source.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = variable.getInitializer();
    if (!init || !/^require\(\s*['"]express['"]\s*\)$/.test(init.getText())) continue;
    const name = variable.getNameNode();
    if (Node.isIdentifier(name)) module.add(name.getText());
    else if (Node.isObjectBindingPattern(name))
      for (const element of name.getElements())
        if ((element.getPropertyNameNode() ?? element.getNameNode()).getText() === 'Router')
          router.add(element.getNameNode().getText());
  }
  return { module, router };
}

/** `express()`, `express.Router()`, `Router()`: an expression that makes an app or a router. */
function makesApp(expression: Node | undefined, names: Names): boolean {
  let inner = expression;
  while (inner && (Node.isParenthesizedExpression(inner) || Node.isAsExpression(inner)))
    inner = inner.getExpression();
  if (!inner || !Node.isCallExpression(inner)) return false;
  const callee = inner.getExpression().getText();
  return (
    names.module.has(callee) ||
    names.router.has(callee) ||
    [...names.module].some((m) => callee === `${m}.Router`)
  );
}

/**
 * The names (identifiers, and `this.<name>` properties) that hold an Express app or router in
 * this file: initialized or assigned from `express()` or `Router()`, or declared with an Express
 * app or router type. Anything else with a `.get` method (a Map, an HTTP client) is never one.
 */
function receivers(source: SourceFile, names: Names): Set<string> {
  const found = new Set<string>();
  const typed = (type: Node | undefined) => type !== undefined && TYPES.test(type.getText());
  for (const node of [
    ...source.getDescendantsOfKind(SyntaxKind.VariableDeclaration),
    ...source.getDescendantsOfKind(SyntaxKind.PropertyDeclaration),
    ...source.getDescendantsOfKind(SyntaxKind.Parameter),
  ]) {
    const name = node.getNameNode();
    if (
      Node.isIdentifier(name) &&
      (typed(node.getTypeNode()) || makesApp(node.getInitializer(), names))
    )
      found.add(name.getText());
  }
  for (const assignment of source.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    if (!makesApp(assignment.getRight(), names)) continue;
    const left = assignment.getLeft();
    found.add(Node.isPropertyAccessExpression(left) ? left.getName() : left.getText());
  }
  return found;
}

/** The app or router a routing call is made on: `app`, `this.app`, or the start of `app.route('/a').get(…)`. */
function receiverOf(callee: Expression): string | undefined {
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const target = callee.getExpression();
  if (Node.isIdentifier(target)) return target.getText();
  if (
    Node.isPropertyAccessExpression(target) &&
    target.getExpression().getKind() === SyntaxKind.ThisKeyword
  )
    return target.getName();
  if (Node.isCallExpression(target)) {
    const inner = target.getExpression();
    if (Node.isPropertyAccessExpression(inner) && ROUTING.has(inner.getName()))
      return receiverOf(inner);
  }
  return undefined;
}

/**
 * What path-to-regexp 8 (Express 5) reads differently from path-to-regexp 0.1 (Express 4) in a
 * route string, or `undefined` when it means the same: `*` (an unnamed wildcard in 4, a named one
 * in 8), `:name?` (an optional parameter in 4, `{/:name}` in 8), `?` `+` `(` `)` `[` `]` `!`
 * (reserved in 8, which throws at registration), `{` `}` (literal text in 4, an optional group in
 * 8), and a `:` with no parameter name after it.
 */
export function incompatible(path: string): string | undefined {
  if (path.includes('*')) return 'a `*` wildcard is named in Express 5 (`/*splat`, `/{*splat}`)';
  if (/:[A-Za-z_$][\w$]*\?/.test(path))
    return 'an optional parameter is `{/:name}` in Express 5, not `/:name?`';
  if (/[?+()[\]!]/.test(path))
    return '`?`, `+`, `(`, `)`, `[`, `]` and `!` are reserved in Express 5 route strings';
  if (/[{}]/.test(path))
    return '`{` and `}` are optional groups in Express 5, literal text in Express 4';
  if (/:(?![A-Za-z_$])/.test(path)) return 'a `:` needs a parameter name in Express 5';
  return undefined;
}

/**
 * A path argument's string parts: a literal, a template's static text, each element of an array
 * literal, and, for an identifier, the array or string a `const` or the array a `for…of` over a
 * `const` holds (`for (const path of proxyPaths) router.all(path, …)`).
 */
function paths(argument: Node | undefined, depth = 0): { node: Node; value: string }[] {
  if (!argument || depth > 4) return [];
  if (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument))
    return [{ node: argument, value: argument.getLiteralValue() }];
  if (Node.isTemplateExpression(argument))
    return [
      {
        node: argument,
        value: [
          argument.getHead().getLiteralText(),
          ...argument.getTemplateSpans().map((span) => span.getLiteral().getLiteralText()),
        ].join('x'),
      },
    ];
  if (Node.isArrayLiteralExpression(argument))
    return argument.getElements().flatMap((e) => paths(e, depth + 1));
  if (Node.isIdentifier(argument)) {
    const name = argument.getText();
    // The loop that binds it: `for (const path of list)`.
    for (const loop of argument.getAncestors())
      if (
        Node.isForOfStatement(loop) &&
        /^const\s/.test(loop.getInitializer().getText()) &&
        loop
          .getInitializer()
          .getText()
          .replace(/^const\s+/, '') === name
      )
        return paths(loop.getExpression(), depth + 1);
    // Else the one `const` of that name in the file, at any depth; a `let` can be reassigned and
    // a name declared twice is ambiguous, so neither is followed.
    const declarations = argument
      .getSourceFile()
      .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
      .filter((d) => d.getName() === name);
    const [only] = declarations;
    if (declarations.length === 1 && only?.getVariableStatement()?.getDeclarationKind() === 'const')
      return paths(only.getInitializer(), depth + 1);
  }
  return [];
}

/**
 * Route strings path-to-regexp 8 rejects or reads differently, on calls of an Express app or
 * router this file binds (`app.get('/*', …)`, `router.use('/:id?', …)`, `app.route('/a(b)?')`).
 * A path in a `const` or a `for…of` over one is followed; one in a `let` or computed is not.
 * A `RegExp` path means the same in both majors.
 */
export function routeSites(text: string): SourceSite[] {
  if (!/['"]express['"]/.test(text)) return [];
  const source = parse(text);
  const names = expressNames(source);
  const known = receivers(source, names);
  if (!known.size) return [];
  const sites: SourceSite[] = [];
  const lines = new Set<number>();
  for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || !ROUTING.has(callee.getName())) continue;
    const receiver = receiverOf(callee);
    if (!receiver || !known.has(receiver)) continue;
    // One registration, one site: a list of paths is reported at its first one Express 5 rejects.
    const first = paths(call.getArguments()[0])
      .map((path) => ({ ...path, why: incompatible(path.value) }))
      .find((path) => path.why);
    if (!first) continue;
    const { line, column } = source.getLineAndColumnAtPos(first.node.getStart());
    if (lines.has(line)) continue;
    lines.add(line);
    sites.push({
      line,
      column,
      snippet: text.split('\n')[line - 1]?.trim() ?? '',
      name: first.why,
    });
  }
  return sites.sort((a, b) => a.line - b.line);
}

function siteAt(source: SourceFile, node: Node, name: string): SourceSite {
  const { line, column } = source.getLineAndColumnAtPos(node.getStart());
  return { line, column, snippet: source.getFullText().split('\n')[line - 1]?.trim() ?? '', name };
}

/**
 * `app.param(fn)` and `router.param(fn)`: Express 4's deprecated form that customizes `param()`
 * itself is gone, and Express 5 throws "argument name must be a string" at startup. The two-argument
 * form (`app.param('id', fn)`) is unchanged and never reported.
 */
export function paramCallbackSites(text: string): SourceSite[] {
  if (!/\.param\(/.test(text) || !/['"]express['"]/.test(text)) return [];
  const source = parse(text);
  const known = receivers(source, expressNames(source));
  return source
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) => {
      const callee = call.getExpression();
      const receiver = Node.isPropertyAccessExpression(callee) ? receiverOf(callee) : undefined;
      return (
        Node.isPropertyAccessExpression(callee) &&
        callee.getName() === 'param' &&
        receiver !== undefined &&
        known.has(receiver) &&
        call.getArguments().length === 1
      );
    })
    .map((call) => siteAt(source, call, 'param(fn)'));
}

/**
 * The locals that are an Express response in this file: parameters and variables typed
 * `Response` (or `express.Response`) imported from express, and the second parameter of a
 * handler passed inline to a routing call on a known app or router.
 */
function responses(source: SourceFile): Set<string> {
  const names = expressNames(source);
  const local = new Set<string>();
  for (const declaration of source.getImportDeclarations())
    if (declaration.getModuleSpecifierValue() === 'express')
      for (const element of declaration.getNamedImports())
        if (element.getName() === 'Response')
          local.add((element.getAliasNode() ?? element.getNameNode()).getText());
  const typed = (type: string) =>
    local.has(type.replace(/<.*$/s, '')) ||
    [...names.module].some((m) => type.replace(/<.*$/s, '') === `${m}.Response`);
  const found = new Set<string>();
  for (const parameter of source.getDescendantsOfKind(SyntaxKind.Parameter)) {
    const type = parameter.getTypeNode()?.getText();
    if (type && typed(type)) found.add(parameter.getName());
  }
  const known = receivers(source, names);
  for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || !ROUTING.has(callee.getName())) continue;
    const receiver = receiverOf(callee);
    if (!receiver || !known.has(receiver)) continue;
    for (const handler of call.getArguments())
      if (Node.isArrowFunction(handler) || Node.isFunctionExpression(handler)) {
        const res = handler.getParameters()[1]?.getNameNode();
        if (res && Node.isIdentifier(res)) found.add(res.getText());
      }
  }
  return found;
}

function responseCalls(
  text: string,
  method: RegExp,
): { source: SourceFile; calls: CallExpression[] } {
  const source = parse(text);
  const known = responses(source);
  const calls = source.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || !method.test(callee.getName())) return false;
    let target: Expression = callee.getExpression();
    // `res.status(200).redirect(…)` is still the response.
    for (;;) {
      const inner = Node.isCallExpression(target) ? target.getExpression() : undefined;
      if (!inner || !Node.isPropertyAccessExpression(inner)) break;
      target = inner.getExpression();
    }
    return Node.isIdentifier(target) && known.has(target.getText());
  });
  return { source, calls };
}

const numeric = (node: Node | undefined) => node !== undefined && Node.isNumericLiteral(node);

/**
 * `res.redirect(url, 301)`: Express 5 reads `redirect(status, url)` only, so the URL and status
 * swap at runtime. Reported where the second argument is a status number and the first is not.
 */
export function redirectOrderSites(text: string): SourceSite[] {
  if (!/\.redirect\(/.test(text) || !/['"]express['"]/.test(text)) return [];
  const { source, calls } = responseCalls(text, /^redirect$/);
  return calls
    .filter((call) => {
      const [first, second] = call.getArguments();
      return numeric(second) && !numeric(first);
    })
    .map((call) => siteAt(source, call, 'redirect(url, status)'));
}

/** `res.redirect('back')` and `res.location('back')`: Express 5 redirects to a page named "back". */
export function redirectBackSites(text: string): SourceSite[] {
  if (!/['"`]back['"`]/.test(text) || !/['"]express['"]/.test(text)) return [];
  const { source, calls } = responseCalls(text, /^(?:redirect|location)$/);
  return calls
    .filter((call) =>
      (call as Node & { getArguments(): Node[] })
        .getArguments()
        .some(
          (a) =>
            (Node.isStringLiteral(a) || Node.isNoSubstitutionTemplateLiteral(a)) &&
            a.getLiteralValue() === 'back',
        ),
    )
    .map((call) => siteAt(source, call, "'back'"));
}

/**
 * `res.send(404)`: Express 4 sent the status; Express 5 sends the number as a JSON body with
 * status 200. The compiler accepts both (`send(body?: any)`).
 */
export function sendStatusSites(text: string): SourceSite[] {
  if (!/\.send\(\s*\d/.test(text) || !/['"]express['"]/.test(text)) return [];
  const { source, calls } = responseCalls(text, /^send$/);
  return calls
    .filter((call) => {
      const args = call.getArguments();
      return args.length === 1 && numeric(args[0]);
    })
    .map((call) => siteAt(source, call, 'send(status)'));
}

/**
 * Where one edit resolves `req.params` errors the compiler reports at their uses (UPT-91): a
 * `const { id, other } = req.params` whose names an error is reported on. The guide types the
 * values once, there, instead of at each use; that line is a site as well. Only a handler's own
 * `req` counts, and only where the compiler reported an error under it.
 *
 * A handler annotated bare `Request` is not an anchor: ground truth shows the same shape fixed
 * on the handler in one repository and at the use in another, so a site there is a guess.
 */
export function paramDestructureSites(
  text: string,
  errors: { line: number; column: number }[],
): SourceSite[] {
  if (!/['"]express['"]/.test(text)) return [];
  const source = parse(text);
  const sites = new Map<number, SourceSite>();
  for (const { line, column } of errors) {
    const at = source.getDescendantAtPos(
      source.compilerNode.getPositionOfLineAndCharacter(line - 1, column - 1),
    );
    const fn = at?.getAncestors().find(Node.isFunctionLikeDeclaration);
    const req = fn?.getParameters()[0];
    if (!at || !fn || !req || !Node.isIdentifier(req.getNameNode()) || !Node.isIdentifier(at))
      continue;
    for (const declaration of fn.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const binding = declaration.getNameNode();
      if (
        Node.isObjectBindingPattern(binding) &&
        declaration.getInitializer()?.getText() === `${req.getName()}.params` &&
        binding.getElements().some((e) => e.getNameNode().getText() === at.getText())
      ) {
        const site = siteAt(source, declaration, 'req.params');
        sites.set(site.line, site);
      }
    }
  }
  return [...sites.values()].sort((a, b) => a.line - b.line);
}
