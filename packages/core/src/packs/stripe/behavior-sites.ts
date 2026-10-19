import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ts } from 'ts-morph';
import { projectFiles } from '../../check/importers.js';
import type { RecordSite } from '../records.js';
import { type ApiClient, apiClients } from './relevance.js';

export interface StripeBehaviorContext {
  apiVersions: { from: string; to: string };
  apiClients?: ApiClient[];
  /** Clients whose explicit API pin is part of the selected API-version migration. */
  movingApiPins?: { file: string; line: number }[];
}

/** Resolve only syntax whose value is visible. Types alone cannot prove an optional key absent. */
export function stripeBehaviorSites(input: {
  root: string;
  workspace: string;
  phase: 'before' | 'after';
  stripe?: StripeBehaviorContext;
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
  function step(node: ts.Expression): ts.Expression | undefined {
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      return node.expression;
    if (ts.isIdentifier(node)) {
      const d = symbol(node)?.valueDeclaration;
      return d && ts.isVariableDeclaration(d) ? d.initializer : undefined;
    }
    if (ts.isCallExpression(node)) {
      const d = checker.getResolvedSignature(node)?.declaration;
      if (
        d &&
        (ts.isFunctionDeclaration(d) || ts.isArrowFunction(d) || ts.isFunctionExpression(d)) &&
        d.body
      ) {
        if (!ts.isBlock(d.body)) return d.body;
        const returns: ts.Expression[] = [];
        const visit = (n: ts.Node): void => {
          if (ts.isReturnStatement(n) && n.expression) returns.push(n.expression);
          else if (!ts.isFunctionLike(n)) ts.forEachChild(n, visit);
        };
        visit(d.body);
        if (returns.length === 1) return returns[0];
        const first = returns[0];
        if (
          first &&
          ts.isIdentifier(first) &&
          returns.every((r) => ts.isIdentifier(r) && symbol(r) === symbol(first))
        )
          return first;
      }
      return undefined;
    }
    return node;
  }
  function value(
    node: ts.Expression | undefined,
    seen = new Set<ts.Node>(),
  ): ts.Expression | undefined {
    if (!node || seen.has(node)) return undefined;
    seen.add(node);
    const next = step(node);
    return next === node ? node : value(next, seen);
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
        // Aliasing or passing the object to another function makes its runtime shape unknown.
        if (
          ts.isVariableDeclaration(n) &&
          n.initializer &&
          ts.isIdentifier(n.initializer) &&
          symbol(n.initializer) === binding
        )
          write = true;
        if (
          ts.isCallExpression(n) &&
          n !== call &&
          n.arguments.some((a) => ts.isIdentifier(a) && symbol(a) === binding)
        )
          write = true;
        if (
          ts.isDeleteExpression(n) &&
          (ts.isPropertyAccessExpression(n.expression) ||
            ts.isElementAccessExpression(n.expression)) &&
          symbol(n.expression.expression) === binding
        )
          write = true;
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
    const resolved = step(expr);
    if (resolved && resolved !== expr) return property(resolved, key, call, seen);
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
  const checkoutDeclaration = (node: ts.CallExpression) =>
    /\/node_modules\/stripe\/(?:types|cjs|esm)\/(?:resources\/)?Checkout\/Sessions(?:Resource)?\.d\.ts$/.test(
      checker.getResolvedSignature(node)?.declaration?.getSourceFile().fileName ?? '',
    ) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'create';
  function forwardsToCheckout(declaration: ts.Node): boolean {
    if (
      !(
        ts.isFunctionDeclaration(declaration) ||
        ts.isArrowFunction(declaration) ||
        ts.isFunctionExpression(declaration)
      ) ||
      !declaration.body
    )
      return false;
    const parameter = declaration.parameters[0];
    const binding = parameter && symbol(parameter.name);
    if (!binding) return false;
    const carries = (node: ts.Expression | undefined, seen = new Set<ts.Node>()): boolean => {
      if (!node || seen.has(node)) return false;
      seen.add(node);
      if (ts.isIdentifier(node) && symbol(node) === binding) return true;
      const next = step(node);
      if (next && next !== node) return carries(next, seen);
      return (
        ts.isObjectLiteralExpression(node) &&
        node.properties.some(
          (p) => ts.isSpreadAssignment(p) && carries(p.expression, new Set(seen)),
        )
      );
    };
    let found = false;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && checkoutDeclaration(node) && carries(node.arguments[0]))
        found = true;
      if (!ts.isFunctionLike(node)) ts.forEachChild(node, visit);
    };
    visit(declaration.body);
    return found;
  }
  const currentClients = apiClients(input.root, [input.workspace]);
  const clients = input.stripe?.apiClients ?? currentClients;
  function clientConstructor(
    expr: ts.Expression | undefined,
    seen = new Set<ts.Node>(),
  ): ts.NewExpression | undefined {
    if (!expr || seen.has(expr)) return undefined;
    seen.add(expr);
    if (ts.isNewExpression(expr)) return expr;
    if (ts.isPropertyAccessExpression(expr)) return clientConstructor(expr.expression, seen);
    const next = step(expr);
    const direct = next && next !== expr ? clientConstructor(next, seen) : undefined;
    if (direct) return direct;
    if (ts.isIdentifier(expr)) {
      const binding = symbol(expr);
      const declaration = binding?.valueDeclaration;
      const assignments: ts.Expression[] = [];
      const visit = (n: ts.Node): void => {
        if (
          ts.isBinaryExpression(n) &&
          n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isIdentifier(n.left) &&
          symbol(n.left) === binding
        )
          assignments.push(n.right);
        ts.forEachChild(n, visit);
      };
      if (declaration) visit(declaration.getSourceFile());
      if (assignments.length === 1) return clientConstructor(assignments[0], seen);
    }
    return undefined;
  }
  function requestVersion(
    node: ts.CallExpression,
    checkoutWrapper: boolean,
  ): 'crosses' | 'unchanged' | 'unknown' {
    // A per-request override takes precedence over the client's configuration.
    const options = node.arguments[1];
    const overrideProperty = (expr: ts.Expression | undefined): Property => {
      if (!expr || (ts.isIdentifier(expr) && expr.text === 'undefined')) return { state: 'absent' };
      if (ts.isConditionalExpression(expr)) {
        const a = overrideProperty(expr.whenTrue),
          b = overrideProperty(expr.whenFalse);
        return a.state === 'absent' && b.state === 'absent' ? a : { state: 'unknown' };
      }
      return property(expr, 'apiVersion', node);
    };
    const override = overrideProperty(options);
    const explicit = override.state === 'present' ? value(override.value) : undefined;
    if (explicit && ts.isStringLiteral(explicit)) return 'unchanged';
    if (override.state !== 'absent') return 'unknown';
    let ctor = clientConstructor(node.expression);
    if (!ctor && checkoutWrapper) {
      const d = checker.getResolvedSignature(node)?.declaration;
      const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && checkoutDeclaration(n))
          ctor ??= clientConstructor(n.expression);
        ts.forEachChild(n, visit);
      };
      if (d) visit(d);
    }
    const file = ctor && relative(input.root, ctor.getSourceFile().fileName);
    const line =
      ctor && ctor.getSourceFile().getLineAndCharacterOfPosition(ctor.getStart()).line + 1;
    const currentClient = currentClients.find((c) => c.file === file && c.line === line);
    const ordinal = currentClients
      .filter((c) => c.file === file)
      .indexOf(currentClient as ApiClient);
    const client = clients.filter((c) => c.file === file)[ordinal];
    // With no migration context, this is a structural scan, still respecting known pins.
    const defaults = input.stripe?.apiVersions ?? {
      from: '2025-08-27.basil',
      to: '2025-09-30.clover',
    };
    const pinProperty = ctor?.arguments?.[1] && property(ctor.arguments[1], 'apiVersion', node);
    const pinLiteral = pinProperty?.state === 'present' ? value(pinProperty.value) : undefined;
    const moving =
      !!pinLiteral &&
      input.stripe?.movingApiPins?.some(
        (p) =>
          p.file === relative(input.root, pinLiteral.getSourceFile().fileName) &&
          p.line ===
            pinLiteral.getSourceFile().getLineAndCharacterOfPosition(pinLiteral.getStart()).line +
              1,
      );
    const pin =
      client?.version !== undefined
        ? client.version
        : pinLiteral && ts.isStringLiteral(pinLiteral)
          ? pinLiteral.text
          : undefined;
    if (pin !== undefined) {
      const before = pin ?? defaults.from;
      const after =
        input.phase === 'after'
          ? (currentClient?.version ??
            (pinLiteral && ts.isStringLiteral(pinLiteral) ? pinLiteral.text : defaults.to))
          : moving || pin === null
            ? defaults.to
            : pin;
      return before < '2025-09-30.clover' && after >= '2025-09-30.clover' ? 'crosses' : 'unchanged';
    }
    if (ctor && !ctor.arguments?.[1])
      return defaults.from < '2025-09-30.clover' && defaults.to >= '2025-09-30.clover'
        ? 'crosses'
        : 'unchanged';
    return defaults.from < '2025-09-30.clover' && defaults.to >= '2025-09-30.clover'
      ? 'unknown'
      : 'unchanged';
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
        const resource =
          /\/node_modules\/stripe\/(?:types|cjs|esm)\/(?:resources\/)?(Invoices|SubscriptionSchedules|Quotes|PaymentLinks)(?:Resource)?\.d\.ts$/.exec(
            path,
          )?.[1];
        const parameter = declaration?.parameters[0];
        const paramType = parameter && checker.getTypeAtLocation(parameter);
        const checkoutWrapper =
          !!declaration &&
          forwardsToCheckout(declaration) &&
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
          (subscription || checkout || resource) &&
          (checkoutWrapper ||
            (ts.isPropertyAccessExpression(node.expression) &&
              node.expression.name.text === (resource === 'Invoices' ? 'createPreview' : 'create')))
        ) {
          const identity = `${subscription ? 'subscriptions' : checkout ? 'checkout' : resource}.create:${ordinal++}`;
          const version = requestVersion(node, checkoutWrapper);
          if (input.phase === 'before' && version === 'unchanged') {
            ts.forEachChild(node, visit);
            return;
          }
          const params = node.arguments[0];
          let target = params;
          let state: Property;
          let nesting = '';
          let decisionReason =
            version === 'unknown' ? 'Request API version could not be resolved' : undefined;
          const present = (key: string) => property(params, key, node);
          if (
            (resource === 'SubscriptionSchedules' &&
              present('from_subscription').state === 'present') ||
            (resource === 'Invoices' &&
              (present('subscription').state === 'present' ||
                present('schedule').state === 'present'))
          ) {
            // Existing subscriptions retain their mode; from_subscription forbids other params.
            ts.forEachChild(node, visit);
            return;
          }
          if (
            resource === 'SubscriptionSchedules' &&
            present('from_subscription').state === 'unknown'
          )
            decisionReason = 'Cannot establish whether this schedule creates a new subscription';
          if (resource === 'PaymentLinks')
            decisionReason =
              'Payment Link API exposes no billing_mode parameter; review recurring prices and Dashboard billing mode settings';
          if (resource === 'Quotes') {
            const items = present('line_items');
            const array = items.state === 'present' ? value(items.value) : undefined;
            const recurring =
              array &&
              ts.isArrayLiteralExpression(array) &&
              array.elements.some((item) => {
                const price = property(item, 'price_data', node);
                return (
                  price.state === 'present' &&
                  property(price.value, 'recurring', node).state === 'present'
                );
              });
            if (!recurring)
              decisionReason =
                'Cannot establish whether this quote creates a subscription from its prices';
          }
          if (checkout) {
            const mode = property(params, 'mode', node);
            const literal = mode.state === 'present' ? value(mode.value) : undefined;
            const modeSymbol = params && checker.getTypeAtLocation(params).getProperty('mode');
            const modeType =
              params && modeSymbol && checker.getTypeOfSymbolAtLocation(modeSymbol, params);
            const subscriptionMode =
              (literal && ts.isStringLiteral(literal) && literal.text === 'subscription') ||
              (mode.state === 'unknown' &&
                modeType?.isStringLiteral() &&
                modeType.value === 'subscription');
            if (!subscriptionMode) {
              ts.forEachChild(node, visit);
              return;
            }
          }
          if (checkout || resource === 'Quotes' || resource === 'PaymentLinks')
            nesting = 'subscription_data';
          if (resource === 'Invoices') {
            const sub = present('subscription_details');
            const schedule = present('schedule_details');
            nesting = schedule.state === 'present' ? 'schedule_details' : 'subscription_details';
            const details = nesting === 'schedule_details' ? schedule : sub;
            const creates =
              details.state === 'present' &&
              property(details.value, nesting === 'schedule_details' ? 'phases' : 'items', node)
                .state === 'present';
            if (sub.state === 'absent' && schedule.state === 'absent') {
              ts.forEachChild(node, visit);
              return;
            }
            if (!creates || (sub.state !== 'absent' && schedule.state !== 'absent'))
              decisionReason =
                'Cannot establish whether the preview creates a new subscription or schedule';
          }
          if (nesting) {
            const data = property(params, nesting, node);
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
              decision: state.state === 'unknown' || !!decisionReason,
              ...(decisionReason ? { decisionReason } : {}),
              edit: `${nesting ? `${nesting}.` : ''}billing_mode: { type: 'classic' }`,
              ...(input.phase === 'after' ? { kept, unaffected: version === 'unchanged' } : {}),
            });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...new Map(sites.map((site) => [`${site.file}:${site.line}`, site])).values()];
}
