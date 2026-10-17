import { join, resolve } from 'node:path';
import { ts } from 'ts-morph';
import { projectFiles } from '../../check/importers.js';
import type { Finding } from '../../domain/report.js';
import type { Usage } from '../../domain/usage.js';
import type { SourceSite } from '../contract.js';

/**
 * Zod 3's root exported its internals and the parts of its type machinery that zod 4 keeps
 * only under `zod/v3`: `SafeParseReturnType`, `ZodTypeDef`, `ZodEffects`, `ZodNativeEnum`,
 * the `Zod*Def` interfaces. The surface diff does not report them: each name is still exported
 * from `zod/v3`, so it counts as the same entry point, while a consumer importing `'zod'`
 * gets TS2305 or TS2724. Found from the syntax: a name imported from `'zod'` and each place
 * it is used, `z.Name` and `import('zod').Name`.
 *
 * The list is every top-level name of zod 3.25.76 whose entry points include `.` and which
 * 4.6.5 exports from `.` no more (from `zod/v3` only), read off the two extracted surfaces.
 */
const GONE = new Set([
  'AnyZodObject',
  'AnyZodTuple',
  'ArrayCardinality',
  'ArrayKeys',
  'AssertArray',
  'AsyncParseReturnType',
  'CatchallInput',
  'CatchallOutput',
  'CustomErrorParams',
  'DIRTY',
  'DenormalizedError',
  'EMPTY_PATH',
  'Effect',
  'EnumLike',
  'EnumValues',
  'ErrorMapCtx',
  'FilterEnum',
  'Indices',
  'InnerTypeOfFunction',
  'InputTypeOfTuple',
  'InputTypeOfTupleWithRest',
  'IpVersion',
  'KeySchema',
  'OK',
  'ObjectPair',
  'OuterTypeOfFunction',
  'OutputTypeOfTuple',
  'OutputTypeOfTupleWithRest',
  'ParseContext',
  'ParseInput',
  'ParseParams',
  'ParsePath',
  'ParsePathComponent',
  'ParseResult',
  'ParseReturnType',
  'ParseStatus',
  'PassthroughType',
  'PreprocessEffect',
  'Primitive',
  'ProcessedCreateParams',
  'RawCreateParams',
  'RecordType',
  'Refinement',
  'RefinementEffect',
  'SafeParseError',
  'SafeParseReturnType',
  'SafeParseSuccess',
  'Scalars',
  'SomeZodObject',
  'StringValidation',
  'SuperRefinement',
  'SyncParseReturnType',
  'TransformEffect',
  'UnknownKeysParam',
  'Values',
  'Writeable',
  'ZodAnyDef',
  'ZodArrayDef',
  'ZodBigIntCheck',
  'ZodBigIntDef',
  'ZodBooleanDef',
  'ZodBranded',
  'ZodBrandedDef',
  'ZodCatchDef',
  'ZodCustomIssue',
  'ZodDateCheck',
  'ZodDateDef',
  'ZodDefaultDef',
  'ZodDiscriminatedUnionDef',
  'ZodDiscriminatedUnionOption',
  'ZodEffects',
  'ZodEffectsDef',
  'ZodEnumDef',
  'ZodFunctionDef',
  'ZodIntersectionDef',
  'ZodInvalidArgumentsIssue',
  'ZodInvalidDateIssue',
  'ZodInvalidEnumValueIssue',
  'ZodInvalidIntersectionTypesIssue',
  'ZodInvalidLiteralIssue',
  'ZodInvalidReturnTypeIssue',
  'ZodInvalidStringIssue',
  'ZodInvalidTypeIssue',
  'ZodInvalidUnionDiscriminatorIssue',
  'ZodInvalidUnionIssue',
  'ZodIssueBase',
  'ZodIssueOptionalMessage',
  'ZodLazyDef',
  'ZodLiteralDef',
  'ZodMapDef',
  'ZodNaNDef',
  'ZodNativeEnum',
  'ZodNativeEnumDef',
  'ZodNeverDef',
  'ZodNonEmptyArray',
  'ZodNotFiniteIssue',
  'ZodNotMultipleOfIssue',
  'ZodNullDef',
  'ZodNullableDef',
  'ZodNullableType',
  'ZodNumberCheck',
  'ZodNumberDef',
  'ZodObjectDef',
  'ZodOptionalDef',
  'ZodOptionalType',
  'ZodParsedType',
  'ZodPipeline',
  'ZodPipelineDef',
  'ZodPromiseDef',
  'ZodReadonlyDef',
  'ZodRecordDef',
  'ZodSetDef',
  'ZodStringCheck',
  'ZodStringDef',
  'ZodSymbolDef',
  'ZodTooBigIssue',
  'ZodTooSmallIssue',
  'ZodTransformer',
  'ZodTupleDef',
  'ZodTupleItems',
  'ZodTypeDef',
  'ZodUndefinedDef',
  'ZodUnionDef',
  'ZodUnionOptions',
  'ZodUnknownDef',
  'ZodUnrecognizedKeysIssue',
  'ZodVoidDef',
  'addIssueToContext',
  'arrayOutputType',
  'baseObjectInputType',
  'baseObjectOutputType',
  'datetimeRegex',
  'defaultErrorMap',
  'deoptional',
  'effect',
  'getParsedType',
  'isAborted',
  'isAsync',
  'isDirty',
  'isValid',
  'late',
  'makeIssue',
  'mergeTypes',
  'noUnrecognized',
  'objectInputType',
  'objectOutputType',
  'objectUtil',
  'oboolean',
  'onumber',
  'ostring',
  'pipeline',
  'quotelessJson',
  'transformer',
  'typeToFlattenedError',
  'typecast',
]);

