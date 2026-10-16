import { join, resolve } from 'node:path';
import {
  type BindingElement,
  type Expression,
  type Identifier,
  Node,
  Project,
  type PropertyAccessExpression,
  type SourceFile,
  SyntaxKind,
  ts,
} from 'ts-morph';
import { packageImports, projectFiles } from '../../check/importers.js';
import type { Finding } from '../../domain/report.js';
import type { Usage } from '../../domain/usage.js';
import { onReset } from '../../shared-state.js';
import type { SourceSite } from '../contract.js';
import type { TransformResult } from '../types.js';

/**
 * `ZodError#formErrors` and `#errors` are gone in zod 4 (both read `undefined`). On a typed
 * error the compiler says so; on a catch binding (`any`, or `unknown` cast to `any`) it says
 * nothing, so the type diff cannot see the site:
 *
 *   try { schema.parse(values) } catch (error: any) { return error.formErrors.fieldErrors }
 *
 * These are found from the syntax: the try block parses with a zod schema, and the catch block
 * reads one of the removed members off its own binding.
 */
export const RULE = 'error-members';
/** `ZodError#errors` where the compiler sees it: the type diff's finding, renamed to `issues`. */
export const ISSUES_RULE = 'error-issues';
const REMOVED = new Set(['formErrors', 'errors']);
const FLAT = new Set(['fieldErrors', 'formErrors']);
const MENTIONS = /\bformErrors\b|\.errors\b/;
/** The specifier whose `ZodError` lost the members: zod 4's root. `zod/v3` keeps them. */
const ZOD = 'zod';
const ZODS = new Set([ZOD]);

const parsed = new Map<string, SourceFile>();
onReset(() => parsed.clear());
function parse(text: string, file: string): SourceFile {
  const key = `${/\.[cm]?[jt]sx$/.test(file) ? 'x' : ''}:${text}`;
  let source = parsed.get(key);
  if (!source) {
    // JSX must parse as JSX: the forms this rule exists for are `.tsx`.
    source = new Project({ useInMemoryFileSystem: true }).createSourceFile(
      /\.[cm]?[jt]sx$/.test(file) ? 'consumer.tsx' : 'consumer.ts',
      text,
    );
    if (parsed.size >= 16) parsed.delete(parsed.keys().next().value as string);
    parsed.set(key, source);
  }
  return source;
}

const unwrap = (node: Node): Node => {
  let at = node;
  while (Node.isParenthesizedExpression(at) || Node.isNonNullExpression(at))
    at = at.getExpression();
  return at;
};
/** `(e as any)`: the cast that hides a catch binding's `unknown` from the compiler. */
const uncast = (node: Node): Node => {
  const at = unwrap(node);
  if (Node.isAsExpression(at) && at.getTypeNode()?.getKind() === SyntaxKind.AnyKeyword)
    return unwrap(at.getExpression());
  return at;
};
const untyped = (type: Node | undefined): boolean =>
  !type || type.getKind() === SyntaxKind.AnyKeyword || type.getKind() === SyntaxKind.UnknownKeyword;

function declarationOf(identifier: Identifier): Node | undefined {
  return identifier.getSymbol()?.getDeclarations()[0];
}
function fromZod(declaration: Node | undefined): boolean {
  const imported = declaration?.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
  if (!imported || imported.getModuleSpecifierValue() !== ZOD || imported.isTypeOnly())
    return false;
  return !(Node.isImportSpecifier(declaration) && declaration.isTypeOnly());
}

/**
 * Whether `expression` is a zod schema as the file writes it: a chain rooted at a zod import
 * (`z.object({...}).strict()`), a local constant initialized with one, or a name `schemas`
 * says another module of the repository exports as one.
 */
