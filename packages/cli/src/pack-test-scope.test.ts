import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const script = join(root, 'scripts/pack-test-scope.mjs');
const { packScope, registeredDirs } = (await import(script)) as {
  packScope: (files: string[], registered: string[]) => string[] | null;
  registeredDirs: (root: string) => string[];
};

const registered = ['ai', 'sentry-nextjs', 'zod'];
const pack = (path: string) => `packages/core/src/packs/${path}`;

describe('packScope', () => {
  it.each<[string, string[], string[] | null]>([
    ['one pack', [pack('zod/rules.ts'), pack('zod/ground-truth.json')], ['zod']],
    [
      'two packs with the files that list them',
      [
        pack('zod/fixtures/x/before.ts'),
        pack('ai/index.ts'),
        pack('registry.ts'),
        'README.md',
        'docs/packs.md',
        '.changeset/quiet-fox.md',
      ],
      ['ai', 'zod'],
    ],
    ['a pack with the queue', [pack('zod/rules.ts'), 'packs/queue.json'], ['zod']],
    ['only the queue', ['packs/queue.json'], null],
    ['the engine', [pack('zod/rules.ts'), 'packages/core/src/check/run.ts'], null],
    ['pack tooling', [pack('zod/rules.ts'), pack('tooling/pack-test.ts')], null],
    ['packs/index.ts', [pack('zod/rules.ts'), pack('index.ts')], null],
    ['a shared directory no pack is registered as', [pack('sentry/rules.ts')], null],
    ['an unregistered pack', [pack('joi/index.ts')], null],
    ['the workflow', [pack('zod/rules.ts'), '.github/workflows/packs.yml'], null],
    ['a nested changeset path', [pack('zod/rules.ts'), '.changeset/x/y.md'], null],
    ['only listing files', [pack('registry.ts'), 'README.md'], null],
    ['nothing', [], null],
  ])('%s', (_, files, ids) => {
    expect(packScope(files, registered)).toEqual(ids);
  });
});

describe('the script', () => {
  it('reads registry.ts, multi-line entries too', () => {
    expect(registeredDirs(root)).toEqual(expect.arrayContaining(['zod', 'sentry-nextjs', 'ai']));
  });

  it('prints the changed packs as the matrix', () => {
    const out = execFileSync('node', [script], {
      input: `${pack('zod/rules.ts')}\nREADME.md\n`,
      encoding: 'utf8',
    });
    expect(out).toBe('packs=["zod"]\n');
  });

  it('prints every registered pack for a full run', () => {
    const out = execFileSync('node', [script], { input: 'pnpm-lock.yaml\n', encoding: 'utf8' });
    expect(out).toBe(`packs=${JSON.stringify(registeredDirs(root))}\n`);
  });
});
