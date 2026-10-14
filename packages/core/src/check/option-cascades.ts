import { ts } from 'ts-morph';
import type { DownstreamSite, Finding } from '../domain/report.js';

/** Excess property on an object literal: an option the target removed (`'x' does not exist in type`). */
const REMOVED_OPTION = new Set([2353, 2561]);
/**
 * Implicit-any errors: a parameter (7006), a destructured binding (7031) or a rest parameter
 * (7019) that took its type from the option's declared type, and has none once it is gone.
 */
const CASCADE = new Set([7006, 7031, 7019]);

const codeOf = (f: Finding): number =>
  f.usage.compileCode ?? Number(/^TS(\d+)$/.exec(f.change.path)?.[1] ?? 0);

/** The object-literal member whose name starts at the finding, or the first one on its line. */
function optionAt(source: ts.SourceFile, f: Finding): ts.ObjectLiteralElementLike | undefined {
  let exact: ts.ObjectLiteralElementLike | undefined;
  let onLine: ts.ObjectLiteralElementLike | undefined;
  const visit = (node: ts.Node): void => {
    if (exact) return;
    if (ts.isObjectLiteralElementLike(node) && node.name) {
      const at = source.getLineAndCharacterOfPosition(node.name.getStart(source));
      if (at.line + 1 === f.usage.line) {
        if (at.character + 1 === f.usage.column) exact = node;
        else onLine ??= node;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return exact ?? onLine;
}

/**
 * A pack's finding on a removed option, and the implicit-any errors inside that option's own
 * value, are one site: the callbacks lost the parameter types the option gave them, so the
 * one edit at the option (renamed, moved or removed) resolves them too. Those errors become the
 * anchor's downstream evidence rather than breaking sites of their own. Only errors whose
 * position is inside the option's value fold; anything else stands.
 */
export function foldOptionCascades(
  findings: Finding[],
  claimed: (f: Finding) => boolean,
  read: (file: string) => string | undefined,
): Finding[] {
  const anchors = findings.filter(
    (f) => claimed(f) && (REMOVED_OPTION.has(codeOf(f)) || f.change.source === 'pack'),
  );
  if (anchors.length === 0) return findings;
  const cascades = findings.filter((f) => CASCADE.has(codeOf(f)) && !claimed(f));
  if (cascades.length === 0) return findings;
  const sources = new Map<string, ts.SourceFile | undefined>();
  const parsed = (file: string): ts.SourceFile | undefined => {
    if (!sources.has(file)) {
      const text = read(file);
      sources.set(
        file,
        text === undefined
          ? undefined
          : ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file)),
      );
    }
    return sources.get(file);
  };
  const folded = new Map<Finding, Finding[]>();
  const taken = new Set<Finding>();
  for (const anchor of anchors) {
    const source = parsed(anchor.usage.file);
    if (!source) continue;
    const option = optionAt(source, anchor);
    if (!option) continue;
    const start = option.getStart(source);
    const end = option.getEnd();
    const inside = cascades.filter((c) => {
      if (taken.has(c) || c.usage.file !== anchor.usage.file) return false;
      const line = source.getLineStarts()[c.usage.line - 1];
      if (line === undefined) return false;
      const at = line + Math.max(0, c.usage.column - 1);
      return at > start && at < end;
    });
    if (inside.length === 0) continue;
    for (const c of inside) taken.add(c);
    folded.set(anchor, inside);
  }
  if (folded.size === 0) return findings;
  return findings.flatMap((f) => {
    if (taken.has(f)) return [];
    const inside = folded.get(f);
    if (!inside) return [f];
    const downstream: DownstreamSite[] = inside.map((c) => ({
      file: c.usage.file,
      line: c.usage.line,
      column: c.usage.column,
      snippet: c.usage.snippet,
      code: codeOf(c),
      message: c.usage.compileError ?? c.reason,
    }));
    return [
      {
        ...f,
        downstream: [...(f.downstream ?? []), ...downstream],
        details: [
          ...(f.details ?? []),
          `${inside.length} implicit-any error${inside.length === 1 ? '' : 's'} inside this option (line${inside.length === 1 ? '' : 's'} ${inside.map((c) => c.usage.line).join(', ')}) come from it losing its type, and go with the same edit`,
        ],
      },
    ];
  });
}

function scriptKind(file: string): ts.ScriptKind {
  if (/\.[cm]?jsx?$/.test(file)) return ts.ScriptKind.JSX;
  if (/\.tsx$/.test(file)) return ts.ScriptKind.TSX;
  return ts.ScriptKind.TS;
}
