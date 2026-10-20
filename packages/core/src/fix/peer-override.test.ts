import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import type { PackageFetcher } from '../domain/io.js';
import type { ManagerKind } from './managers/manager.js';
import { git } from './process.js';
import { prBody } from './report.js';
import { type FixServices, fix } from './run.js';
import { zodFixture } from './test-fixture.js';

// UPT-125: `plugin` 1.0.0 peers on zod ^3 and only plugin 2.0.0, a major no pack migrates,
// accepts zod 4. Uptide keeps plugin 1.0.0 with a peer override scoped to it, never the major.
const scratch = mkdtempSync(join(tmpdir(), 'uptide-peer-override-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const fields: Record<ManagerKind, [string[], unknown]> = {
  npm: [['overrides'], { plugin: { zod: '$zod' } }],
  pnpm: [['pnpm', 'peerDependencyRules', 'allowedVersions'], { 'plugin>zod': '4.6.5' }],
  'yarn-classic': [['resolutions'], { 'plugin/zod': '4.6.5' }],
  'yarn-berry': [['resolutions'], { 'plugin/zod': '4.6.5' }],
};
const shown: Record<ManagerKind, string> = {
  npm: '`overrides.plugin.zod`',
  pnpm: '`pnpm.peerDependencyRules.allowedVersions["plugin>zod"]`',
  'yarn-classic': '`resolutions["plugin/zod"]`',
  'yarn-berry': '`resolutions["plugin/zod"]`',
};

function blocked(manager: ManagerKind) {
  const f = zodFixture(scratch);
  const json = JSON.parse(readFileSync(join(f.root, 'package.json'), 'utf8'));
  json.dependencies.plugin = '^1.0.0';
  if (manager === 'yarn-berry') json.packageManager = 'yarn@4.9.2';
  writeFileSync(join(f.root, 'package.json'), JSON.stringify(json));
  mkdirSync(join(f.root, 'node_modules/plugin'));
  writeFileSync(
    join(f.root, 'node_modules/plugin/package.json'),
    JSON.stringify({ name: 'plugin', version: '1.0.0', peerDependencies: { zod: '^3' } }),
  );
  if (manager !== 'pnpm') rmSync(join(f.root, 'pnpm-lock.yaml'));
  if (manager === 'npm')
    writeFileSync(
      join(f.root, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': json,
          'node_modules/zod': { version: '3.25.76' },
          'node_modules/plugin': { version: '1.0.0', peerDependencies: { zod: '^3' } },
        },
      }),
    );
  if (manager === 'yarn-classic') writeFileSync(join(f.root, 'yarn.lock'), '# yarn lockfile v1\n');
  if (manager === 'yarn-berry')
    writeFileSync(join(f.root, 'yarn.lock'), '__metadata:\n  version: 8\n');
  git(f.root, 'add', '.');
  git(f.root, 'commit', '-m', 'peer blocker');
  type Manifests = NonNullable<PackageFetcher['manifests']>;
  const manifests = vi.fn<Manifests>(
    async (name): ReturnType<Manifests> =>
      name === 'zod'
        ? { '4.6.5': {} }
        : {
            '1.0.0': { peerDependencies: { zod: '^3' } },
            '2.0.0': { peerDependencies: { zod: '^3 || ^4' } },
          },
  );
  // Only what the manager would write: the target installed, for the version checks.
  const install = vi.fn(async (dir: string, _upgrade?: Parameters<FixServices['install']>[1]) => {
    const file = join(dir, 'node_modules/zod/package.json');
    writeFileSync(
      file,
      JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), version: '4.6.5' }),
    );
    writeFileSync(
      join(dir, 'node_modules/zod/index.d.ts'),
      'export declare const z: { string(options: {error:(iss:{input:unknown})=>string|undefined}): string };',
    );
  });
  return { root: f.root, services: { ...f.services, manifests, install } };
}

it.each(Object.keys(fields) as ManagerKind[])(
  '%s keeps the blocker on its major with a scoped peer override, listed in the report and PR body',
  async (manager) => {
    const { root, services } = blocked(manager);
    const result = await fix({ cwd: root, only: 'zod', target: '4.6.5', fixer: null }, services);
    const [path, expected] = fields[manager];
    const committed = JSON.parse(git(root, 'show', `${result.branch}:package.json`));
    expect(path.reduce((o, k) => o?.[k], committed)).toEqual(expected);
    expect(committed.dependencies.plugin).toBe('^1.0.0');
    // The override's package is inside the lockfile scope check, and nothing else moves with it.
    expect(services.install.mock.calls[0]?.[1]).toMatchObject({ allowedPeers: ['plugin'] });
    expect(services.install.mock.calls[0]?.[1]).not.toHaveProperty('also');
    expect(result.companions).toBeUndefined();
    expect(result.verification.passed).toBe(true);
    expect(result.peerConflicts).toMatchObject([
      { name: 'plugin', version: '1.0.0', allowed: true, declined: '2.0.0', strategy: 'override' },
    ]);
    expect(prBody(result)).toContain(
      `Uptide added a peer override to package.json: ${shown[manager]}. 2.0.0 accepts zod 4.6.5 but is a major with no migration pack, so Uptide did not upgrade plugin; it stays at 1.0.0.`,
    );
  },
);

it('reports the blocker, without the major, when verification fails with the override', async () => {
  const { root, services } = blocked('npm');
  let runs = 0;
  const result = await fix(
    { cwd: root, only: 'zod', target: '4.6.5', fixer: null },
    {
      ...services,
      // The baseline passes; every run after the upgrade fails.
      tests: async () => [
        { workspace: '.', status: ++runs > 1 ? 'failed' : 'passed', output: 'plugin broke' },
      ],
    },
  );
  expect(result.verification.passed).toBe(false);
  expect(result.companions).toBeUndefined();
  expect(JSON.parse(git(root, 'show', `${result.branch}:package.json`)).dependencies.plugin).toBe(
    '^1.0.0',
  );
  expect(result.peerConflicts).toMatchObject([
    { name: 'plugin', declined: '2.0.0', strategy: 'blocked' },
  ]);
  expect(prBody(result)).toContain(
    '- **Blocker:** plugin 1.0.0 declares zod ^3, which rejects 4.6.5. Tried: a peer override Uptide added to package.json (`overrides.plugin.zod`); verification failed with it. 2.0.0 accepts zod 4.6.5 but is a major with no migration pack, so Uptide did not upgrade plugin: it needs its own migration.',
  );
});
