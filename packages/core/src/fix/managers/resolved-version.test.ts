import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as process from '../process.js';
import { pinClassicPatterns, upgradeInstall } from './upgrade.js';

// UPT-124: asked for one version, the package manager resolved another. Same major and inside
// the manifest range: the run goes on and reports both. Anything else stops it, naming why.
const managers = {
  npm: {
    file: 'package-lock.json',
    pin: undefined,
    lock: (spec: string, version: string) =>
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { dependencies: { target: spec } },
          'node_modules/target': { version },
        },
      }),
  },
  pnpm: {
    file: 'pnpm-lock.yaml',
    pin: 'pnpm@9.15.0',
    lock: (spec: string, version: string) => `lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      target:
        specifier: '${spec}'
        version: ${version}
packages:
  target@${version}:
    resolution: {integrity: sha512-target-${version}}
snapshots:
  target@${version}: {}
`,
  },
  'yarn-classic': {
    file: 'yarn.lock',
    pin: undefined,
    lock: (spec: string, version: string) => `# yarn lockfile v1


target@${spec}:
  version "${version}"
  resolved "https://registry.yarnpkg.com/target/-/target-${version}.tgz"
`,
  },
};
let root = '';
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

/** The plan asked for 1.1.0 under `spec`; every non-frozen install resolves `resolves`. */
function upgrade(kind: keyof typeof managers, spec: string, resolves: string) {
  const m = managers[kind];
  root = mkdtempSync(join(tmpdir(), 'uptide-resolved-'));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ ...(m.pin ? { packageManager: m.pin } : {}), dependencies: { target: spec } }),
  );
  writeFileSync(join(root, m.file), m.lock(spec, '1.0.0'));
  vi.spyOn(process, 'command').mockImplementation(async (_root, _bin, args) => {
    if (args.includes('--version'))
      return {
        code: 0,
        output: { npm: '11.0.0', pnpm: '9.15.0', 'yarn-classic': '1.22.22' }[kind],
        timeout: false,
      };
    if (!args.some((a) => ['ci', '--frozen-lockfile'].includes(a)))
      writeFileSync(join(root, m.file), m.lock(spec, resolves));
    return { code: 0, output: '', timeout: false };
  });
  return upgradeInstall(root, { name: 'target', version: '1.1.0', files: [], workspaces: ['.'] });
}

describe.each(Object.keys(managers) as (keyof typeof managers)[])('%s', (kind) => {
  it('keeps the exact target without a resolved note', async () => {
    const report = await upgrade(kind, '^1.0.0', '1.1.0');
    expect(report.resolved).toBeUndefined();
  });

  it('continues on a newer patch in the same major and the manifest range, and reports it', async () => {
    const report = await upgrade(kind, '^1.0.0', '1.1.3');
    expect(report.resolved).toEqual([{ name: 'target', requested: '1.1.0', version: '1.1.3' }]);
  });

  it('stops on a different major, naming target, resolved and why', async () => {
    await expect(upgrade(kind, '>=1.0.0', '2.0.0')).rejects.toThrow(
      'Requested target@1.1.0, but . resolved 2.0.0: a different major than 1.1.0',
    );
  });

  it('stops on a version outside the manifest range', async () => {
    await expect(upgrade(kind, '~1.1.0', '1.2.0')).rejects.toThrow(
      'Requested target@1.1.0, but . resolved 1.2.0: outside the manifest range ~1.1.0',
    );
  });
});

it('moves a Yarn classic range onto the entry at the target and drops the newer one', () => {
  const lock = `# yarn lockfile v1


"@scope/other@^1.0.0":
  version "1.0.0"

ai@7.0.105:
  version "7.0.105"
  resolved "https://registry.yarnpkg.com/ai/-/ai-7.0.105.tgz"

ai@^7.0.105:
  version "7.0.146"
  resolved "https://registry.yarnpkg.com/ai/-/ai-7.0.146.tgz"
  dependencies:
    "@ai-sdk/gateway" "4.0.1"

zod@^4.0.0:
  version "4.0.0"
`;
  expect(
    pinClassicPatterns(lock, [{ pattern: 'ai@^7.0.105', name: 'ai', version: '7.0.105' }]),
  ).toBe(`# yarn lockfile v1


"@scope/other@^1.0.0":
  version "1.0.0"

ai@7.0.105, ai@^7.0.105:
  version "7.0.105"
  resolved "https://registry.yarnpkg.com/ai/-/ai-7.0.105.tgz"

zod@^4.0.0:
  version "4.0.0"
`);
  // A shared header keeps its other patterns; no entry at the target leaves the lockfile alone.
  const shared = 'x@1.0.0:\n  version "1.0.0"\n\n"x@^1.0.0", x@^1.0.1:\n  version "1.0.5"\n';
  expect(pinClassicPatterns(shared, [{ pattern: 'x@^1.0.0', name: 'x', version: '1.0.0' }])).toBe(
    'x@1.0.0, "x@^1.0.0":\n  version "1.0.0"\n\nx@^1.0.1:\n  version "1.0.5"\n',
  );
  expect(pinClassicPatterns(shared, [{ pattern: 'x@^1.0.0', name: 'x', version: '1.0.9' }])).toBe(
    shared,
  );
});
