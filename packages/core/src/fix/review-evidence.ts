import type { FixReport } from './types.js';

/** How many files a decision line names before it counts the rest. */
const NAMED = 5;
/**
 * Accepted agent choices belong beside the pack's owner decisions, not buried in logs. One
 * bullet per rule and resource (UPT-70): a choice the pack already puts to the owner for that
 * rule is not said again, and the same choice in several files is one bullet naming them all.
 */
export function agentDecisionLines(report: FixReport): string[] {
  const decided = new Set(report.decidedRules ?? []);
  type Said = { files: string[]; decisions: string[] };
  const said = new Map<string, Said>();
  const lines = (report.llm.tasks ?? [])
    .filter((task) => task.gate === 'accepted')
    .flatMap((task, index): (string | Said)[] => {
      const sites = report.sites.filter(
        (site) => site.outcome === 'agent' && task.files.includes(site.finding.usage.file),
      );
      const cache = sites.filter((site) => site.rule === 'revalidate-tag-profile');
      const file = cache[0]?.finding.usage.file;
      const diff = file ? (task.diffs?.[file] ?? cache[0]?.diff ?? '') : '';
      const added = diff
        .split('\n')
        .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
        .map((line) => line.slice(1));
      const profile = added.join('\n').match(/const\s+(\w+)\s*=\s*\{\s*expire:\s*0\s*\}/)?.[1];
      // Only specialize the wording when every reported call has this exact accepted choice.
      // Mixed profiles or more complex patches keep the agent's explicit decision text below.
      const immediate = added.filter((line) => {
        const argument = line.match(
          /\brevalidateTag\([^;]*,\s*(\{\s*expire:\s*0\s*\}|\w+)\s*\)\s*;?\s*$/,
        )?.[1];
        return argument !== undefined && (argument === profile || /^\{/.test(argument));
      }).length;
      // This choice is verifiable from the accepted patch, rather than inferred from a plan.
      if (
        report.package === 'next' &&
        cache.length === sites.length &&
        cache.length > 0 &&
        new Set(cache.map((site) => site.finding.usage.file)).size === 1 &&
        immediate === cache.length
      ) {
        return [...new Set(cache.map((site) => site.finding.usage.file))].map((file) => {
          const count = new Set(
            cache
              .filter((site) => site.finding.usage.file === file)
              .map((site) => site.finding.usage.line),
          ).size;
          return `- ${count} revalidateTag calls in \`${file}\` now pass \`{ expire: 0 }\` (immediate expiry, as in Next 15). Next recommends [\`"max"\`](https://nextjs.org/docs/app/api-reference/functions/revalidateTag) (stale-while-revalidate) for most cases; \`updateTag\` is another option for Server Actions: confirm or change.`;
        });
      }
      // A behavior record's line already puts it to the owner, with its sources: the agent's
      // restatement of it, naming the record id, is not said again.
      const recorded = new Set((report.packContext?.recordSites ?? []).map((r) => r.record));
      const decisions = (task.summary?.decisions ?? []).filter(
        (d) => ![...recorded].some((id) => d.includes(id)),
      );
      const rules = [...new Set(sites.map((site) => site.rule ?? ''))].sort();
      if (decisions.length === 0 || (rules.length > 0 && rules.every((r) => decided.has(r))))
        return [];
      // The resource is what the sites' changed symbols belong to: `Stripe.Subscription`.
      const resources = [
        ...new Set(sites.map((site) => site.finding.change.path.split('#')[0])),
      ].sort();
      const key = rules.length > 0 ? `${rules.join(',')}|${resources.join(',')}` : `#${index}`;
      // The files the task changed: its scope can be the whole repository (verification feedback).
      const changed = Object.keys(task.diffs ?? {});
      const files = changed.length ? changed : task.files;
      const first = said.get(key);
      if (first) {
        first.files.push(...files.filter((file) => !first.files.includes(file)));
        return [];
      }
      const entry = { files: [...files], decisions };
      said.set(key, entry);
      return [entry];
    });
  return lines.flatMap((line) => {
    if (typeof line === 'string') return [line];
    const more = line.files.length - NAMED;
    const files = `${line.files
      .slice(0, NAMED)
      .map((file) => `\`${file}\``)
      .join(', ')}${more > 0 ? ` and ${more} more files` : ''}`;
    return line.decisions.map(
      (decision) =>
        `- ${files}: ${decision.trim()}${/[.!?]$/.test(decision.trim()) ? '' : '.'} Confirm or change.`,
    );
  });
}

/** First failing suite's error, bounded, plus counts; repeated noise is printed once. */
export function testOutput(output: string): string {
  const lines = output.replace(/\r/g, '').split('\n');
  const summary = lines.filter((line) => /^\s*(?:Test Suites:|Test Files\s|Tests[:\s])/.test(line));
  const start = lines.findIndex((line) => /^\s*(?:FAIL\b|❯.*(?:test|spec)\.)/.test(line));
  let selected: string[];
  if (start >= 0) {
    let end = lines.findIndex(
      (line, index) =>
        index > start && /^\s*(?:FAIL\b|PASS\b|Test Suites:|Test Files\s|Tests[:\s])/.test(line),
    );
    if (end < 0) end = lines.length;
    selected = [
      ...lines.slice(0, start).filter((line) => !/^\s*PASS\b/.test(line)),
      ...lines.slice(start, end),
    ];
  } else selected = lines.filter((line) => !summary.includes(line));
  const counts = new Map<string, number>();
  for (const line of selected) if (line.trim()) counts.set(line, (counts.get(line) ?? 0) + 1);
  const seen = new Set<string>();
  const collapsed = selected.flatMap((line) => {
    if (!line.trim()) return [line];
    if (seen.has(line)) return [];
    seen.add(line);
    const count = counts.get(line) ?? 1;
    return [count > 1 ? `${line} (repeated ${count} times)` : line];
  });
  const bounded = collapsed.slice(0, 65).join('\n').slice(0, 4500).trim();
  const omitted = collapsed.length > 65 || collapsed.join('\n').length > 4500;
  return [
    bounded,
    ...(omitted ? ['… output truncated; full output is retained in report.json.'] : []),
    ...new Set(summary),
  ]
    .filter(Boolean)
    .join('\n');
}
