import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { changelogLines, packageChangelog, usedNames } from './changelog.js';

const CHANGELOG = `# Changelog

## 5.0.0

- \`parse\` now trims whitespace by default
- Added \`format\`
- \`render\` no longer escapes HTML; pass \`escape: true\` instead of relying on it

## [4.2.0] - 2026-01-01

### Patch Changes

- \`parse\` silently drops unknown keys
- \`unused\` now returns null

## 4.1.0

- \`parse\` now throws on empty input
`;

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('CHANGELOG.md as agent context', () => {
  it('keeps the releases after the installed version up to the target, and only lines that name a used symbol and say a behavior changed', () => {
    expect(
      changelogLines(CHANGELOG, {
        from: '4.1.0',
        to: '5.0.0',
        names: ['parse', 'render', 'format'],
      }),
    ).toEqual([
      '5.0.0: `parse` now trims whitespace by default',
      '5.0.0: `render` no longer escapes HTML; pass `escape: true` instead of relying on it',
      '4.2.0: `parse` silently drops unknown keys',
    ]);
    expect(changelogLines(CHANGELOG, { from: '4.1.0', to: '4.2.0', names: ['render'] })).toEqual(
      [],
    );
    expect(changelogLines(CHANGELOG, { from: '4.1.0', to: '5.0.0', names: [] })).toEqual([]);
  });

  it('reads the CHANGELOG.md a package ships, and none when it ships without one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'uptide-changelog-'));
    dirs.push(dir);
    expect(packageChangelog(dir, { from: '4.1.0', to: '5.0.0', names: ['parse'] })).toEqual([]);
    writeFileSync(join(dir, 'CHANGELOG.md'), CHANGELOG);
    expect(packageChangelog(dir, { from: '4.1.0', to: '5.0.0', names: ['parse'] })).toHaveLength(2);
  });

  it('names what a file imports from the package and reads off its namespace', () => {
    const text = [
      "import { z } from 'zod';",
      "import { ZodError, type ZodIssue as Issue } from 'zod';",
      "import * as v from 'zod/v4';",
      "import { other } from 'zod-to-json-schema';",
      'const a = z.object({ b: z.string().email() });',
      'v.uuid(); x.z.nope();',
    ].join('\n');
    expect(usedNames(text, 'zod')).toEqual(['ZodError', 'ZodIssue', 'object', 'string', 'uuid']);
  });
});
