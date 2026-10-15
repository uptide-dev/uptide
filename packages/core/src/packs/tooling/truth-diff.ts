import { ts } from 'ts-morph';

/** The source files `packs:truth` reads a diff of, tsconfig files included (the compiler's own config). */
export const SOURCE_FILE = /\.[cm]?[jt]sx?$|(?:^|\/)tsconfig[^/]*\.json$/;

/** A line of `<commit>` the upgrade changed or removed. */
export interface ChangedLine {
  file: string;
  line: number;
  text: string;
}

/** A line the upgrade added with no line of `<commit>` beside it: after old line `after`. */
export interface InsertedLine {
  file: string;
  after: number;
  text: string;
}

/**
 * Where a pure insertion inside an unchanged call or object is a site: the start line of the
 * call (`within: 'call'`), or of an object literal no call takes (`within: 'object'`).
 */
export interface InsertionAnchor {
  file: string;
  line: number;
  /** The anchor line's text in `<commit>`. */
  text: string;
  within: 'call' | 'object';
  inserted: { after: number; text: string }[];
}

/**
 * The old side of `git diff -U0 <commit> <upgrade>`, in source files: every changed or
 * removed line, and every pure insertion (a hunk with no old line). Paths are relative to
 * `directory` when given; files outside it are left out.
 */
export function diffLines(
  diff: string,
  directory?: string,
): { changed: ChangedLine[]; inserted: InsertedLine[] } {
  const changed: ChangedLine[] = [];
  const inserted: InsertedLine[] = [];
  let file = '';
  let oldLine = 0;
  let newRun = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('--- ')) continue;
    if (line.startsWith('+++ ')) {
      file = line.slice(4).replace(/^b\//, '');
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newRun = hunk[2] === '0';
      if (newRun) oldLine += 1;
      continue;
    }
    if (!SOURCE_FILE.test(file) || (directory && !file.startsWith(`${directory}/`))) continue;
    const where = directory ? file.slice(directory.length + 1) : file;
    if (line.startsWith('-'))
      changed.push({ file: where, line: oldLine++, text: line.slice(1).trim() });
    else if (line.startsWith('+') && newRun)
      inserted.push({ file: where, after: oldLine - 1, text: line.slice(1).trim() });
  }
  return { changed, inserted };
}

/** Nodes an insertion can sit in and still be part of the call or object around them. */
const TRANSPARENT = new Set([
  ts.SyntaxKind.ObjectLiteralExpression,
  ts.SyntaxKind.ArrayLiteralExpression,
  ts.SyntaxKind.PropertyAssignment,
  ts.SyntaxKind.ShorthandPropertyAssignment,
  ts.SyntaxKind.SpreadAssignment,
  ts.SyntaxKind.SpreadElement,
]);

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.json')) return ts.ScriptKind.JSON;
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

/**
 * The call or object an insertion after line `after` (1-based) of `text` adds to, with its
 * first and last line: the innermost call or `new` whose argument list holds it, through any
 * object and array literals; else the outermost object literal holding it. None when the lines
 * go between statements, into a function body, or anywhere else.
 */
export function enclosingLiteral(
  file: string,
  text: string,
  after: number,
): { line: number; endLine: number; within: 'call' | 'object' } | undefined {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const starts = source.getLineStarts();
  const at = after >= starts.length ? text.length : (starts[after] ?? text.length);
  const holds = (n: ts.Node) => n.getStart(source) < at && at < n.end;
  let node: ts.Node = source;
  for (;;) {
    const inner: ts.Node | undefined = ts.forEachChild(node, (c) => (holds(c) ? c : undefined));
    if (!inner) break;
    node = inner;
  }
  const lines = (n: ts.Node) => ({
    line: source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1,
    endLine: source.getLineAndCharacterOfPosition(n.end).line + 1,
  });
  let object: ts.Node | undefined;
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      // Between the parentheses (the arguments start after `(`, the call ends at `)`): not in
      // the callee or its type arguments.
      const open = n.arguments?.pos;
      return open !== undefined && open <= at && at < n.end
        ? { ...lines(n), within: 'call' }
        : undefined;
    }
    if (!TRANSPARENT.has(n.kind)) break;
    if (ts.isObjectLiteralExpression(n)) object = n;
  }
  return object ? { ...lines(object), within: 'object' } : undefined;
}

/**
 * Pure insertions that add to a call or object the upgrade left otherwise unchanged (an option
 * added to a constructor), anchored at the call's start line: the site `docs/packs.md` says
 * such a change has. One anchor per call, with every line inserted into it. An insertion into a
 * call the upgrade also changed is not anchored: its changed lines are the site.
 */
export function insertionAnchors(
  lines: { changed: ChangedLine[]; inserted: InsertedLine[] },
  read: (file: string) => string | undefined,
): InsertionAnchor[] {
  const anchors = new Map<string, InsertionAnchor>();
  const texts = new Map<string, string | undefined>();
  for (const insertion of lines.inserted) {
    if (!texts.has(insertion.file)) texts.set(insertion.file, read(insertion.file));
    const text = texts.get(insertion.file);
    if (text === undefined) continue;
    const literal = enclosingLiteral(insertion.file, text, insertion.after);
    if (!literal) continue;
    const touched = lines.changed.some(
      (c) => c.file === insertion.file && c.line >= literal.line && c.line <= literal.endLine,
    );
    if (touched) continue;
    const key = `${insertion.file}:${literal.line}`;
    const anchor = anchors.get(key) ?? {
      file: insertion.file,
      line: literal.line,
      text: (text.split('\n')[literal.line - 1] ?? '').trim(),
      within: literal.within,
      inserted: [],
    };
    anchor.inserted.push({ after: insertion.after, text: insertion.text });
    anchors.set(key, anchor);
  }
  return [...anchors.values()];
}
