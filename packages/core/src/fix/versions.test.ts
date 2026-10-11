import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it, vi } from 'vitest';
import { isolatedFix } from './isolate.js';
import { git } from './process.js';
import { rangePreflight } from './range-preflight.js';
import { fix } from './run.js';
import { zodFixture } from './test-fixture.js';
import {
  assertInstalledVersions,
  bumpCatalog,
  bumpVersions,
  validateVersionRanges,
  versionRange,
} from './versions.js';

const scratch = mkdtempSync(join(tmpdir(), 'uptide-ranges-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

it.each([
  ['^18', '^19'],
  ['18', '19'],
  ['18.x', '19.x'],
  ['^18.x', '^19.x'],
  ['~18', '~19'],
  ['~18.2', '~19.3'],
  ['18.2.x', '19.3.x'],
  ['^18.2', '^19.3'],
  ['18.2', '19.3'],
  ['18.X', '19.X'],
  ['18.*', '19.*'],
  ['18.x.x', '19.x.x'],
  ['18.2.0', '19.3.4'],
  ['^18.2.0', '^19.3.4'],
  ['~18.2.0', '~19.3.4'],
  ['^18.2.0-beta.1+build', '^19.3.4'],
  ['v18', 'v19'],
  ['^ 18.2', '^ 19.3'],
  ['npm:react@^18', 'npm:react@^19'],
  ['npm:@scope/react@~18.2', 'npm:@scope/react@~19.3'],
])('rewrites %s as %s', (before, expected) => {
  expect(versionRange(before, '19.3.4')).toBe(expected);
});

const unsupported = [
  '>=18 <20',
  '18 || 19',
  '18 - 19',
  '*',
  'latest',
  'workspace:^18',
  'workspace:*',
  'npm:react@>=18 <20',
  'npm:react@18 || 19',
  'npm:react@*',
  'npm:react@latest',
  'npm:react',
  'file:../react',
  'link:../react',
  '18.x.2',
  '18.2.0.1',
  '18-beta',
  '18.2.x-beta',
  'npm:@scope/react@18 || 19',
];
it.each(unsupported)('rejects unsupported %s', (before) => {
  expect(() => versionRange(before, '19.3.4')).toThrow(/Cannot preserve version range/);
});

it('keeps the target prerelease for full precision and changes the requested minor only', () => {
  expect(versionRange('^18.2.0', '19.2.0-rc.1')).toBe('^19.2.0-rc.1');
  expect(versionRange('~18.2', '19.2.5')).toBe('~19.2');
});

function reactFixture() {
  const root = mkdtempSync(join(scratch, 'react-'));
  cpSync(
    fileURLToPath(new URL('__fixtures__/react-partial/package.json', import.meta.url)),
    join(root, 'package.json'),
  );
  const put = (file: string, text: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  for (const name of ['react', 'react-dom', '@types/react', '@types/react-dom']) {
    put(
      `node_modules/${name}/package.json`,
      JSON.stringify({
        name,
        version: '18.3.1',
        ...(name === 'react-dom' ? { peerDependencies: { react: '^18.3.1' } } : {}),
      }),
    );
  }
  put('.gitignore', 'node_modules\n');
  put('package-lock.json', '{"lockfileVersion":3,"packages":{}}');
  git(root, 'init');
  git(root, 'config', 'user.email', 'test@example.test');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'fixture');
  return { root, put };
}

it('bumps react, react-dom and both types companions with their own precision', () => {
  const { root } = reactFixture();
  for (const name of ['react', 'react-dom', '@types/react', '@types/react-dom'])
    bumpVersions(root, name, '19.3.4');
  expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))).toMatchObject({
    dependencies: { react: '^19', 'react-dom': '^19' },
    devDependencies: { '@types/react': '~19.3', '@types/react-dom': '19.3.x' },
  });
});

