import { Node, Project, SyntaxKind } from 'ts-morph';
import type { Finding } from '../../domain/report.js';
import type { SourceSite } from '../contract.js';
import type { TransformResult } from '../types.js';

const stable: Record<string, string> = {
  unstable_cacheLife: 'cacheLife',
  unstable_cacheTag: 'cacheTag',
};

function parse(text: string) {
  return new Project({ useInMemoryFileSystem: true }).createSourceFile('consumer.tsx', text);
}

/** Narrow port of @next/codemod@16.4.0 remove-unstable-prefix's named-import branch.
 * Preserve local bindings; unaliased imports need a scope-aware reference rewrite and
 * remain assisted. Never rename arbitrary identifiers, comments, exports or strings.
 */
function cacheImports(text: string) {
  return parse(text)
    .getImportDeclarations()
    .filter((declaration) => declaration.getModuleSpecifierValue() === 'next/cache')
    .flatMap((declaration) => declaration.getNamedImports())
    .filter((specifier) => stable[specifier.getName()] !== undefined);
}

export function stableCacheSites(text: string): SourceSite[] {
  return cacheImports(text).map((specifier) => {
    const name = specifier.getNameNode();
    const { line, column } = name.getSourceFile().getLineAndColumnAtPos(name.getStart());
    return {
      line,
      column,
      snippet: text.split('\n')[line - 1]?.trim() ?? '',
      name: name.getText(),
    };
  });
}

export function stabilizeCacheImport(text: string, finding: Finding): TransformResult {
  for (const specifier of cacheImports(text)) {
    const name = specifier.getNameNode();
    const at = name.getSourceFile().getLineAndColumnAtPos(name.getStart());
    if (at.line !== finding.usage.line || at.column !== finding.usage.column) continue;
    if (!specifier.getAliasNode()) break;
    const replacement = stable[specifier.getName()];
    return {
      text: text.slice(0, name.getStart()) + replacement + text.slice(name.getEnd()),
      applied: true,
      reason: 'use the stable next/cache export while preserving the local binding',
    };
  }
  return {
    text,
    applied: false,
    reason: 'only an aliased named next/cache import is mechanically safe here',
  };
}

/** Match the imported binding, including aliases, but never shadowed/local functions. */
export function revalidateTagSites(text: string): SourceSite[] {
  const source = parse(text);
  const bindings = source
    .getImportDeclarations()
    .filter((declaration) => declaration.getModuleSpecifierValue() === 'next/cache')
    .flatMap((declaration) => declaration.getNamedImports())
    .filter((specifier) => specifier.getName() === 'revalidateTag')
    .map((specifier) => (specifier.getAliasNode() ?? specifier.getNameNode()).getSymbol());
  return source.getDescendantsOfKind(SyntaxKind.CallExpression).flatMap((call) => {
    const callee = call.getExpression();
    if (
      !Node.isIdentifier(callee) ||
      call.getArguments().length !== 1 ||
      !callee.getSymbol() ||
      !bindings.includes(callee.getSymbol())
    )
      return [];
    const { line, column } = source.getLineAndColumnAtPos(callee.getStart());
    return [
      { line, column, snippet: text.split('\n')[line - 1]?.trim() ?? '', name: 'revalidateTag' },
    ];
  });
}
