import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { git } from './process.js';

it('reads complete file contents and diffs larger than the default Git output buffer', () => {
  const root = mkdtempSync(join(tmpdir(), 'uptide-git-buffer-'));
  try {
    git(root, 'init', '-q');
    const contents = `${'a'.repeat(100)}\n`.repeat(20_000);
    expect(Buffer.byteLength(contents)).toBeGreaterThan(1024 * 1024);
    writeFileSync(join(root, 'large.txt'), contents);
    git(root, 'add', 'large.txt');
    expect(git(root, 'show', ':large.txt')).toBe(contents.trim());
    const diff = git(root, 'diff', '--cached', '--no-ext-diff', '--no-color');
    expect(diff.split('\n').filter((line) => line === `+${'a'.repeat(100)}`)).toHaveLength(20_000);
    expect(() => git(root, 'show', ':missing.txt')).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