it('bumps workspace declarations and default/named catalogs without replacing references', () => {
  const { root, put } = reactFixture();
  put(
    'pnpm-workspace.yaml',
    'packages: [packages/*]\ncatalog:\n  react: "^18" # keep\ncatalogs:\n  legacy:\n    react-dom: ~18.2\n',
  );
  put(
    'packages/a/package.json',
    JSON.stringify({ dependencies: { react: 'catalog:', 'react-dom': 'catalog:legacy' } }),
  );
  put(
    'packages/b/package.json',
    JSON.stringify({ peerDependencies: { react: '18.x', 'react-dom': '^18.2' } }),
  );
  for (const name of ['react', 'react-dom']) bumpVersions(root, name, '19.3.4');
  expect(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')).toContain('react: "^19" # keep');
  expect(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')).toContain('react-dom: ~19.3');
  expect(
    JSON.parse(readFileSync(join(root, 'packages/a/package.json'), 'utf8')).dependencies,
  ).toEqual({ react: 'catalog:', 'react-dom': 'catalog:legacy' });
  expect(
    JSON.parse(readFileSync(join(root, 'packages/b/package.json'), 'utf8')).peerDependencies,
  ).toEqual({ react: '18.x || ^19.0.0', 'react-dom': '^18.2 || ^19.0.0' });
});

it.each(['>=2 <4', 'workspace:*', 'npm:zod@2 || 3'])(
  'refuses %s before cloning, checking, branching or spending, including --pr',
  async (range) => {
    const { root, services } = zodFixture(scratch);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { zod: range } }));
    git(root, 'commit', '-am', 'unsupported range');
    const branches = git(root, 'branch');
    const runs = join(scratch, 'runs');
    vi.stubEnv('UPTIDE_RUNS_DIR', runs);
    const before = existsSync(runs) ? readdirSync(runs) : [];
    const check = vi.fn(services.check),
      install = vi.fn(services.install),
      spend = vi.fn();
    try {
      await expect(
        isolatedFix(
          {
            cwd: root,
            only: 'zod',
            pr: true,
            yes: true,
            fixer: { id: 'test', fix: spend },
            tool: { uptideDirty: false, uptideCommit: 'a'.repeat(40), uptideVersion: '0.6.1' },
          },
          { ...services, check, install },
        ),
      ).rejects.toMatchObject({
        code: 'UNSUPPORTED_VERSION_RANGE',
        message: expect.stringContaining(
          `package.json: dependencies.zod declares ${JSON.stringify(range)}`,
        ),
      });
      expect(check).not.toHaveBeenCalled();
      expect(install).not.toHaveBeenCalled();
      expect(spend).not.toHaveBeenCalled();
      expect(git(root, 'branch')).toBe(branches);
      expect(existsSync(runs) ? readdirSync(runs) : []).toEqual(before);
    } finally {
      vi.unstubAllEnvs();
    }
  },
);

it('names the file, field, range and widening instruction before any workspace writes', () => {
  const { root, put } = reactFixture();
  put('pnpm-workspace.yaml', 'packages: [packages/*]\n');
  put('packages/app/package.json', '{"dependencies":{"react":"^17 || ^18 <18.3"}}');
  const before = readFileSync(join(root, 'package.json'), 'utf8');
  expect(() => bumpVersions(root, 'react', '19.3.4')).toThrow(
    'Add the target react major (^19.0.0) to the range in packages/app/package.json (dependencies.react), keeping all existing alternatives, then rerun.',
  );
  expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(before);
});

it('gives widening instructions for unsupported catalog entries and aliases', () => {
  expect(() =>
    bumpCatalog('catalog:\n  react: "^17 || ^18 <18.3"\n', 'react', '19.3.4', ''),
  ).toThrow('pnpm-workspace.yaml (catalog.react), keeping all existing alternatives');
  const { root, put } = reactFixture();
  put('package.json', '{"dependencies":{"react":"npm:react@17 || 18"}}');
  expect(() => validateVersionRanges(root, [{ name: 'react', to: '19.3.4' }])).toThrow(
    'Add the target react major (^19.0.0)',
  );
});

it('validates the committed manifest, not an uncommitted repair, before cloning', async () => {
  const { root, services } = zodFixture(scratch);
  writeFileSync(join(root, 'package.json'), '{"dependencies":{"zod":">=2 <4"}}');
  git(root, 'commit', '-am', 'complex');
  writeFileSync(join(root, 'package.json'), '{"dependencies":{"zod":"^3"}}');
  await expect(isolatedFix({ cwd: root, only: 'zod' }, services)).rejects.toThrow(
    'dependencies.zod declares ">=2 <4"',
  );
});

it('finds unsupported lockstep and types companions before cloning, but allows unrelated complex ranges', async () => {
  const registry = async (name: string) => ({
    '18.3.1': name === 'react-dom' ? { peerDependencies: { react: '^18.3.1' } } : {},
    '19.3.4': name === 'react-dom' ? { peerDependencies: { react: '^19.3.4' } } : {},
  });
  for (const name of ['react-dom', '@types/react', '@types/react-dom']) {
    const { root, put } = reactFixture();
    const json = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    (name.startsWith('@') ? json.devDependencies : json.dependencies)[name] = '^17 || ^18 <18.3';
    put('package.json', JSON.stringify(json));
    git(root, 'commit', '-am', 'complex companion');
    const services = { ...zodFixture(scratch).services, manifests: registry };
    services.check = vi.fn(services.check);
    await expect(
      isolatedFix({ cwd: root, only: 'react', target: '19.3.4', fixer: null }, services),
    ).rejects.toThrow(`${name} declares "^17 || ^18 <18.3"`);
    expect(services.check).not.toHaveBeenCalled();
  }
  const { root, put } = reactFixture();
  const json = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  json.dependencies.unrelated = '*';
  put('package.json', JSON.stringify(json));
  await expect(
    rangePreflight(
      { cwd: root, only: 'react', target: '19.3.4' },
      { ...zodFixture(scratch).services, manifests: registry },
    ),
  ).resolves.toBe('19.3.4');
});