function isSchema(expression: Node, schemas: ReadonlySet<string>, depth = 0): boolean {
  if (depth > 8) return false;
  let root = unwrap(expression);
  while (Node.isPropertyAccessExpression(root) || Node.isCallExpression(root))
    root = unwrap(root.getExpression());
  if (!Node.isIdentifier(root)) return false;
  const declaration = declarationOf(root);
  if (!declaration) return false;
  if (fromZod(declaration)) return true;
  if (
    (Node.isImportSpecifier(declaration) ||
      Node.isImportClause(declaration) ||
      Node.isNamespaceImport(declaration)) &&
    !declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)?.isTypeOnly()
  )
    return schemas.has(root.getText());
  if (Node.isVariableDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    return initializer !== undefined && isSchema(initializer, schemas, depth + 1);
  }
  return false;
}

const PARSE = new Set(['parse', 'parseAsync']);
function parsesWithZod(block: Node, schemas: ReadonlySet<string>): boolean {
  return block.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
    const callee = call.getExpression();
    return (
      Node.isPropertyAccessExpression(callee) &&
      PARSE.has(callee.getName()) &&
      isSchema(callee.getExpression(), schemas)
    );
  });
}

/**
 * The binding a receiver stands for, when it is the catch clause's own: the binding itself,
 * `(e as any)`, or a local `const err = e` (or `e as any`) without a type of its own.
 */
function caughtBy(receiver: Node, binding: Node): boolean {
  const at = uncast(receiver);
  if (!Node.isIdentifier(at)) return false;
  const declaration = declarationOf(at);
  if (declaration === binding) return true;
  if (
    Node.isVariableDeclaration(declaration) &&
    untyped(declaration.getTypeNode()) &&
    declaration.getInitializer()
  ) {
    const from = uncast(declaration.getInitializer() as Node);
    return Node.isIdentifier(from) && declarationOf(from) === binding;
  }
  return false;
}

/** The removed members read off a caught zod error, in one file. */
function removedReads(
  source: SourceFile,
  schemas: ReadonlySet<string>,
): PropertyAccessExpression[] {
  const reads: PropertyAccessExpression[] = [];
  for (const statement of source.getDescendantsOfKind(SyntaxKind.TryStatement)) {
    const clause = statement.getCatchClause();
    const binding = clause?.getVariableDeclaration();
    if (!clause || !binding || !Node.isIdentifier(binding.getNameNode())) continue;
    if (!untyped(binding.getTypeNode())) continue;
    if (!parsesWithZod(statement.getTryBlock(), schemas)) continue;
    const block = clause.getBlock();
    // Narrowed (`e instanceof ZodError`): the compiler sees the member, and says so.
    if (
      block
        .getDescendantsOfKind(SyntaxKind.BinaryExpression)
        .some(
          (b) =>
            b.getOperatorToken().getKind() === SyntaxKind.InstanceOfKeyword &&
            caughtBy(b.getLeft(), binding),
        )
    )
      continue;
    for (const access of block.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression))
      if (REMOVED.has(access.getName()) && caughtBy(access.getExpression(), binding))
        reads.push(access);
  }
  return reads;
}

function usesZod(source: SourceFile, schemas: ReadonlySet<string>): boolean {
  return (
    schemas.size > 0 ||
    source.getImportDeclarations().some((d) => d.getModuleSpecifierValue() === ZOD)
  );
}

