import { posix } from 'node:path';
import type { DownstreamSite, Finding, PackageReport, SharedRoot } from '../domain/report.js';
import type { SitePosition } from '../domain/usage.js';
import { describeCluster } from './unattributed.js';
import { parseVersion } from './version.js';

const rootKey = (r: SharedRoot): string => `${r.file}:${r.line}:${r.name}`;

/**
 * A compile error the compiler traces to another new error's expression (`origin`, set by
 * `flowOrigin`, UPT-99) is a consequence of that site: it folds into the breaking finding
 * there as one of its `downstream` errors and is no longer a site. The root is the innermost
 * breaking finding (not a cause cluster) whose span holds the origin. A consequence of a
 * consequence goes to the first one's root. With no breaking finding at the origin, or a
 * trace that loops, the error stays as it was. `prefix` makes workspace-relative files
 * repository-relative, as `downstream` is.
 */
export function foldConsequences(findings: Finding[], prefix = ''): Finding[] {
  if (!findings.some((f) => f.origin)) return findings;
  const before = (aLine: number, aCol: number, bLine: number, bCol: number): boolean =>
    aLine < bLine || (aLine === bLine && aCol <= bCol);
  const holds = (f: Finding, at: SitePosition): boolean =>
    f.usage.file === at.file &&
    before(f.usage.line, f.usage.column, at.line, at.column) &&
    before(at.line, at.column, f.usage.endLine, f.usage.endColumn);
  const span = (f: Finding): number =>
    (f.usage.endLine - f.usage.line) * 1e6 + f.usage.endColumn - f.usage.column;
  const rootAt = (at: SitePosition): Finding | undefined =>
    findings
      .filter((r) => r.severity === 'breaking' && r.change.kind !== 'cause' && holds(r, at))
      .sort((a, b) => span(a) - span(b))[0];
  const rootOf = (f: Finding): Finding | undefined => {
    const seen = new Set([f]);
    let current = f;
    while (current.origin) {
      const next = rootAt(current.origin);
      if (!next) break;
      if (seen.has(next)) return undefined;
      seen.add(next);
      current = next;
    }
    return current === f ? undefined : current;
  };
  const into = new Map<Finding, Finding[]>();
  for (const f of findings) {
    const root = f.origin && rootOf(f);
    if (root) into.set(root, [...(into.get(root) ?? []), f]);
  }
  const folded = new Set([...into.values()].flat());
  return findings.flatMap((f) => {
    if (folded.has(f)) return [];
    const { origin: _, ...rest } = f;
    const under = into.get(f);
    if (!under) return [rest];
    const downstream: DownstreamSite[] = under.map((c) => ({
      file: posix.normalize(`${prefix}${c.usage.file}`),
      line: c.usage.line,
      column: c.usage.column,
      snippet: c.usage.snippet,
      code: c.usage.compileCode ?? Number(/^TS(\d+)$/.exec(c.change.path)?.[1] ?? 0),
      message: (c.usage.compileError ?? c.reason).split('\n')[0] ?? c.reason,
    }));
    const n = downstream.length;
    return [
      {
        ...rest,
        downstream: [...(f.downstream ?? []), ...downstream].sort(
          (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
        ),
        details: [
          ...(f.details ?? []),
          `+${n} downstream error${n === 1 ? '' : 's'}: the compiler traces ${n === 1 ? 'its value' : 'their values'} to this site, and the edit here resolves ${n === 1 ? 'it' : 'them'}`,
        ],
      },
    ];
  });
}

/** `3 call sites in 2 workspaces`: the line under a shared root's reason. */
export function callSitesLine(sites: readonly DownstreamSite[]): string {
  const workspaces = new Set(sites.map((s) => s.workspace).filter((w) => w !== undefined));
  const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;
  return `${count(sites.length, 'call site')}${workspaces.size > 1 ? ` in ${count(workspaces.size, 'workspace')}` : ''}`;
}

/**
 * Sites in different workspaces that trace to one repository declaration are one finding,
 * anchored at the declaration with the sites as evidence. Within a workspace the compile
 * signal already folds two or more such sites (adapters/typescript/compile.ts); a site alone
 * in its workspace keeps its `root`, and here, after the merge, roots are compared across
 * workspaces: two or more sites at one root, or one site plus the anchor another workspace
 * already produced, become (or join) the anchored finding. tldraw's `useTransform(ref)`,
 * called from three workspaces, is fixed once, in the hook's parameter.
 */
export function foldSharedRoots(
  findings: Finding[],
  workspaceOf: (f: Finding) => string | undefined,
): Finding[] {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    if (!f.root) continue;
    const list = groups.get(rootKey(f.root)) ?? [];
    list.push(f);
    groups.set(rootKey(f.root), list);
  }
  const folded = new Map<Finding, Finding | undefined>();
  for (const group of groups.values()) {
    const anchors = group.filter((f) => f.anchorOnly && f.change.kind === 'cause');
    const sites = group.filter((f) => !anchors.includes(f));
    // One site, no anchor anywhere: nothing shared, the site stands on its own.
    if (sites.length === 0 || anchors.length + sites.length < 2) continue;
    const root = (group[0] as Finding).root as SharedRoot;
    const evidence: DownstreamSite[] = [
      ...anchors.flatMap((a) => a.downstream ?? []),
      ...sites.map((f) => ({
        file: f.usage.file,
        line: f.usage.line,
        column: f.usage.column,
        snippet: f.usage.snippet,
        code: f.usage.compileCode ?? Number(/^TS(\d+)$/.exec(f.change.path)?.[1] ?? 0),
        message: f.usage.compileError ?? f.reason,
        ...(workspaceOf(f) !== undefined ? { workspace: workspaceOf(f) } : {}),
      })),
    ].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    const first = (anchors[0] ?? sites[0]) as Finding;
    // The pack rule the sites were filed under, when they agree on one.
    const rules = [...new Set(group.map((f) => f.rule).filter((r) => r !== undefined))];
    const anchor: Finding = {
      ...first,
      change: {
        ...first.change,
        path: `cause:${root.name}`,
        kind: 'cause',
        severity: 'breaking',
        evidence: 'checker',
        notes: describeCluster(evidence.length, { ...root, anchorOnly: true }),
      },
      usage: {
        file: root.file,
        line: root.line,
        column: 1,
        endLine: root.line,
        endColumn: 1,
        symbolPath: `cause:${root.name}`,
        access: 'read',
        snippet: '',
        via: 'inferred',
      },
      downstream: evidence,
      anchorOnly: true,
      root,
      severity: 'breaking',
      confidence: 1,
      fixability: 'assisted',
      reason: root.reason,
      details: [
        callSitesLine(evidence),
        ...(first.details ?? []).filter((d) => !/^\d+ call sites?/.test(d)),
      ],
      evidence: 'compiler',
      ...(rules.length === 1 ? { rule: rules[0] } : {}),
    };
    folded.set(first, anchor);
    for (const f of group) if (f !== first) folded.set(f, undefined);
  }
  if (folded.size === 0) return findings;
  return findings.flatMap((f) =>
    folded.has(f) ? (folded.get(f) ? [folded.get(f) as Finding] : []) : [f],
  );
}

