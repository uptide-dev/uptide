import { expect, it } from 'vitest';
import { parseRegistry, renderRegistry } from './registry-file.js';

it('keeps an entry too long for one line through a later render', () => {
  const entries = [
    { dir: 'sentry-nextjs', name: 'sentryNextjsPack' },
    { dir: 'zod', name: 'zodPack' },
  ];
  const text = renderRegistry(entries);
  expect(text).toContain("  {\n    dir: 'sentry-nextjs',\n    pack: sentryNextjsPack,\n");
  expect(text).toContain(
    "  { dir: 'zod', pack: zodPack, verification: zodVerification as PackVerification },",
  );
  expect(text.split('\n').every((line) => line.length <= 100 || line.startsWith('import'))).toBe(
    true,
  );
  expect(parseRegistry(text)).toEqual(entries);
  // What `pack new` does: parse, add one, render again.
  const next = renderRegistry([...parseRegistry(text), { dir: 'ai', name: 'aiPack' }]);
  expect(parseRegistry(next).map((e) => e.dir)).toEqual(['ai', 'sentry-nextjs', 'zod']);
});
