import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { fileTransaction } from './file-transaction.js';

const root = mkdtempSync(join(tmpdir(), 'uptide-transaction-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
it('verifies create, write, delete and rename together', async () => {
  writeFileSync(join(root, 'middleware.ts'), 'old');
  writeFileSync(join(root, 'obsolete.ts'), 'remove');
  const result = await fileTransaction(
    root,
    [
      { kind: 'write', file: 'middleware.ts', text: 'proxy' },
      { kind: 'rename', file: 'middleware.ts', to: 'proxy.ts' },
      { kind: 'create', file: 'src/helper.ts', text: 'helper' },
      { kind: 'delete', file: 'obsolete.ts' },
    ],
    async () => {
      expect(existsSync(join(root, 'middleware.ts'))).toBe(false);
      expect(readFileSync(join(root, 'proxy.ts'), 'utf8')).toBe('proxy');
      expect(readFileSync(join(root, 'src/helper.ts'), 'utf8')).toBe('helper');
      return true;
    },
  );
  expect(result.applied).toBe(true);
  expect(result.files).toContain('middleware.ts');
});
it('rolls every file back if verification fails or throws', async () => {
  for (const throws of [false, true]) {
    writeFileSync(join(root, 'before.ts'), 'before');
    const result = await fileTransaction(
      root,
      [
        { kind: 'rename', file: 'before.ts', to: 'after.ts' },
        { kind: 'create', file: 'new/helper.ts', text: 'new' },
      ],
      async () => {
        if (throws) throw new Error('compiler failed');
        return false;
      },
    );
    expect(result.applied).toBe(false);
    expect(readFileSync(join(root, 'before.ts'), 'utf8')).toBe('before');
    expect(existsSync(join(root, 'after.ts'))).toBe(false);
    expect(existsSync(join(root, 'new'))).toBe(false);
  }
});
it('preflights every edit before modifying any file', async () => {
  writeFileSync(join(root, 'safe.ts'), 'safe');
  const result = await fileTransaction(
    root,
    [
      { kind: 'write', file: 'safe.ts', text: 'changed' },
      { kind: 'create', file: '../outside', text: 'bad' },
    ],
    async () => true,
  );
  expect(result.applied).toBe(false);
  expect(readFileSync(join(root, 'safe.ts'), 'utf8')).toBe('safe');
});

it('fix preserves the old finding anchor when it renames a file', async () => {
  const { zodFixture } = await import('./test-fixture.js');
  const { zodPack } = await import('../packs/zod/index.js');
  const { fix } = await import('./run.js');
  const { git } = await import('./process.js');
  const fixture = zodFixture(root);
  writeFileSync(
    join(fixture.root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, skipLibCheck: true }, include: ['*.ts'] }),
  );
  git(fixture.root, 'add', '.');
  git(fixture.root, 'commit', '-m', 'include renamed source');
  const pack = {
    ...zodPack,
    transform: (...args: Parameters<typeof zodPack.transform>) => ({
      ...zodPack.transform(...args),
      edits: [{ kind: 'rename' as const, file: 'index.ts', to: 'renamed.ts' }],
    }),
  };
  const result = await fix({ cwd: fixture.root, only: 'zod', pack, fixer: null }, fixture.services);
  expect(result.verification.passed).toBe(true);
  expect(result.sites[0]?.finding.usage.file).toBe('index.ts');
  expect(result.sites[0]?.editedFiles).toEqual(['index.ts', 'renamed.ts']);
  expect(existsSync(join(fixture.root, 'index.ts'))).toBe(false);
  expect(readFileSync(join(fixture.root, 'renamed.ts'), 'utf8')).toContain('error:');
});

it('fix rolls the entire multi-file edit back on new compiler errors', async () => {
  const { zodFixture } = await import('./test-fixture.js');
  const { zodPack } = await import('../packs/zod/index.js');
  const { fix } = await import('./run.js');
  const fixture = zodFixture(root);
  const before = readFileSync(join(fixture.root, 'index.ts'), 'utf8');
  const pack = {
    ...zodPack,
    transform: (...args: Parameters<typeof zodPack.transform>) => ({
      ...zodPack.transform(...args),
      edits: [
        { kind: 'create' as const, file: 'helper.ts', text: 'helper' },
        { kind: 'write' as const, file: 'index.ts', text: 'const wrong: number = "bad";' },
      ],
    }),
  };
  const result = await fix({ cwd: fixture.root, only: 'zod', pack, fixer: null }, fixture.services);
  expect(result.sites[0]?.outcome).toBe('manual');
  expect(existsSync(join(fixture.root, 'helper.ts'))).toBe(false);
  expect(readFileSync(join(fixture.root, 'index.ts'), 'utf8')).toBe(before);
});

it('preserves executable permissions when renaming', async () => {
  writeFileSync(join(root, 'tool.sh'), '#!/bin/sh\n');
  chmodSync(join(root, 'tool.sh'), 0o755);
  const result = await fileTransaction(
    root,
    [{ kind: 'rename', file: 'tool.sh', to: 'renamed-tool.sh' }],
    async () => true,
  );
  expect(result.applied).toBe(true);
  expect(statSync(join(root, 'renamed-tool.sh')).mode & 0o777).toBe(0o755);
});