const ZOD = 'zod';
export const RULE = 'removed-exports';

const isZod = (node: ts.Node | undefined): boolean =>
  node !== undefined && ts.isStringLiteral(node) && node.text === ZOD;

/** The sites of names zod 4's root no longer exports, one per line the code names them on. */
export function removedExportSites(text: string, file: string): SourceSite[] {
  if (!text.includes(ZOD)) return [];
  const tsx = /\.[cm]?[jt]sx$/.test(file);
  const source = ts.createSourceFile(
    tsx ? 'consumer.tsx' : 'consumer.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
    tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  /** Local binding → the zod name it stands for. */
  const names = new Map<string, string>();
  /** Bindings of the zod namespace: `z`, `zod`, `* as z`. */
  const spaces = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !isZod(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    const space = statement.importClause?.name;
    if (space) spaces.add(space.text);
    if (bindings && ts.isNamespaceImport(bindings)) spaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings))
      for (const specifier of bindings.elements) {
        const imported = (specifier.propertyName ?? specifier.name).text;
        if (imported === 'z') spaces.add(specifier.name.text);
        else if (GONE.has(imported)) names.set(specifier.name.text, imported);
      }
  }
  const sites = new Map<number, SourceSite>();
  const lines = text.split('\n');
  const add = (node: ts.Node, name: string): void => {
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
    if (!sites.has(line))
      sites.set(line, {
        line: line + 1,
        column: character + 1,
        snippet: (lines[line] ?? '').trim(),
        name,
      });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportSpecifier(node) && ts.isImportDeclaration(node.parent.parent.parent)) {
      const imported = (node.propertyName ?? node.name).text;
      if (isZod(node.parent.parent.parent.moduleSpecifier) && GONE.has(imported))
        add(node, imported);
    } else if (ts.isIdentifier(node) && names.has(node.text) && usesBinding(node)) {
      add(node, names.get(node.text) as string);
    } else if (ts.isQualifiedName(node)) {
      if (ts.isIdentifier(node.left) && spaces.has(node.left.text) && GONE.has(node.right.text))
        add(node, node.right.text);
    } else if (ts.isPropertyAccessExpression(node)) {
      if (
        ts.isIdentifier(node.expression) &&
        spaces.has(node.expression.text) &&
        GONE.has(node.name.text)
      )
        add(node, node.name.text);
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      const name = node.qualifier && ts.isIdentifier(node.qualifier) ? node.qualifier.text : '';
      if (ts.isLiteralTypeNode(argument) && isZod(argument.literal) && GONE.has(name))
        add(node, name);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...sites.values()].sort((a, b) => a.line - b.line);
}

/** An identifier that names the import, not a property, a member or the import's own specifier. */
function usesBinding(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent))
    return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isQualifiedName(parent) && parent.right === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  return !(
    (ts.isPropertySignature(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isBindingElement(parent)) &&
    parent.name === node
  );
}

/**
 * The pack's findings for one workspace: its files that mention zod, whether or not the type
 * scan visited them (`import('zod').ZodTypeAny` alone is no import). Files are
 * workspace-relative, as the usages are.
 */
export function removedExportFindings(input: {
  root: string;
  workspace: string;
  from: string;
  to: string;
  usages: readonly Usage[];
  read: (file: string) => string | undefined;
}): Finding[] {
  const dir = resolve(input.root, input.workspace);
  const direct = input.usages.map((u) => u.file);
  const findings: Finding[] = [];
  for (const file of [...new Set([...direct, ...projectFiles(dir).files])].sort()) {
    const text = input.read(join(input.workspace, file));
    if (text === undefined) continue;
    for (const site of removedExportSites(text, file))
      findings.push({
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
        reason: `${site.name} is exported from zod 3's root and, in zod 4, only from 'zod/v3'`,
        rule: RULE,
      });
  }
  return findings;
}
