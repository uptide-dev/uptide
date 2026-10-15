import { relative } from 'node:path';
import type { ts } from 'ts-morph';
import type { DiagnosticCause } from '../../domain/usage.js';
import { onReset } from '../../shared-state.js';

/** Whether a declaration sits inside `declare global` or `declare module "x"`. */
export function isAugmentation(tsc: typeof ts, decl: ts.Node): boolean {
  for (let n: ts.Node | undefined = decl.parent; n && !tsc.isSourceFile(n); n = n.parent)
    if (
      tsc.isModuleDeclaration(n) &&
      (n.flags & tsc.NodeFlags.GlobalAugmentation || tsc.isStringLiteral(n.name))
    )
      return true;
  return false;
}

/** Last node_modules segment also handles pnpm and bun's nested package stores. */
export function packageOf(fileName: string): string {
  const names = [...fileName.matchAll(/\/node_modules\/((?:@[^/]+\/)?[^/]+)(?=\/)/g)];
  return names.at(-1)?.[1] ?? (fileName.split('/').at(-2) ?? fileName).replace(/-v\d+$/, '');
}

let registrations = new WeakMap<ts.Program, Map<string, ts.ImportDeclaration | undefined>>();
onReset(() => {
  registrations = new WeakMap();
});

/**
 * A dependency can supply the augmentation rather than the repository declaring it.
 * jest-dom's setup import is the edit; thousands of expect(...).toBeInTheDocument()
 * calls are evidence. Prove that the baseline receiver inherits an augmentation from
 * that unchanged dependency before anchoring a missing member at its side-effect import.
 */
export function augmentationImportCause(
  programs: { ts: typeof ts; base: ts.Program; overlay: ts.Program },
  before: ts.Node,
  member: ts.Declaration,
  repoDir: string,
  rootDir: string,
): DiagnosticCause | undefined {
  const tsc = programs.ts;
  if (!tsc.isPropertyAccessExpression(before.parent) || before.parent.name !== before)
    return undefined;
  const provider = member.getSourceFile();
  if (programs.overlay.getSourceFile(provider.fileName)?.text !== provider.text) return undefined;
  const pkg = packageOf(provider.fileName);
  const checker = programs.base.getTypeChecker();
  const visited = new Set<ts.Type>();
  const augmented = (type: ts.Type): boolean => {
    if (visited.has(type)) return false;
    visited.add(type);
    if (
      type.symbol?.declarations?.some(
        (d) => packageOf(d.getSourceFile().fileName) === pkg && isAugmentation(tsc, d),
      )
    )
      return true;
    if (type.isUnionOrIntersection()) return type.types.some(augmented);
    if (!(type.flags & tsc.TypeFlags.Object)) return false;
    const target = (type as ts.TypeReference).target ?? type;
    if (!((target as ts.ObjectType).objectFlags & tsc.ObjectFlags.ClassOrInterface)) return false;
    return checker.getBaseTypes(target as ts.InterfaceType).some(augmented);
  };
  if (!augmented(checker.getTypeAtLocation(before.parent.expression))) return undefined;

  let imports = registrations.get(programs.base);
  if (!imports) {
    imports = new Map();
    registrations.set(programs.base, imports);
  }
  const key = `${rootDir}|${pkg}`;
  if (!imports.has(key)) {
    const candidates = programs.base
      .getSourceFiles()
      .filter((f) => f.fileName.startsWith(`${rootDir}/`) && !f.fileName.includes('/node_modules/'))
      .flatMap((f) =>
        f.statements.filter(
          (s): s is ts.ImportDeclaration =>
            tsc.isImportDeclaration(s) &&
            !s.importClause &&
            tsc.isStringLiteral(s.moduleSpecifier) &&
            (s.moduleSpecifier.text === pkg || s.moduleSpecifier.text.startsWith(`${pkg}/`)) &&
            packageOf(
              tsc.resolveModuleName(
                s.moduleSpecifier.text,
                f.fileName,
                programs.base.getCompilerOptions(),
                tsc.sys,
              ).resolvedModule?.resolvedFileName ?? '',
            ) === pkg,
        ),
      )
      .sort(
        (a, b) =>
          a.getSourceFile().fileName.localeCompare(b.getSourceFile().fileName) || a.pos - b.pos,
      );
    imports.set(key, candidates[0]);
  }
  const declaration = imports.get(key);
  if (!declaration) return undefined;
  const source = declaration.getSourceFile();
  return {
    name: pkg,
    file: relative(repoDir, source.fileName).split('\\').join('/'),
    line: source.getLineAndCharacterOfPosition(declaration.getStart()).line + 1,
    reason: `which imports ${pkg}'s type augmentation, inherited by the installed type but no longer read by the target; update the registration here`,
    anchorOnly: true,
  };
}