it('direct fix rejects complex ranges before the check and branch too', async () => {
  const { root, services } = zodFixture(scratch);
  writeFileSync(join(root, 'package.json'), '{"dependencies":{"zod":"latest"}}');
  git(root, 'commit', '-am', 'complex');
  const check = vi.fn(services.check);
  await expect(fix({ cwd: root, only: 'zod' }, { ...services, check })).rejects.toMatchObject({
    code: 'UNSUPPORTED_VERSION_RANGE',
  });
  expect(check).not.toHaveBeenCalled();
});

it('rejects a complex named catalog before cloning, with the catalog field and target major', async () => {
  const { root, services } = zodFixture(scratch);
  writeFileSync(join(root, 'package.json'), '{"dependencies":{"zod":"catalog:shared"}}');
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'catalogs:\n  shared:\n    zod: ">=2 <4"\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'catalog');
  const check = vi.fn(services.check);
  await expect(isolatedFix({ cwd: root, only: 'zod' }, { ...services, check })).rejects.toThrow(
    'pnpm-workspace.yaml (catalogs.shared.zod), keeping all existing alternatives, then rerun.',
  );
  expect(check).not.toHaveBeenCalled();
});

it('reads each committed manifest once during range planning', async () => {
  const { root } = reactFixture();
  const read = vi.fn((file: string) => readFileSync(join(root, file), 'utf8'));
  await rangePreflight(
    { cwd: root, only: 'react', target: '19.3.4' },
    { ...zodFixture(scratch).services, manifests: async () => ({}) },
    read,
  );
  expect(read.mock.calls).toEqual([['package.json']]);
});

it('does not resolve npm workspace links declared as * against the registry', async () => {
  const { root, put } = reactFixture();
  const json = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  json.workspaces = ['packages/*'];
  json.dependencies['@fixture/shared'] = '*';
  put('package.json', JSON.stringify(json));
  put(
    'packages/shared/package.json',
    JSON.stringify({ name: '@fixture/shared', version: '1.0.0', dependencies: { react: '^18' } }),
  );
  mkdirSync(join(root, 'node_modules/@fixture'), { recursive: true });
  symlinkSync(join(root, 'packages/shared'), join(root, 'node_modules/@fixture/shared'), 'dir');
  const manifests = vi.fn(async (name: string) => {
    if (name === '@fixture/shared') throw new Error('workspace packages have no registry entry');
    return {};
  });
  await expect(
    rangePreflight(
      { cwd: root, only: 'react', target: '19.3.4' },
      { ...zodFixture(scratch).services, manifests },
    ),
  ).resolves.toBe('19.3.4');
  expect(manifests).not.toHaveBeenCalledWith('@fixture/shared');
});

it('updates the monorepo and companions while preserving compatible manifests byte for byte', () => {
  const root = mkdtempSync(join(scratch, 'workspaces-'));
  cpSync(fileURLToPath(new URL('__fixtures__/react-workspace-ranges', import.meta.url)), root, {
    recursive: true,
  });
  const manifest = (workspace: string) =>
    readFileSync(join(root, 'packages', workspace, 'package.json'), 'utf8');
  const union = manifest('union'),
    open = manifest('open');
  for (const [name, target] of [
    ['react', '19.3.0'],
    ['react-dom', '19.3.0'],
    ['@types/react', '19.2.7'],
    ['@types/react-dom', '19.2.3'],
  ] as const) {
    const result = bumpVersions(root, name, target);
    expect(result.alreadyCompatible).toEqual([
      `packages/open (peerDependencies.${name})`,
      `packages/union (peerDependencies.${name})`,
    ]);
    expect(JSON.parse(manifest('exact')).dependencies[name]).toBe(target);
    expect(JSON.parse(manifest('caret')).devDependencies[name]).toBe(`^${target}`);
    expect(JSON.parse(manifest('complex')).peerDependencies[name]).toBe(
      '^17 || ^18 <18.3 || ^19.0.0',
    );
  }
  expect(manifest('union')).toBe(union);
  expect(manifest('open')).toBe(open);
});

it.each(['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'])(
  'leaves compatible %s ranges and aliases untouched',
  (section) => {
    const { root, put } = reactFixture();
    for (const range of [
      '19.3.0',
      '^19.0.0',
      '*',
      '^18.3.1 || ^19.0.0',
      '>=16.8',
      'npm:react@^18 || ^19',
    ]) {
      const original = JSON.stringify({ [section]: { react: range } });
      put('package.json', original);
      const result = bumpVersions(root, 'react', '19.3.0');
      expect(result.files).toEqual([]);
      expect(result.alreadyCompatible).toEqual([`. (${section}.react)`]);
      expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(original);
    }
  },
);