/** Known package-level cause, gated on compiler evidence. Other diagnostics remain separate. */
export function groupRootCauses(report: PackageReport): void {
  if (report.name !== 'typescript' || parseVersion(report.target)?.major !== 7) return;
  const codeOf = (f: Finding): number =>
    f.usage.compileCode ?? Number(/^TS(\d+)$/.exec(f.change.path)?.[1] ?? 0);
  const missing = report.findings.filter(
    (f) =>
      f.severity === 'breaking' &&
      f.evidence === 'compiler' &&
      [2305, 2339, 2551, 2614, 2694, 2724].includes(codeOf(f)),
  );
  if (missing.length < 2) return;
  const first = missing[0] as Finding;
  const title = 'TypeScript 7 has no JavaScript compiler API in its main entry';
  const cause: Finding = {
    ...first,
    rule: 'typescript-no-js-api',
    change: { ...first.change, kind: 'cause', path: 'cause:typescript-no-js-api' },
    reason: title,
    details: [
      'Migrate compiler API consumers separately; changing individual missing members does not restore the API.',
    ],
    downstream: missing.map((f) => ({
      file: f.usage.file,
      line: f.usage.line,
      column: f.usage.column,
      snippet: f.usage.snippet,
      code: codeOf(f),
      message: f.usage.compileError ?? f.reason,
    })),
  };
  report.findings = [cause, ...report.findings.filter((f) => !missing.includes(f))];
}
