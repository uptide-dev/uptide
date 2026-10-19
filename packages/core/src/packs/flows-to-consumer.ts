import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ts } from 'ts-morph';
import { projectFiles } from '../check/importers.js';
import { satisfies } from '../fetch/range.js';
import { installedManifest } from '../list/evidence.js';
import type { RecordTrigger } from './records.js';

/** One site of a `flows-to-consumer` trigger, workspace-relative. */
export interface ConsumerSite {
  file: string;
  line: number;
  snippet: string;
}

/**
 * The calls of a consumer package's API in one workspace that receive a value the trigger names,
 * resolved with the type checker: the receiver's type is declared in the consumer, and the value's
 * type is what the predicate asks for. An `any`, a spread, a value the checker cannot see is no site.
 */
export function flowsToConsumer(
  trigger: RecordTrigger,
  input: { root: string; workspace: string; phase: 'before' | 'after' },
): ConsumerSite[] {
  if (trigger.kind !== 'flows-to-consumer') return [];
  const version = installedManifest(input.root, input.workspace, trigger.consumer.package)?.version;
  if (!version || !satisfies(version, trigger.consumer.range)) return [];
  const dir = resolve(input.root, input.workspace);
  const { files, options } = projectFiles(dir);
  const methods = [...new Set(trigger.calls.map((c) => c.method))];
  const texts = new Map<string, string>();
  for (const file of files) {
    const text = read(join(dir, file));
    if (methods.some((m) => text.includes(m))) texts.set(file, text);
  }
  if (!texts.size) return [];
  // ponytail: schemas from 'zod/v3' keep zod 3 after the upgrade, and on 3.x the checker cannot
  // tell them from 'zod'. A workspace importing it gets no site rather than a guessed one.
  if (
    input.phase === 'before' &&
    files.some((f) => /from\s+['"]zod\/v3['"]/.test(read(join(dir, f))))
  )
    return [];
  const program = ts.createProgram({
    rootNames: [...texts.keys()].map((f) => join(dir, f)),
    options: { ...options, noEmit: true, skipLibCheck: true },
  });
  const checker = program.getTypeChecker();
  const open = (node: ts.Node) => valueOpen(checker, checker.getTypeAtLocation(node), input.phase);
  const sites = new Map<string, ConsumerSite>();
  for (const [file, text] of texts) {
    const source = program.getSourceFile(join(dir, file));
    if (!source) continue;
    const lines = text.split('\n');
    const add = (node: ts.Node) => {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
      sites.set(`${file}:${line}`, { file, line: line + 1, snippet: (lines[line] ?? '').trim() });
    };
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const receiver = checker.getTypeAtLocation(node.expression.expression);
        for (const spec of trigger.calls) {
          if (spec.method !== method || !declaredIn(receiver, spec.type, trigger.consumer.package))
            continue;
          const args =
            spec.argument === undefined
              ? node.arguments.slice(1)
              : node.arguments.slice(spec.argument, spec.argument + 1);
          for (const arg of args) {
            if (spec.property === undefined) {
              if (open(arg)) add(arg);
              continue;
            }
            if (!ts.isObjectLiteralExpression(arg)) continue;
            const property = arg.properties.find(
              (p) =>
                (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
                ts.isIdentifier(p.name) &&
                p.name.text === spec.property,
            );
            if (!property) continue;
            const value = ts.isPropertyAssignment(property)
              ? property.initializer
              : ts.isShorthandPropertyAssignment(property)
                ? property.name
                : undefined;
            if (value && open(value)) add(property);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...sites.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

function read(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** The receiver's type is `name`, declared inside the consumer package. */
function declaredIn(type: ts.Type, name: string, pkg: string): boolean {
  const symbol = type.getSymbol() ?? type.aliasSymbol;
  return (
    symbol?.getName() === name &&
    (symbol.getDeclarations() ?? []).some((d) =>
      d.getSourceFile().fileName.includes(`/node_modules/${pkg}/`),
    )
  );
}

/** A zod schema's major from its members: zod 4's classic schemas carry `_zod`, zod 3's only `_def`. */
function zodMajor(type: ts.Type): 3 | 4 | undefined {
  if (type.getProperty('_zod')) return 4;
  if (type.getProperty('_def')) return 3;
  return undefined;
}

/**
 * `zod-object-strip`: a zod object whose unknown keys are stripped, the default, or a raw shape
 * (the MCP SDK wraps one in `z.object`). Before the upgrade it must be zod 3, whose converter
 * advertised `additionalProperties: false` for it; after, zod 4, whose `input` mode does not.
 * Strict, passthrough and catchall objects advertise the same on both, so they are no site.
 */
function valueOpen(checker: ts.TypeChecker, type: ts.Type, phase: 'before' | 'after'): boolean {
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false;
  const major = phase === 'before' ? 3 : 4;
  const schema = zodMajor(type);
  if (schema !== undefined) {
    if (schema !== major || type.getSymbol()?.getName() !== 'ZodObject') return false;
    if (!((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference)) return false;
    const [, keys, catchall] = checker.getTypeArguments(type as ts.TypeReference);
    if (major === 4) return keys?.aliasSymbol?.getName() === '$strip';
    return (
      !!keys?.isStringLiteral() &&
      keys.value === 'strip' &&
      catchall?.getSymbol()?.getName() === 'ZodType'
    );
  }
  const properties = type.getProperties();
  if (!properties.length || type.getCallSignatures().length) return false;
  return properties.every((p) => {
    const declaration = p.valueDeclaration ?? p.getDeclarations()?.[0];
    return (
      declaration !== undefined &&
      zodMajor(checker.getTypeOfSymbolAtLocation(p, declaration)) === major
    );
  });
}