it('excludes prereleases from broad compatibility and preserves old peer alternatives', () => {
  const { root, put } = reactFixture();
  put(
    'package.json',
    JSON.stringify({ dependencies: { react: '^19.0.0' }, peerDependencies: { react: '>=16.8' } }),
  );
  const result = bumpVersions(root, 'react', '19.3.0-rc.1');
  expect(result.alreadyCompatible).toEqual([]);
  expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))).toEqual({
    dependencies: { react: '^19.3.0-rc.1' },
    peerDependencies: { react: '>=16.8 || ^19.3.0-rc.1' },
  });
});

it('leaves compatible catalogs byte for byte unchanged', () => {
  const yaml = 'catalog:\n  react: "^18 || ^19" # preserve\n';
  expect(bumpCatalog(yaml, 'react', '19.3.0', '')).toBe(yaml);
});

it('records already compatible declarations in the fix report', async () => {
  const { root, services } = zodFixture(scratch);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'consumer', type: 'module', dependencies: { zod: '^3 || ^4' } }),
  );
  git(root, 'commit', '-am', 'compatible range');
  const report = await fix({ cwd: root, only: 'zod', target: '4.6.5', fixer: null }, services);
  expect(report.notes).toContain('. (dependencies.zod): already compatible; range left unchanged.');
  expect(readFileSync(report.prBody, 'utf8')).toContain('already compatible');
});

it('preflights compatible complex companion ranges against each companion target', async () => {
  const { root, put } = reactFixture();
  put(
    'package.json',
    JSON.stringify({
      dependencies: { react: '18.2.0', 'react-dom': '^18 || ^19' },
      devDependencies: { '@types/react': '^18 || >=19.2.0 <19.3.0', '@types/react-dom': '>=16.8' },
    }),
  );
  const manifests = async (name: string) => ({
    [name.startsWith('@types/') ? '19.2.3' : '19.3.0']:
      name === 'react-dom' ? { peerDependencies: { react: '^19.3.0' } } : {},
  });
  await expect(
    rangePreflight(
      { cwd: root, only: 'react', target: '19.3.0' },
      { ...zodFixture(scratch).services, manifests },
    ),
  ).resolves.toBe('19.3.0');
});

it('widens a catalog shared by peer and dependency declarations', () => {
  const { root, put } = reactFixture();
  put('pnpm-workspace.yaml', 'packages: [packages/*]\ncatalog:\n  react: "^18.2.0" # keep\n');
  put('packages/app/package.json', JSON.stringify({ dependencies: { react: 'catalog:' } }));
  put('packages/lib/package.json', JSON.stringify({ peerDependencies: { react: 'catalog:' } }));
  bumpVersions(root, 'react', '19.3.0');
  expect(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')).toContain(
    'react: "^18.2.0 || ^19.0.0" # keep',
  );
});

it.each(['react', 'react-dom', '@types/react', '@types/react-dom'])(
  'refuses verification when %s is stale or missing despite compatible declarations',
  (name) => {
    const { root, put } = reactFixture();
    const moves = ['react', 'react-dom', '@types/react', '@types/react-dom'].map((name) => ({
      name,
      to: '19.2.0',
    }));
    for (const move of moves)
      put(
        `node_modules/${move.name}/package.json`,
        JSON.stringify({ name: move.name, version: move.to }),
      );
    put('pnpm-workspace.yaml', 'packages: [packages/*]\n');
    put('packages/app/package.json', JSON.stringify({ dependencies: { [name]: '>=16.8' } }));
    expect(() => assertInstalledVersions(root, moves)).not.toThrow();
    // This local copy shadows the correct hoisted version.
    put(
      `packages/app/node_modules/${name}/package.json`,
      JSON.stringify({ name, version: '19.1.0' }),
    );
    expect(() => assertInstalledVersions(root, moves)).toThrow(
      `Requested ${name}@19.2.0, but packages/app has 19.1.0 installed`,
    );
    rmSync(join(root, 'packages/app/node_modules', name), { recursive: true });
    rmSync(join(root, 'node_modules', name), { recursive: true });
    expect(() => assertInstalledVersions(root, moves)).toThrow(
      `Requested ${name}@19.2.0, but . has nothing installed`,
    );
  },
);

it('refuses verification if a planned companion is no longer declared', () => {
  const { root } = reactFixture();
  expect(() =>
    assertInstalledVersions(root, [{ name: 'missing-companion', to: '19.2.0' }]),
  ).toThrow('Cannot verify planned packages no workspace declares: missing-companion.');
});
