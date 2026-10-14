import { calledResources, resourceEntries, usedResources } from '../packs/stripe/relevance.js';
import type { FixReport, ReviewSection } from './types.js';

const PER_RESOURCE = 5;
const TOTAL_ENTRIES = 20;

/** Project retained Stripe review text; never change the full report or fetch a changelog. */
export function stripeChangelog(section: ReviewSection, report: FixReport): ReviewSection {
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
  const entries = retained.flatMap((line) => {
    const match =
      /^- ([\w.-]+): \[(.*?)\]\((https:\/\/docs\.stripe\.com\/changelog\/[^)]+)\) — (breaking|non-breaking); (.*?)(?: — evidence: (.*))?$/.exec(
        line,
      );
    if (!match) return [];
    const [, version = '', title = '', url = '', kind, products = '', evidence] = match;
    return [
      {
        version,
        title,
        url,
        breaking: kind === 'breaking',
        products,
        category: 'api',
        line,
        evidence,
      },
    ];
  });
  const grouped = new Map<string, typeof entries>();
  for (const entry of entries) {
    const resource = [...names]
      .sort()
      .find((name) => resourceEntries([entry], [], [name]).length > 0);
    // Concrete evidence can survive even in a legacy run without a resource inventory.
    const key = resource ?? (entry.evidence ? 'Evidenced API usage' : undefined);
    if (key) grouped.set(key, [...(grouped.get(key) ?? []), entry]);
  }
  let available = TOTAL_ENTRIES;
  const lists: NonNullable<ReviewSection['lists']> = [];
  let shown = 0;
  const relevant = [...grouped.values()].reduce((n, items) => n + items.length, 0);
  for (const [resource, items] of [...grouped].sort(
    ([a, aa], [b, bb]) =>
      Number(bb.some((e) => !!e.evidence)) - Number(aa.some((e) => !!e.evidence)) ||
      Number(bb.some((e) => e.breaking)) - Number(aa.some((e) => e.breaking)) ||
      a.localeCompare(b),
  )) {
    items.sort(
      (a, b) =>
        Number(!!b.evidence) - Number(!!a.evidence) ||
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
  const other = retained.filter((line) => line.startsWith('- ')).length - relevant;
  return {
    title: section.title,
    lines: [
      `${relevant} changes touch resources used by this code. Showing up to ${shown}, grouped by resource (up to ${PER_RESOURCE} per resource, ${TOTAL_ENTRIES} total); evidenced entries first, then breaking changes.`,
      ...(relevant > shown || other
        ? [
            `${relevant - shown} resource changes and ${other} other changelog entries omitted. Full text is retained in report.json.`,
          ]
        : []),
      `[Stripe's changelog](https://docs.stripe.com/changelog)${range ? `, ${range.from} → ${range.to}` : ' for the recorded API version range'}.`,
    ],
    lists,
  };
}
