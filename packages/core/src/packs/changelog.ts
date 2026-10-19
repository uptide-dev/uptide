import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { satisfies } from '../fetch/range.js';

/** A line that says a behavior changed, not only that something was added or fixed. */
const BEHAVIOR = /\b(?:defaults?|no longer|now|instead of|silently)\b/i;
/** A release heading: `## 4.1.0`, `## [4.1.0] - 2025-07-01`, `# v4.1.0`, `### Patch Changes` excepted. */
const HEADING = /^#{1,4}\s+\[?v?(\d+\.\d+\.\d+(?:-[\w.]+)?)\]?/;
// ponytail: a changelog of thousands of matching lines would crowd the prompt; the first 40 are enough context.
const MAX_LINES = 40;

/**
 * The generic tier of ADR 0017: lines of a package's own CHANGELOG.md for the releases after
 * `from` up to `to` that name something the repository uses and say a behavior changed, each
 * with its release. Context for the agent, quoted as written; never a finding.
 */
export function changelogLines(
  text: string,
  input: { from: string; to: string; names: readonly string[] },
): string[] {
  const names = [...new Set(input.names.filter((n) => /^[\w$]{3,}$/.test(n)))];
  if (!names.length) return [];
  const named = new RegExp(
    `(?<![\\w$])(?:${names.map((n) => n.replace(/\$/g, '\\$')).join('|')})(?![\\w$])`,
  );
  const lines: string[] = [];
  let release: string | undefined;
  for (const raw of text.split('\n')) {
    const heading = HEADING.exec(raw);
    if (heading) {
      const version = heading[1] as string;
      release = satisfies(version, `>${input.from} <=${input.to}`) ? version : undefined;
      continue;
    }
    const line = raw.trim().replace(/^[-*]\s+/, '');
    if (release && line && BEHAVIOR.test(line) && named.test(line))
      lines.push(`${release}: ${line}`);
    if (lines.length === MAX_LINES) break;
  }
  return lines;
}

/** `changelogLines` from the CHANGELOG.md in a package's directory; none when it ships without one. */
export function packageChangelog(
  dir: string,
  input: { from: string; to: string; names: readonly string[] },
): string[] {
  let text: string;
  try {
    text = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
  } catch {
    return [];
  }
  return changelogLines(text, input);
}

/**
 * The names a file imports from `pkg` and reads off its namespace (`z.object` → `object`): what the
 * repository uses, as far as the files at the reported sites show it.
 */
export function usedNames(text: string, pkg: string): string[] {
  const escaped = pkg.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const names = new Set<string>();
  const imports = new RegExp(
    `import\\s+(?:type\\s+)?(?:([\\w$]+)\\s*,?\\s*)?(?:\\*\\s+as\\s+([\\w$]+)|\\{([^}]*)\\})?\\s*from\\s+['"]${escaped}(?:/[^'"]*)?['"]`,
    'g',
  );
  const spaces: string[] = [];
  for (const m of text.matchAll(imports)) {
    if (m[1]) spaces.push(m[1]);
    if (m[2]) spaces.push(m[2]);
    for (const part of (m[3] ?? '').split(',')) {
      const name = part
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name === 'z')
        spaces.push(
          part
            .trim()
            .split(/\s+as\s+/)
            .pop() as string,
        );
      else if (name) names.add(name);
    }
  }
  for (const space of spaces)
    for (const m of text.matchAll(
      new RegExp(`(?<![\\w$.])${space.replace(/\$/g, '\\$')}\\.([\\w$]+)`, 'g'),
    ))
      names.add(m[1] as string);
  return [...names].sort();
}
