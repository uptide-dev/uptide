import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

it('orders imports as biome does when one pack name prefixes another', () => {
  const repo = fileURLToPath(new URL('../../../../../', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'uptide-pack-registry-'));
  try {
    const entries = [
      { dir: 'react-router', name: 'reactRouterPack' },
      { dir: 'react', name: 'reactPack' },
    ];
    const text = renderRegistry(entries);
    // Biome compares path segments: `./react/` before `./react-router/`, not bytes (`-` < `/`).
    expect(text.indexOf("'./react/index.js'")).toBeLessThan(text.indexOf("'./react-router/"));
    expect(parseRegistry(text)).toEqual([...entries].reverse());
    writeFileSync(join(dir, 'registry.ts'), text);
    copyFileSync(join(repo, 'biome.json'), join(dir, 'biome.json'));
    copyFileSync(join(repo, '.gitignore'), join(dir, '.gitignore'));
    spawnSync('git', ['init', '-q'], { cwd: dir });
    const biome = spawnSync(join(repo, 'node_modules', '.bin', 'biome'), ['check', 'registry.ts'], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(biome.stdout + biome.stderr).toContain('No fixes applied');
    expect(biome.status).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
