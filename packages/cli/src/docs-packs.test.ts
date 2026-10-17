import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));

it('generates both pack tables and rejects stale or missing tables without writing in check mode', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'uptide-docs-packs-'));
  try {
    mkdirSync(join(cwd, 'scripts'));
    mkdirSync(join(cwd, 'docs'));
    copyFileSync(join(root, 'scripts/docs-packs.ts'), join(cwd, 'scripts/docs-packs.ts'));
    for (const directory of ['packages', 'node_modules'])
      symlinkSync(join(root, directory), join(cwd, directory), 'dir');
    writeFileSync(join(cwd, 'package.json'), '{"type":"module"}');
    const documents = ['README.md', 'docs/compatibility.md'];
    const template = '# Keep this prose\n\n<!-- packs:start -->\n<!-- packs:end -->\n\nAfter.\n';
    for (const document of documents) writeFileSync(join(cwd, document), template);
    const run = (...args: string[]) =>
      spawnSync(
        process.execPath,
        ['--conditions=source', '--import', 'tsx', 'scripts/docs-packs.ts', ...args],
        {
          cwd,
          encoding: 'utf8',
        },
      );

    const generated = run();
    expect(generated.status, generated.stderr).toBe(0);
    const current = readFileSync(join(cwd, documents[0] as string), 'utf8');
    expect(current).toMatch(/^# Keep this prose\n/);
    expect(current).toMatch(/\nAfter.\n$/);
    expect(current).toContain('| Rules |');
    expect(current).toContain('| `express` | 4 → 5 |');
    expect(current).toContain('| `redis` | 4.x/5.x → 5.x/6.x |');
    expect(current).toContain('| `stripe` | 14+ → latest, API version pinning |');
    expect(current).toContain('| verified |');
    expect(current).not.toContain('| candidate |');
    expect(current.match(/deanmoses\/tacocat-gallery-sam/g)).toHaveLength(1);
    expect(current).not.toContain('fixtures/repos/');
    const matrix = readFileSync(join(cwd, documents[1] as string), 'utf8');
    expect(matrix).toContain('| candidate |');
    expect(matrix).toContain('| verified |');
    expect(matrix).toContain('| `ioredis` | 5 → 6 |');
    expect(matrix).toContain('| `stripe` | 14+ → latest, API version pinning |');
    expect(matrix).not.toContain('more in validation');
    expect(matrix).toContain('| Package | Rewrite rule | Precision |');
    expect(current).not.toContain('| Rewrite rule |');
    const candidates = matrix.split('\n').filter((line) => line.endsWith('| candidate |')).length;
    expect(current).toContain(
      `${candidates} more in validation: see the [compatibility matrix](docs/compatibility.md).`,
    );
    expect(current.split('\n').filter((line) => line.startsWith('| `'))).toEqual(
      matrix.split('\n').filter((line) => line.endsWith('| verified |')),
    );
    expect(run('--check').status).toBe(0);

    for (const document of documents) {
      writeFileSync(join(cwd, document), template);
      const stale = run('--check');
      expect(stale.status).toBe(1);
      expect(stale.stderr).toContain(`${document}: the packs table is stale`);
      expect(readFileSync(join(cwd, document), 'utf8')).toBe(template);
      expect(run().status).toBe(0);
      expect(readFileSync(join(cwd, document), 'utf8')).toBe(
        document === 'README.md' ? current : matrix,
      );
    }
    writeFileSync(join(cwd, 'docs/compatibility.md'), '# Missing markers\n');
    const missing = run('--check');
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('docs/compatibility.md: expected <!-- packs:start -->');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}, 60_000);
