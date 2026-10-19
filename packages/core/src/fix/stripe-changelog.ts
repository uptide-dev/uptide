import {
  calledResources,
  entryTouches,
  resourceEntries,
  usedResources,
} from '../packs/stripe/relevance.js';
import type { FixReport, ReviewSection } from './types.js';

const PER_RESOURCE = 5;
const TOTAL_ENTRIES = 20;
/** "Makes flexible billing mode the default for new subscriptions". */
const DEFAULT = /\bdefaults?\b/i;

/** Project retained Stripe review text; never change the full report or fetch a changelog. */
export function stripeChangelog(
  section: ReviewSection,
  report: FixReport,
): ReviewSection & { summary: string; omitted: string; unmatched: string[]; link: string } {
  const context = report.packContext;
  const names =
    report.apiChanges?.resources?.names ??
    (context?.evidence?.length
      ? calledResources(context.evidence, context.eventTypes ?? [])
      : usedResources(
          context?.usagePaths ?? report.sites.map((s) => s.finding.change.path),
          context?.eventTypes ?? [],
        ));
  // Both current lists and legacy <details> blocks have been normalized by withLists.
  const retained = [...section.lines, ...(section.lists ?? []).flatMap((l) => l.items)];
  // Evidence is required review material, even if a legacy entry's format is unknown.
  const evidence = retained.filter((line) => line.startsWith('- ') && / — evidence: \S/.test(line));
  const entries = retained
    .filter((line) => !evidence.includes(line))
    .flatMap((line) => {
      const match =
        /^- ([\w.-]+): \[(.*?)\]\((https:\/\/docs\.stripe\.com\/changelog\/[^)]+)\) — (breaking|non-breaking); (.*?)(?: — evidence: (.*))?$/.exec(
          line,
        );
      if (!match) return [];
      const [, version = '', title = '', url = '', kind, products = ''] = match;
      return [
        {
          version,
          title,
          url,
          breaking: kind === 'breaking',
          products,
          category: 'api',
          line,
        },
      ];
    });
  const grouped = new Map<string, typeof entries>();
  for (const entry of entries) {
    const resource = [...names]
      .sort()
      .find((name) => resourceEntries([entry], [], [name]).length > 0);
    if (resource) grouped.set(resource, [...(grouped.get(resource) ?? []), entry]);
  }
  // Breaking entries that no name in the code can match get their own list, never the collapsed
  // one: a new default reaches the calls that leave the parameter out, and an entry that names no
  // field, parameter or event leaves nothing to look for.
  const unmatched = [...grouped.values()]
    .flat()
    .filter((e) => {
      const t = entryTouches(e);
      return e.breaking && (DEFAULT.test(e.title) || (!t.fields.length && !t.events.length));
    })
    .sort(
      (a, b) =>
        Number(DEFAULT.test(b.title)) - Number(DEFAULT.test(a.title)) ||
        b.version.localeCompare(a.version) ||
        a.url.localeCompare(b.url),
    );
  for (const [resource, items] of grouped) {
    const rest = items.filter((e) => !unmatched.includes(e));
    if (rest.length) grouped.set(resource, rest);
    else grouped.delete(resource);
  }
  let available = TOTAL_ENTRIES;
  const lists: NonNullable<ReviewSection['lists']> = [];
  let shown = 0;
  const resourceCount = [...grouped.values()].reduce((n, items) => n + items.length, 0);
  for (const [resource, items] of [...grouped].sort(
    ([a, aa], [b, bb]) =>
      Number(bb.some((e) => e.breaking)) - Number(aa.some((e) => e.breaking)) || a.localeCompare(b),
  )) {
    items.sort(
      (a, b) =>
        Number(b.breaking) - Number(a.breaking) ||
        b.version.localeCompare(a.version) ||
        a.url.localeCompare(b.url),
    );
    const selected = items.slice(0, Math.min(PER_RESOURCE, available));
    available -= selected.length;
    shown += selected.length;
    if (!selected.length) continue;
    lists.push({
      summary: `${resource.replaceAll('_', ' ')} · ${items.length} changes (${items.filter((e) => e.breaking).length} breaking)`,
      items: selected.map((e) => e.line),
      more: `- … {n} more ${resource.replaceAll('_', ' ')} entries omitted for space; full text in report.json.`,
    });
  }
  const range = report.apiChanges ?? context?.apiVersions;
  // Unknown legacy entry formats are disclosed as omitted, not silently lost.
  const other =
    retained.filter((line) => line.startsWith('- ')).length -
    resourceCount -
    unmatched.length -
    evidence.length;
  const summary = (n: number) =>
    `Showing ${n} of ${resourceCount} other changes to resources you use, grouped by resource; ${resourceCount - n} resource changes and ${other} other changelog entries omitted. Full list in report.json.`;
  return {
    title: section.title,
    summary: summary(shown),
    omitted: summary(0),
    // In order, new defaults first; the PR body fits them to its budget.
    unmatched: unmatched.map((e) => e.line),
    lines: [
      `**${evidence.length} ${evidence.length === 1 ? 'change' : 'changes'} with evidence in your code**`,
      '',
      ...evidence,
    ],
    link: `[Stripe's changelog](https://docs.stripe.com/changelog)${range ? `, ${range.from} → ${range.to}` : ' for the recorded API version range'}.`,
    lists,
  };
}
