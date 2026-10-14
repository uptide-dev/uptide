import type { Finding } from '../domain/report.js';
import type { FixSite } from './types.js';

/** A pack finding owns the rule name; retain the compiler diagnostic at the same call. */
export function pairedFindings<T>(
  items: T[],
  finding: (item: T) => Finding,
  merge: (pack: T, compiler: T) => T,
): T[] {
  const pairs = new Map<T, T>();
  for (const item of items) {
    const f = finding(item);
    if (f.change.source === 'pack') continue;
    const candidates = items.filter((other) => {
      const p = finding(other);
      return (
        p.change.source === 'pack' &&
        p.rule &&
        p.usage.file === f.usage.file &&
        p.usage.line === f.usage.line &&
        (p.change.path === f.change.path ||
          p.rule === f.rule ||
          p.usage.symbolPath === f.usage.symbolPath)
      );
    });
    if (candidates.length === 1) pairs.set(item, candidates[0] as T);
  }
  const merged = new Map<T, T>();
  for (const [compiler, pack] of pairs) merged.set(pack, merge(merged.get(pack) ?? pack, compiler));
  return items.filter((item) => !pairs.has(item)).map((item) => merged.get(item) ?? item);
}
export function mergeFinding(pack: Finding, compiler: Finding): Finding {
  return {
    ...pack,
    usage: {
      ...compiler.usage,
      ...pack.usage,
      ...(compiler.usage.compileError
        ? { compileError: compiler.usage.compileError, compileCode: compiler.usage.compileCode }
        : {}),
    },
  };
}
/** Also normalizes stored reports, without mutating their original evidence. */
export function uniqueSites(sites: FixSite[]): FixSite[] {
  return pairedFindings(
    sites,
    (s) => s.finding,
    (pack, compiler) => ({
      ...compiler,
      ...pack,
      finding: mergeFinding(pack.finding, compiler.finding),
      rule: pack.finding.rule,
      diff: pack.diff ?? compiler.diff,
      attempts: pack.attempts ?? compiler.attempts,
      editedFiles: [...new Set([...(pack.editedFiles ?? []), ...(compiler.editedFiles ?? [])])],
    }),
  );
}
