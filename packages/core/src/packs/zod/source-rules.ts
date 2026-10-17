import { ts } from 'ts-morph';
import type { SourceSite } from '../contract.js';
import { removedExportSites, type SiteRule } from './removed-exports.js';

/**
 * Zod 3 code that zod 4 still compiles but marks `@deprecated`, or that it stopped honouring
 * without a type the checker can follow: `.refine(fn, { message })`, the type names zod 4's root
 * keeps as aliases and `errorMap`. Read from the syntax of a file
 * that mentions zod.
 */
const DEPRECATED = new Set([
  'ZodTypeAny',
  'ZodSchema',
  'ZodIssue',
  'ZodIssueCode',
  'ZodErrorMap',
  'ZodFlattenedError',
  'ZodFormattedError',
  'ZodFirstPartySchemaTypes',
]);

function parse(text: string, file: string): ts.SourceFile | undefined {
  if (!text.includes('zod')) return undefined;
  const tsx = /\.[cm]?[jt]sx$/.test(file);
  return ts.createSourceFile(
    tsx ? 'consumer.tsx' : 'consumer.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
    tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function collect(
  text: string,
  file: string,
  pick: (node: ts.Node) => { at: ts.Node; name: string } | undefined,
): SourceSite[] {
  const source = parse(text, file);
  if (!source) return [];
  const lines = text.split('\n');
  const sites = new Map<number, SourceSite>();
  const visit = (node: ts.Node): void => {
    const hit = pick(node);
    if (hit) {
      const { line, character } = source.getLineAndCharacterOfPosition(hit.at.getStart(source));
      if (!sites.has(line))
        sites.set(line, {
          line: line + 1,
          column: character + 1,
          snippet: (lines[line] ?? '').trim(),
          name: hit.name,
        });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...sites.values()].sort((a, b) => a.line - b.line);
}

const keyName = (name: ts.PropertyName): string | undefined =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;

/** `.refine(check, { message })`: the second argument's `message`, one site per property. */
export function refineMessageSites(text: string, file: string): SourceSite[] {
  return collect(text, file, (node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      node.expression.name.text !== 'refine'
    )
      return;
    const params = node.arguments[1];
    if (!params || !ts.isObjectLiteralExpression(params)) return;
    const message = params.properties.find(
      (p) => p.name !== undefined && keyName(p.name) === 'message',
    );
    return message && { at: message, name: 'refine#message' };
  });
}

export const refineMessageRule: SiteRule = {
  rule: 'refine-message',
  severity: 'deprecated',
  sites: refineMessageSites,
  reason: () => 'refine(check, { message }): message is deprecated in zod 4, use error',
};

/** The deprecated type names of zod 4's root, imported from it or reached as `z.Name`. */
export const deprecatedNameSites = (text: string, file: string): SourceSite[] =>
  removedExportSites(text, file, DEPRECATED);

export const deprecatedNameRule: SiteRule = {
  rule: 'deprecated-names',
  severity: 'deprecated',
  sites: deprecatedNameSites,
  reason: (name) => `${name} is deprecated in zod 4`,
};

/** `errorMap` in the options of a call, and `ctx.defaultError` read inside one. */
export function errorMapSites(text: string, file: string): SourceSite[] {
  return collect(text, file, (node) => {
    if (
      ts.isPropertyAssignment(node) ||
      ts.isShorthandPropertyAssignment(node) ||
      ts.isMethodDeclaration(node)
    ) {
      const name = node.name && keyName(node.name);
      const object = node.parent;
      if (
        name === 'errorMap' &&
        ts.isObjectLiteralExpression(object) &&
        ts.isCallExpression(object.parent)
      )
        return { at: node, name: 'errorMap' };
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'defaultError')
      return { at: node.name, name: 'defaultError' };
    return undefined;
  });
}

export const errorMapRule: SiteRule = {
  rule: 'error-map',
  // Deprecated, and a compile error where the call's types reject it (TS2353, TS2769): the type
  // diff reports the compile error at the line TypeScript names, which this cannot always match.
  severity: 'deprecated',
  sites: errorMapSites,
  reason: (name) =>
    name === 'defaultError'
      ? 'zod 4 error functions receive the issue only: ctx.defaultError no longer exists'
      : 'errorMap is deprecated in zod 4: use error',
};

export const siteRules = [refineMessageRule, deprecatedNameRule, errorMapRule];
