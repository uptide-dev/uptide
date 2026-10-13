import { type Node, Project, type SourceFile, SyntaxKind } from 'ts-morph';
import { onReset } from '../../shared-state.js';
import type { TransformResult } from '../types.js';

/**
 * JSX attribute edits at one reported site. The site is either the attribute the compiler
 * rejected or the start of the element `check` reports from the type diff; both lead to the
 * element's own attributes, never to a nested element's.
 */
const parsed = new Map<string, SourceFile>();
onReset(() => parsed.clear());
function parse(text: string): SourceFile {
  let source = parsed.get(text);
  if (!source) {
    source = new Project({ useInMemoryFileSystem: true }).createSourceFile('consumer.tsx', text);
    if (parsed.size >= 16) parsed.delete(parsed.keys().next().value as string);
    parsed.set(text, source);
  }
  return source;
}

type Element = Node & {
  getTagNameNode(): Node;
  getAttributes(): Node[];
};

function elementAt(source: SourceFile, line: number, column: number): Element | undefined {
  const lines = source.getFullText().split('\n');
  if (lines[line - 1] === undefined) return undefined;
  const pos = source.compilerNode.getPositionOfLineAndCharacter(line - 1, column - 1);
  let node: Node | undefined = source.getDescendantAtPos(pos);
  while (
    node &&
    !node.isKind(SyntaxKind.JsxSelfClosingElement) &&
    !node.isKind(SyntaxKind.JsxOpeningElement)
  )
    node = node.getParent();
  return node as Element | undefined;
}

/** `Area` for `<Area>` and `<Recharts.Area>`. */
function tagOf(element: Element): string {
  return element.getTagNameNode().getText().split('.').pop() ?? '';
}

function attributesNamed(element: Element, names: readonly string[]): Node[] {
  return element
    .getAttributes()
    .filter((a) => a.isKind(SyntaxKind.JsxAttribute) && names.includes(a.getNameNode().getText()));
}

/** The attribute and the whitespace in front of it, so the tag keeps its own layout. */
function withLeadingSpace(text: string, node: Node): { start: number; end: number } {
  let start = node.getStart();
  while (start > 0 && /\s/.test(text[start - 1] as string)) start--;
  return { start, end: node.getEnd() };
}

/**
 * Removes, from the element at the site, the attributes that component no longer accepts
 * (`byTag`: component name to attribute names). Declines when the element is not one of
 * them (an aliased import, a wrapper), so a prop of the same name on another component is
 * never touched.
 */
export function removeAttributes(
  text: string,
  site: { line: number; column: number },
  byTag: Readonly<Record<string, readonly string[]>>,
): TransformResult {
  const element = elementAt(parse(text), site.line, site.column);
  if (!element) return { text, applied: false, reason: 'the reported site is not a JSX element' };
  const tag = tagOf(element);
  const names = byTag[tag];
  if (!names)
    return { text, applied: false, reason: `\`${tag}\` is not ${Object.keys(byTag).join(', ')}` };
  const found = attributesNamed(element, names);
  if (found.length === 0)
    return { text, applied: false, reason: `no ${names.join(' or ')} attribute at the site` };
  let out = text;
  for (const attribute of [...found].reverse()) {
    const { start, end } = withLeadingSpace(text, attribute);
    out = `${out.slice(0, start)}${out.slice(end)}`;
  }
  return { text: out, applied: true, reason: `\`${names.join('`, `')}\` removed from \`${tag}\`` };
}

/**
 * `alwaysShow` and `alwaysShow={true}` on a reference element become
 * `ifOverflow="extendDomain"`, the replacement the 2.x declarations name. `alwaysShow={false}`
 * is removed (it is the default). Anything computed, and an element that already sets
 * `ifOverflow`, is declined: which of the two wins is a decision.
 */
export function alwaysShowToIfOverflow(
  text: string,
  site: { line: number; column: number },
): TransformResult {
  const tags = ['ReferenceLine', 'ReferenceDot', 'ReferenceArea'];
  const element = elementAt(parse(text), site.line, site.column);
  if (!element) return { text, applied: false, reason: 'the reported site is not a JSX element' };
  if (!tags.includes(tagOf(element)))
    return { text, applied: false, reason: `\`${tagOf(element)}\` is not a reference element` };
  const [attribute] = attributesNamed(element, ['alwaysShow']);
  if (!attribute?.isKind(SyntaxKind.JsxAttribute))
    return { text, applied: false, reason: 'no alwaysShow attribute at the site' };
  if (attributesNamed(element, ['ifOverflow']).length > 0)
    return { text, applied: false, reason: 'the element already sets ifOverflow' };
  const initializer = attribute.getInitializer();
  const value = initializer?.getText().replace(/\s+/g, '');
  if (initializer && value !== '{true}' && value !== '{false}')
    return { text, applied: false, reason: 'alwaysShow is computed' };
  if (value === '{false}') {
    const { start, end } = withLeadingSpace(text, attribute);
    return {
      text: `${text.slice(0, start)}${text.slice(end)}`,
      applied: true,
      reason: '`alwaysShow={false}` was the default',
    };
  }
  return {
    text: `${text.slice(0, attribute.getStart())}ifOverflow="extendDomain"${text.slice(attribute.getEnd())}`,
    applied: true,
    reason: '`alwaysShow` is `ifOverflow="extendDomain"`',
  };
}
