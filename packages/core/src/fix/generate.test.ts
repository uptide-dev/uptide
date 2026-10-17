import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { compileAgainstTargets } from '../adapters/typescript/compile.js';
import { prepareWorkspace } from '../verify/prepare-workspace.js';
import { buildWorkspaces } from './build.js';
import { generateClients, missingGeneratorStep } from './generate.js';
import { diagnostics } from './verify.js';

const scratch = mkdtempSync(join(tmpdir(), 'uptide-generate-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

it("runs the repository's own prisma generate where a schema is, with no database, and reports it", async () => {
  const root = join(scratch, 'repo');
  mkdirSync(join(root, 'packages/core/prisma'), { recursive: true });
  mkdirSync(join(root, 'packages/plain'), { recursive: true });
  mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
  writeFileSync(join(root, 'packages/core/package.json'), '{"name":"core"}');
  writeFileSync(
    join(root, 'packages/core/prisma/schema.prisma'),
    'generator client { provider = "prisma-client-js" }',
  );
  writeFileSync(join(root, 'packages/plain/package.json'), '{"name":"plain"}');
  // A stand-in for the binary: records how it was called and where.
  const bin = join(root, 'node_modules/.bin/prisma');
  writeFileSync(
    bin,
    `#!/bin/sh\necho "cwd=$(pwd) args=$* checkpoint=$CHECKPOINT_DISABLE" > "${root}/called.txt"\necho generated\n`,
  );
  chmodSync(bin, 0o755);
  const generated = await generateClients(root, ['packages/core', 'packages/plain']);
  expect(generated).toEqual([
    {
      workspace: 'packages/core',
      command: 'prisma generate --schema prisma/schema.prisma',
      status: 'generated',
    },
  ]);
  const called = readFileSync(join(root, 'called.txt'), 'utf8');
  expect(called).toContain('args=generate --schema prisma/schema.prisma');
  expect(called).toContain('checkpoint=1');
  expect(called).toMatch(/cwd=.*packages\/core/);
  // A failing generator is reported, never fatal.
  writeFileSync(bin, '#!/bin/sh\necho "schema error" >&2\nexit 1\n');
  expect(await generateClients(root, ['packages/core'])).toMatchObject([
    { status: 'failed', output: expect.stringContaining('schema error') },
  ]);
});

it('fix generates the client the fixture imports; check names the step; a failing generator is reported', async () => {
  const fixtures = resolve(import.meta.dirname, '../../../../fixtures');
  const root = join(scratch, 'prisma-generated');
  cpSync(join(fixtures, 'repos/prisma-generated'), root, { recursive: true });
  mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
  const bin = join(root, 'node_modules/.bin/prisma');
  // A stand-in for `prisma generate`: writes the client where the schema's output says.
  writeFileSync(
    bin,
    '#!/bin/sh\nmkdir -p src/generated/prisma\necho "export class PrismaClient {}" > src/generated/prisma/client.ts\n',
  );
  chmodSync(bin, 0o755);
  const target = [{ name: 'plain', dir: join(fixtures, 'deps/plain-v2') }];
  const before = await compileAgainstTargets({ dir: root }, target, {});
  expect(before.skipped).toBe(
    'types not verified: run `prisma generate` (generated client missing)',
  );
  expect(diagnostics(root, ['.']).length).toBeGreaterThan(0);

  const prepared = await prepareWorkspace(root, ['.'], {
    build: buildWorkspaces,
    generate: generateClients,
  });
  expect(prepared.generated).toMatchObject([{ workspace: '.', status: 'generated' }]);
  expect(diagnostics(root, ['.'])).toEqual([]);

  writeFileSync(bin, '#!/bin/sh\necho "schema error" >&2\nexit 1\n');
  expect(
    (await prepareWorkspace(root, ['.'], { build: buildWorkspaces, generate: generateClients }))
      .generated,
  ).toMatchObject([{ status: 'failed', output: expect.stringContaining('schema error') }]);
});

it('names graphql-codegen for an import of its output and refuses a remote schema', async () => {
  const root = join(scratch, 'codegen');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"devDependencies":{"@graphql-codegen/cli":"5.0.0"}}');
  writeFileSync(
    join(root, 'codegen.ts'),
    "export default { schema: 'schema.graphql', generates: { './src/gql/': { preset: 'client' } } };\n",
  );
  expect(missingGeneratorStep(root, ['../gql/graphql'])).toBe('graphql-codegen');
  expect(missingGeneratorStep(root, ['@/lib/other'])).toBeUndefined();
  writeFileSync(
    join(root, 'codegen.ts'),
    "export default { schema: 'https://api.example.com/graphql', generates: { 'src/gql/': {} } };\n",
  );
  expect(await generateClients(root, ['.'])).toMatchObject([
    {
      command: 'graphql-codegen --config codegen.ts',
      status: 'failed',
      output: expect.stringContaining('remote schema'),
    },
  ]);
});
