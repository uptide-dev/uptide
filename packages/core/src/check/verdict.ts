import type { PackageReport } from '../domain/report.js';
import { NO_PACK, noPackVerdict } from './tier.js';

/** The verdict of one analyzed package, and what verified it. */
export interface Verdict {
  /** Breaking sites: what the summary row counts. */
  breaking: number;
  /** Set when the repository was compiled against the target. */
  compiledAgainst?: string;
  /** New type errors at the target, when compiled. */
  newErrors?: number;
  /** Why the types were not verified, when they were not. */
  notVerified?: string;
  /** Set when some, not all, of the files were compiled: the coverage line. */
  partlyVerified?: string;
  /**
   * `0 breaking · compiled against 4.6.5: 0 new type errors`, as terminal and HTML print it.
   * Without a pack and nothing confirmed breaking, `not analyzed: no pack yet` instead of `0 breaking`.
   */
  summary: string;
}

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

/**
 * `compiled 12 of 40 files in 2 workspaces with the repo's TypeScript 5.4.2; skipped: not in
 * the workspace tsconfig (28)`: how much of the code that uses the package the compiler
 * judged, and which compiler, printed under every check.
 */
export function coverageLine(c: NonNullable<PackageReport['compile']>['coverage']): string {
  if (!c) return '';
  const skipped = c.skipped.map((r) => `${r.reason} (${r.count})`).join(', ');
  const compilers = compilersPhrase(c.compilers ?? []);
  const notCompiled = (c.notCompiled ?? []).map((n) => `; not compiled: ${n.path} (${n.reason})`);
  return `compiled ${c.compiled} of ${count(c.total, 'file')} in ${count(c.workspaces, 'workspace')}${compilers ? ` with ${compilers}` : ''}${skipped ? `; skipped: ${skipped}` : ''}${notCompiled.join('')}${c.noTsconfig ? '; no tsconfig found, using importer-based compile scope' : ''}`;
}

/**
 * `the repo's TypeScript 4.9.5`; a monorepo whose workspaces install different versions
 * names each (`the repo's TypeScript 4.9.5 and 5.4.2`), and one that installs none in some
 * workspace says which were judged by the bundled compiler instead.
 */
function compilersPhrase(compilers: { version: string; own: boolean }[]): string {
  const versions = (own: boolean) =>
    [...new Set(compilers.filter((c) => c.own === own).map((c) => c.version))].sort().join(' and ');
  return [
    ...(versions(true) ? [`the repo's TypeScript ${versions(true)}`] : []),
    ...(versions(false) ? [`the bundled TypeScript ${versions(false)}`] : []),
  ].join(' and ');
}

/**
 * Always says the breaking count and what verified it, zero included: an empty result is
 * only worth as much as the check behind it. `notCompiled` is why the compiler did not run,
 * when it did not (and the package's compile summary does not say).
 */
export function verdictOf(p: PackageReport, notCompiled?: string): Verdict {
  const breaking = p.findings.filter((f) => f.severity === 'breaking').length;
  const head = noPackVerdict(p) ? NO_PACK : `${breaking} breaking`;
  const coverage = p.compile?.coverage;
  if (p.compile !== undefined && p.compile.skipped === undefined) {
    // Reports stored before the count was kept say what was compiled, without a number.
    const newErrors = p.compile.newErrors;
    // Some of the files that use the package were not compiled: the verdict says so, instead
    // of a clean result that only covers part of the code.
    if (coverage && coverage.compiled < coverage.total) {
      const partly = coverageLine(coverage);
      return {
        breaking,
        compiledAgainst: p.target,
        ...(newErrors !== undefined ? { newErrors } : {}),
        partlyVerified: partly,
        summary: `${head} · types partly verified: ${partly}`,
      };
    }
    return {
      breaking,
      compiledAgainst: p.target,
      ...(newErrors !== undefined ? { newErrors } : {}),
      summary: `${head} · compiled against ${p.target}${newErrors !== undefined ? `: ${count(newErrors, 'new type error')}` : ''}`,
    };
  }
  const reason = p.compile?.skipped ?? notCompiled ?? 'the compiler did not run';
  return {
    breaking,
    notVerified: reason,
    summary: `${head} · types not verified: ${reason}`,
  };
}