/** Specifiers that name a module of the repository, not a package: relative, or an alias. */
const LOCAL = /^(?:\.{1,2}\/|[@~#]\/)/;
/**
 * Without the repository (fixtures, `detect`), the names imported from a local specifier stand
 * in for the resolved ones `packageImports` gives `check`.
 */
function localImports(source: SourceFile, local = LOCAL): Set<string> {
  const names = new Set<string>();
  for (const d of source.getImportDeclarations()) {
    if (d.isTypeOnly() || !local.test(d.getModuleSpecifierValue())) continue;
    const fallback = d.getDefaultImport();
    if (fallback) names.add(fallback.getText());
    const namespace = d.getNamespaceImport();
    if (namespace) names.add(namespace.getText());
    for (const s of d.getNamedImports())
      if (!s.isTypeOnly()) names.add((s.getAliasNode() ?? s.getNameNode()).getText());
  }
  return names;
}

/**
 * Sites in one file. `schemas` are the names it imports from the repository's own modules
 * that are zod schemas there (`packageImports`); without them, the names it imports from local
 * specifiers. A file that neither imports zod nor such a name has none.
 */
export function errorMemberSites(
  text: string,
  file: string,
  schemas?: ReadonlySet<string>,
): SourceSite[] {
  if (!MENTIONS.test(text)) return [];
  const source = parse(text, file);
  const names = schemas ?? localImports(source);
  if (!usesZod(source, names)) return [];
  return removedReads(source, names).map((access) => {
    const { line, column } = source.getLineAndColumnAtPos(access.getStart());
    return {
      line,
      column,
      snippet: (text.split('\n')[line - 1] ?? '').trim(),
      name: `ZodError#${access.getName()}`,
    };
  });
}

/**
 * The pack's own findings for one workspace: the files that use zod, and the files importing
 * a zod schema from one of them, which the type scan does not visit (a form validating with
 * `updateAccountSchema` from `@/lib/zod` never names zod itself). Files are workspace-relative,
 * as the usages are.
 */
export function errorMemberFindings(input: {
  root: string;
  workspace: string;
  from: string;
  to: string;
  usages: readonly Usage[];
  read: (file: string) => string | undefined;
  rewrite: (text: string, finding: Finding) => TransformResult;
}): Finding[] {
  const dir = resolve(input.root, input.workspace);
  const direct = [...new Set(input.usages.map((u) => u.file))].sort();
  // The project's own files, not only those the scan visited: the text test is the cheap part.
  const { files: own, options } = projectFiles(dir);
  const findings: Finding[] = [];
  for (const file of [...new Set([...direct, ...own])].sort()) {
    const text = input.read(join(input.workspace, file));
    if (text === undefined || !MENTIONS.test(text)) continue;
    for (const site of errorMemberSites(
      text,
      file,
      packageImports(join(dir, file), ZODS, options),
    )) {
      const finding: Finding = {
        change: {
          package: ZOD,
          from: input.from,
          to: input.to,
          path: site.name as string,
          kind: 'removed',
          severity: 'breaking',
          source: 'pack',
          confidence: 1,
        },
        usage: {
          file,
          line: site.line,
          column: site.column,
          endLine: site.line,
          endColumn: site.column,
          symbolPath: site.name as string,
          access: 'read',
          snippet: site.snippet,
          via: 'direct',
        },
        severity: 'breaking',
        confidence: 1,
        fixability: 'assisted',
        reason: `${site.name} was removed in zod 4; the catch binding is untyped, so the compiler cannot report it`,
        rule: RULE,
      };
      if (input.rewrite(text, finding).applied) finding.fixability = 'mechanical';
      findings.push(finding);
    }
  }
  return findings;
}

const IMPORT_LINE = "import { z } from 'zod';";

/**
 * The read of `name` at the reported site, allowing for the one import line this rule may have
 * added above it. Detection reports a read where it starts (`e.formErrors`); the type diff
 * where the member is named (`errors` in `e.errors`, or in a destructured `{ errors }`).
 */
function readAt(
  source: SourceFile,
  text: string,
  finding: Finding,
  name = 'formErrors',
): PropertyAccessExpression | BindingElement | undefined {
  const lines = text.split('\n');
  const added = lines.indexOf(IMPORT_LINE);
  for (const shift of added >= 0 && added < finding.usage.line - 1 ? [0, 1] : [0]) {
    const line = finding.usage.line + shift;
    if (line > lines.length) continue;
    if (shift && (lines[line - 1] ?? '').trim() !== finding.usage.snippet) continue;
    const text = lines[line - 1] ?? '';
    if (finding.usage.column - 1 > text.length) continue;
    const position =
      lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + finding.usage.column - 1;
    // The innermost: `e.formErrors.formErrors` starts both reads at one place.
    const access = source
      .getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
      .filter(
        (a) =>
          a.getName() === name &&
          (a.getStart() === position || a.getNameNode().getStart() === position),
      )
      .sort((x, y) => x.getWidth() - y.getWidth())[0];
    if (access) return access;
    const element = source
      .getDescendantsOfKind(SyntaxKind.BindingElement)
      .find(
        (e) =>
          e.getStart() === position &&
          (e.getPropertyNameNode() ?? e.getNameNode()).getText() === name,
      );
    if (element) return element;
  }
  return undefined;
}

/** The name zod's namespace has where `at` is, and the edit that brings it in when it has none. */
function zodName(
  source: SourceFile,
  at: Node,
): { name: string; edit?: { start: number; text: string } } | undefined {
  const visible = new Map(
    at.getSymbolsInScope(ts.SymbolFlags.Value | ts.SymbolFlags.Alias).map((s) => [s.getName(), s]),
  );
  for (const declaration of source.getImportDeclarations()) {
    if (declaration.getModuleSpecifierValue() !== ZOD || declaration.isTypeOnly()) continue;
    const candidates: Node[] = [];
    const namespace = declaration.getNamespaceImport();
    if (namespace) candidates.push(namespace);
    const fallback = declaration.getDefaultImport();
    if (fallback) candidates.push(fallback);
    for (const specifier of declaration.getNamedImports())
      if (specifier.getName() === 'z' && !specifier.isTypeOnly())
        candidates.push(specifier.getAliasNode() ?? specifier.getNameNode());
    for (const candidate of candidates) {
      const symbol = visible.get(candidate.getText());
      if (
        symbol
          ?.getDeclarations()
          .some((d) => d.getFirstAncestorByKind(SyntaxKind.ImportDeclaration) === declaration)
      )
        return { name: candidate.getText() };
    }
  }
  if (visible.has('z') || source.getLocal('z')) return undefined;
  // An existing value import from zod takes `z` on the same line: no line moves.
  const named = source
    .getImportDeclarations()
    .find(
      (d) =>
        d.getModuleSpecifierValue() === ZOD &&
        !d.isTypeOnly() &&
        !d.getNamespaceImport() &&
        d.getNamedImports().length > 0,
    );
  if (named) {
    const first = named.getNamedImports()[0] as Node;
    return { name: 'z', edit: { start: first.getStart(), text: 'z, ' } };
  }
  // A reported file imports zod or a schema, so it has an import to follow.
  const last = source.getImportDeclarations().at(-1);
  return last ? { name: 'z', edit: { start: last.getEnd(), text: `\n${IMPORT_LINE}` } } : undefined;
}

/**
 * `<err>.formErrors.fieldErrors` and `<err>.formErrors.formErrors` become
 * `z.flattenError(<err>).fieldErrors` / `.formErrors`: zod 3's `formErrors` was `flatten()`,
 * and `z.flattenError` is zod 4's flat error object with the same two fields
 * (https://zod.dev/error-formatting#zflattenerror; `.flatten()` itself is deprecated,
 * https://zod.dev/v4/changelog#deprecates-flatten). Any other read is the agent's.
 */
export function rewriteErrorMembers(text: string, finding: Finding): TransformResult {
  const decline = (reason: string): TransformResult => ({ text, applied: false, reason });
  if (/ZodError#errors$/.test(finding.change.path)) return rewriteErrors(text, finding, true);
  if (!/ZodError#formErrors$/.test(finding.change.path))
    return decline('only formErrors.fieldErrors and formErrors.formErrors are rewritten by rule');
  const source = parse(text, finding.usage.file);
  const access = readAt(source, text, finding);
  if (!access || Node.isBindingElement(access))
    return decline('the reported formErrors read is not at the site');
  // Only a read detection reports: caught from a zod parse. Any imported name may be the schema
  // here, since `check` proved which ones are before it reported the site.
  if (!removedReads(source, localImports(source, /^(?!zod$)/)).includes(access))
    return decline('not a formErrors read off an error caught from a zod parse');
  const parent = access.getParent();
  if (
    !Node.isPropertyAccessExpression(parent) ||
    parent.getExpression() !== access ||
    !FLAT.has(parent.getName()) ||
    access.hasQuestionDotToken() ||
    parent.hasQuestionDotToken()
  )
    return decline('only formErrors.fieldErrors and formErrors.formErrors are rewritten by rule');
  const outer = parent.getParent();
  if (
    (Node.isBinaryExpression(outer) &&
      outer.getLeft() === parent &&
      outer.getOperatorToken().getKind() >= SyntaxKind.FirstAssignment &&
      outer.getOperatorToken().getKind() <= SyntaxKind.LastAssignment) ||
    Node.isDeleteExpression(outer) ||
    Node.isPrefixUnaryExpression(outer) ||
    Node.isPostfixUnaryExpression(outer)
  )
    return decline('a write to the flattened error needs manual review');
  const zod = zodName(source, access);
  if (!zod) return decline('`z` names something else here; import zod under another name by hand');
  const receiver = unwrap(access.getExpression()) as Expression;
  const edits = [
    {
      start: access.getStart(),
      end: access.getEnd(),
      text: `${zod.name}.flattenError(${receiver.getText()})`,
    },
    ...(zod.edit ? [{ ...zod.edit, end: zod.edit.start }] : []),
  ].sort((a, b) => b.start - a.start);
  let result = text;
  for (const e of edits) result = result.slice(0, e.start) + e.text + result.slice(e.end);
  return {
    text: result,
    applied: true,
    rule: RULE,
    reason: `formErrors was flatten(); z.flattenError keeps .${parent.getName()}`,
  };
}

/**
 * `<err>.errors` becomes `<err>.issues`, and a destructured `{ errors }` keeps its local name as
 * `{ issues: errors }`: zod 3's `errors` was an alias of `issues`
 * (https://zod.dev/v4/changelog#drops-errors). `caught` is a site this rule detected off an
 * untyped catch binding, rewritten only where detection still reports it; otherwise the site is
 * the type diff's, whose receiver the checker resolved to `ZodError` (never the name alone).
 */
export function rewriteErrors(text: string, finding: Finding, caught = false): TransformResult {
  const decline = (reason: string): TransformResult => ({ text, applied: false, reason });
  if (!/ZodError#errors$/.test(finding.change.path))
    return decline('only ZodError#errors is renamed to issues');
  const source = parse(text, finding.usage.file);
  const at = readAt(source, text, finding, 'errors');
  if (!at) return decline('the reported errors read is not at the site');
  let edit: { start: number; end: number; text: string };
  if (Node.isBindingElement(at)) {
    if (caught) return decline('not an errors read off an error caught from a zod parse');
    if (at.getDotDotDotToken()) return decline('a rest element needs manual review');
    const property = at.getPropertyNameNode();
    edit = property
      ? { start: property.getStart(), end: property.getEnd(), text: 'issues' }
      : { start: at.getNameNode().getStart(), end: at.getNameNode().getStart(), text: 'issues: ' };
  } else {
    if (caught && !removedReads(source, localImports(source, /^(?!zod$)/)).includes(at))
      return decline('not an errors read off an error caught from a zod parse');
    let target: Node = at;
    while (
      Node.isParenthesizedExpression(target.getParent()) ||
      Node.isNonNullExpression(target.getParent())
    )
      target = target.getParent() as Node;
    const parent = target.getParent();
    if (
      (Node.isBinaryExpression(parent) &&
        parent.getLeft() === target &&
        parent.getOperatorToken().getKind() >= SyntaxKind.FirstAssignment &&
        parent.getOperatorToken().getKind() <= SyntaxKind.LastAssignment) ||
      Node.isDeleteExpression(parent) ||
      ((Node.isPrefixUnaryExpression(parent) || Node.isPostfixUnaryExpression(parent)) &&
        [SyntaxKind.PlusPlusToken, SyntaxKind.MinusMinusToken].includes(parent.getOperatorToken()))
    )
      return decline('a write to errors needs manual review');
    const name = at.getNameNode();
    edit = { start: name.getStart(), end: name.getEnd(), text: 'issues' };
  }
  return {
    text: text.slice(0, edit.start) + edit.text + text.slice(edit.end),
    applied: true,
    rule: caught ? RULE : ISSUES_RULE,
    reason: 'errors was an alias of issues',
  };
}
