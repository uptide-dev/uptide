/** Explicit maintenance command; the migration pack never downloads changelog data. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { sourceProblems } from '../packages/core/src/packs/records.ts';
import { parseChangelog } from '../packages/core/src/packs/stripe/changelog.ts';

import { entryTouches } from '../packages/core/src/packs/stripe/relevance.ts';

// Accepted records are pinned at authoring time. Fetch and validate before writing any output;
// drift needs a human to review a new quote and snapshot, never an automatic hash refresh.
const records = JSON.parse(
  readFileSync(new URL('../packages/core/src/packs/stripe/records.json', import.meta.url), 'utf8'),
);
const cache = new URL('../.cache/stripe-sources/', import.meta.url);
mkdirSync(cache, { recursive: true });
for (const record of records) {
  for (const source of record.sources) {
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`Stripe source: HTTP ${response.status}: ${source.url}`);
    const text = await response.text();
    if (sourceProblems(source, text).length)
      throw new Error(
        `Stripe behavior source drift: ${source.url}; author review required: review the quote and full-page sha256 explicitly`,
      );
    writeFileSync(new URL(`${source.sha256}.md`, cache), text);
  }
}

const source = 'https://docs.stripe.com/changelog.md';
const response = await fetch(source);
if (!response.ok) throw new Error(`Stripe changelog: HTTP ${response.status}`);
const markdown = await response.text();
const parsed = parseChangelog(markdown);
const data = {
  schema: 1,
  source,
  sha256: createHash('sha256').update(markdown).digest('hex'),
  generatedAt: new Date().toISOString(),
  ...parsed,
  entries: parsed.entries.map((e) => ({ ...e, touches: entryTouches(e) })),
};
writeFileSync(
  new URL('../packages/core/src/packs/stripe/changelog.v1.json', import.meta.url),
  `${JSON.stringify(data, null, 2)}\n`,
);
console.log(
  `${data.versions.length} releases, ${data.entries.length} entries; SHA256 ${data.sha256}`,
);
