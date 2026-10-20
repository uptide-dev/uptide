import { describe, expect, it } from 'vitest';
import enki from './__fixtures__/enki-companions.json' with { type: 'json' };
import radix from './__fixtures__/radix-companions.json' with { type: 'json' };
import { companionsOf, compatiblePeerVersion, type InstalledDependency } from './companions.js';
import { compareVersions } from './version.js';

type Versions = Record<
  string,
  { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> }
>;

/** The registry as an AI SDK 6 → 7 upgrade sees it: the packages pin the same provider and provider-utils. */
const registry: Record<string, Versions> = {
  ai: {
    '6.0.116': {
      dependencies: { '@ai-sdk/provider': '3.0.3', '@ai-sdk/provider-utils': '4.0.5' },
    },
    '7.0.9': {
      dependencies: { '@ai-sdk/provider': '4.0.1', '@ai-sdk/provider-utils': '5.0.1' },
    },
  },
  '@ai-sdk/provider': { '3.0.3': {}, '4.0.1': {}, '4.0.2': {} },
  '@ai-sdk/react': {
    '3.0.118': { dependencies: { ai: '6.0.116', '@ai-sdk/provider-utils': '4.0.5' } },
    '4.0.10': { dependencies: { ai: '7.0.9', '@ai-sdk/provider-utils': '5.0.1' } },
    '4.0.11': { dependencies: { ai: '7.0.10', '@ai-sdk/provider-utils': '5.0.2' } },
  },
  '@ai-sdk/openai': {
    '3.0.10': { dependencies: { '@ai-sdk/provider': '3.0.3' } },
    '4.0.5': { dependencies: { '@ai-sdk/provider': '4.0.1' } },
    '4.0.6': { dependencies: { '@ai-sdk/provider': '4.0.2' } },
    '5.0.0-beta.1': { dependencies: { '@ai-sdk/provider': '4.0.1' } },
  },
  zod: { '3.25.76': {}, '4.6.5': {} },
};
const manifests = async (name: string) => registry[name] ?? {};
const at = (name: string, version: string, workspaces = ['.']): InstalledDependency => ({
  name,
  version,
  manifest: { name, version, ...registry[name]?.[version] },
  workspaces,
});
const repository = [
  at('ai', '6.0.116'),
  at('@ai-sdk/provider', '3.0.3'),
  at('@ai-sdk/react', '3.0.118'),
  at('@ai-sdk/openai', '3.0.10'),
  at('zod', '3.25.76'),
];

describe('companionsOf', () => {
  it('moves every installed @ai-sdk package with ai to the versions that agree with it', async () => {
    // Before groups, `fix ai` moved ai alone: ai 7 next to @ai-sdk/react 3 and @ai-sdk/openai 3,
    // two copies of @ai-sdk/provider, and an install no lockfile of the real upgrade has.
    const plan = await companionsOf({
      name: 'ai',
      target: '7.0.9',
      installed: repository,
      manifests,
    });
    expect(plan.conflicts).toEqual([]);
    expect(plan.companions).toEqual([
      {
        name: '@ai-sdk/openai',
        from: '3.0.10',
        to: '4.0.5',
        reason: '@ai-sdk/openai 4.0.5 pins @ai-sdk/provider 4.0.1, as ai 7.0.9 does',
      },
      {
        name: '@ai-sdk/provider',
        from: '3.0.3',
        to: '4.0.1',
        reason: 'ai 7.0.9 pins @ai-sdk/provider 4.0.1 in its dependencies; installed 3.0.3',
      },
      {
        name: '@ai-sdk/react',
        from: '3.0.118',
        to: '4.0.10',
        reason: '@ai-sdk/react 4.0.10 pins ai 7.0.9',
      },
    ]);
  });

  it('leaves a package with no companion installed alone', async () => {
    const plan = await companionsOf({
      name: 'zod',
      target: '4.6.5',
      installed: repository,
      manifests,
    });
    expect(plan).toEqual({ companions: [], conflicts: [], peerConflicts: [] });
  });

  it('reports a member with no release that agrees, instead of moving the package alone', async () => {
    const plan = await companionsOf({
      name: 'ai',
      target: '7.0.9',
      installed: repository,
      manifests: async (name) =>
        name === '@ai-sdk/react'
          ? { '3.0.118': registry['@ai-sdk/react']?.['3.0.118'] ?? {} }
          : manifests(name),
    });
    expect(plan.conflicts).toEqual([
      '@ai-sdk/react 3.0.118 has no release that agrees with ai 7.0.9 (requires ai 6.0.116, @ai-sdk/provider-utils 4.0.5); next: keep ai at 6.0.116 until a compatible @ai-sdk/react release is available',
    ]);
  });

  it('only groups packages installed in a workspace that has the package', async () => {
    const plan = await companionsOf({
      name: 'ai',
      target: '7.0.9',
      installed: [
        at('ai', '6.0.116', ['apps/web']),
        at('@ai-sdk/react', '3.0.118', ['apps/web']),
        at('@ai-sdk/openai', '3.0.10', ['apps/docs']),
      ],
      manifests,
    });
    expect(plan.companions.map((c) => c.name)).toEqual(['@ai-sdk/react']);
  });
});

describe('companionsOf, a member that already agrees', () => {
  it('stays where it is', async () => {
    // @modelcontextprotocol/sdk takes zod `^3.25 || ^4.0`: zod 4 needs nothing else to move.
    const versions: Versions = {
      '1.28.0': {
        dependencies: { zod: '^3.25 || ^4.0' },
        peerDependencies: { zod: '^3.25 || ^4.0' },
      },
      '1.32.1': {
        dependencies: { zod: '^3.25 || ^4.0' },
        peerDependencies: { zod: '^3.25 || ^4.0' },
      },
    };
    const plan = await companionsOf({
      name: 'zod',
      target: '4.6.5',
      installed: [
        at('zod', '3.25.76'),
        {
          name: '@modelcontextprotocol/sdk',
          version: '1.28.0',
          manifest: { name: '@modelcontextprotocol/sdk', version: '1.28.0', ...versions['1.28.0'] },
          workspaces: ['.'],
        },
      ],
      manifests: async (name) =>
        name === '@modelcontextprotocol/sdk' ? versions : manifests(name),
    });
    expect(plan).toEqual({ companions: [], conflicts: [], peerConflicts: [] });
  });
});

describe('companionsOf, react 18 → 19', () => {
  /** The registry as the upgrade sees it: react-dom peer-requires react at its own version, the types track minors. */
  const react: Record<string, Versions> = {
    react: { '18.2.0': {}, '18.3.1': {}, '19.0.0': {}, '19.2.1': {}, '19.3.0': {} },
    'react-dom': {
      '18.2.0': { dependencies: { scheduler: '^0.23.0' }, peerDependencies: { react: '^18.2.0' } },
      '18.3.1': { dependencies: { scheduler: '^0.23.2' }, peerDependencies: { react: '^18.3.1' } },
      '19.0.0': { dependencies: { scheduler: '0.25.0' }, peerDependencies: { react: '^19.0.0' } },
      '19.2.1': { dependencies: { scheduler: '0.27.0' }, peerDependencies: { react: '^19.2.1' } },
      '19.3.0': { dependencies: { scheduler: '0.28.0' }, peerDependencies: { react: '^19.3.0' } },
    },
    '@types/react': {
      '18.2.0': { dependencies: { csstype: '^3.0.2' } },
      '18.3.31': { dependencies: { csstype: '^3.0.2' } },
      '19.0.10': { dependencies: { csstype: '^3.0.2' } },
      '19.0.14': { dependencies: { csstype: '^3.0.2' } },
      '19.2.7': { dependencies: { csstype: '^3.0.2' } },
      '19.3.0': { dependencies: { csstype: '^3.0.2' } },
    },
    '@types/react-dom': {
      '18.2.0': { dependencies: { '@types/react': '*' } },
      '19.0.4': { peerDependencies: { '@types/react': '^19.0.0' } },
      '19.2.3': { peerDependencies: { '@types/react': '^19.0.0' } },
    },
    scheduler: { '0.23.0': {}, '0.25.0': {} },
  };
  const manifests = async (name: string) => react[name] ?? {};
  const installed = (name: string, version: string, workspaces: string[]): InstalledDependency => ({
    name,
    version,
    manifest: { name, version, ...react[name]?.[version] },
    workspaces,
  });

  it('moves react-dom, @types/react and @types/react-dom with react, the types from the root', async () => {
    // excalidraw: the app declares react and react-dom, the root declares the types for everyone.
    const plan = await companionsOf({
      name: 'react',
      target: '19.0.0',
      installed: [
        installed('react', '18.2.0', ['excalidraw-app']),
        installed('react-dom', '18.2.0', ['excalidraw-app']),
        installed('@types/react', '18.2.0', ['.']),
        installed('@types/react-dom', '18.2.0', ['.']),
        installed('scheduler', '0.23.0', ['excalidraw-app']),
      ],
      manifests,
    });
    expect(plan.conflicts).toEqual([]);
    expect(plan.companions).toEqual([
      {
        name: '@types/react',
        from: '18.2.0',
        to: '19.0.14',
        reason: '@types/react 19.0.14 types react 19.0.0',
      },
      {
        name: '@types/react-dom',
        from: '18.2.0',
        to: '19.0.4',
        reason: '@types/react-dom 19.0.4 types react-dom 19.0.0',
      },
      {
        name: 'react-dom',
        from: '18.2.0',
        to: '19.0.0',
        reason: 'react-dom 19.0.0 is released with react 19.0.0 (peer ^19.0.0)',
      },
    ]);
    expect(plan.reason).toBe('peer link, types for react, react-dom');
  });

  it('leaves a release-pair companion whose installed peers already accept the target', async () => {
    const plan = await companionsOf({
      name: 'react',
      target: '19.2.1',
      installed: [
        installed('react', '18.3.1', ['.']),
        {
          ...installed('react-dom', '18.3.1', ['.']),
          manifest: { peerDependencies: { react: '^18.3.1 || ^19.0.0' } },
        },
        installed('@types/react', '18.3.31', ['.']),
      ],
      manifests: async (name) =>
        name === 'react-dom'
          ? {
              ...react['react-dom'],
              '18.3.1': { peerDependencies: { react: '^18.3.1 || ^19.0.0' } },
            }
          : manifests(name),
    });
    expect(plan.companions.map((c) => `${c.name} ${c.to}`)).toEqual(['@types/react 19.2.7']);
  });

  it('leaves a package whose peer range rejects the target in place and reports it as a peer conflict', async () => {
    // next-mdx-remote-client 1.x peers react `>= 18.3.0 < 19.0.0`: the real upgrade kept it at
    // 1.1.2. It is not released with react (no 19.2.1), so nothing moves it, and nothing is
    // compiled at another version of it.
    const mdx = {
      '1.1.2': { peerDependencies: { react: '>= 18.3.0 < 19.0.0' } },
      '2.0.0': { peerDependencies: { react: '>=19.0.0' } },
      '2.1.12': { peerDependencies: { react: '>= 19.1.0' } },
    };
    const plan = await companionsOf({
      name: 'react',
      target: '19.2.1',
      installed: [
        installed('react', '18.3.1', ['apps/docs']),
        {
          ...installed('next-mdx-remote-client', '1.1.2', ['apps/docs']),
          manifest: mdx['1.1.2'],
        },
        {
          ...installed('react-dom', '18.3.1', ['apps/docs']),
          manifest: { peerDependencies: { react: '^18.3.1' } },
        },
      ],
      manifests: async (name) =>
        name === 'next-mdx-remote-client'
          ? mdx
          : name === 'react-dom'
            ? { ...react['react-dom'], '18.3.1': { peerDependencies: { react: '^18.3.1' } } }
            : manifests(name),
    });
    expect(plan.peerConflicts).toEqual([
      'next-mdx-remote-client 1.1.2 declares react >= 18.3.0 < 19.0.0',
    ]);
    // Not an upgrade that cannot agree, and not moved: only the release-group member moves.
    expect(plan.conflicts).toEqual([]);
    expect(plan.companions.map((c) => `${c.name} ${c.to}`)).toEqual(['react-dom 19.2.1']);
  });

  it('reports a peer conflict even when the peer is not grouped with the lead', async () => {
    // typescript-eslint peers on typescript, which `list` groups with nothing: a parser whose
    // range rejects TypeScript 6 stays where it is, and the report says so.
    const parser = { '8.56.0': { peerDependencies: { typescript: '>=4.8.4 <6.0.0' } } };
    const plan = await companionsOf({
      name: 'typescript',
      target: '6.0.3',
      installed: [
        installed('typescript', '5.9.3', ['.']),
        { ...installed('@typescript-eslint/parser', '8.56.0', ['.']), manifest: parser['8.56.0'] },
      ],
      manifests: async (name) =>
        name === '@typescript-eslint/parser' ? parser : { '6.0.3': {}, '5.9.3': {} },
    });
    expect(plan).toEqual({
      companions: [],
      conflicts: [],
      peerConflicts: ['@typescript-eslint/parser 8.56.0 declares typescript >=4.8.4 <6.0.0'],
    });
  });

  it('leaves a named companion whose installed peer range already accepts the target', async () => {
    // No release of it at the target's version, so only the pack's list moves it.
    const wrapper = {
      '2.0.0': { peerDependencies: { react: '^18 || ^19' } },
      '2.1.0': { peerDependencies: { react: '^18 || ^19' } },
    };
    const input = {
      name: 'react',
      target: '19.2.1',
      installed: [
        installed('react', '18.3.1', ['.']),
        { ...installed('react-wrapper', '2.0.0', ['.']), manifest: wrapper['2.0.0'] },
      ],
      manifests: async (name: string) => (name === 'react-wrapper' ? wrapper : manifests(name)),
    };
    const alone = await companionsOf(input);
    expect(alone.companions).toEqual([]);
    expect(alone.peerConflicts).toEqual([]);
    const named = await companionsOf({ ...input, lockstep: ['react-wrapper'] });
    expect(named.companions).toEqual([]);
  });

  it('leaves a types package declared in an unrelated workspace alone', async () => {
    const plan = await companionsOf({
      name: 'react',
      target: '19.0.0',
      installed: [
        installed('react', '18.2.0', ['apps/web']),
        installed('@types/react', '18.2.0', ['apps/docs']),
      ],
      manifests,
    });
    expect(plan).toEqual({ companions: [], conflicts: [], peerConflicts: [] });
  });
});

const radixRegistry: Record<string, Versions> = radix.registry;
const radixInstalled = Object.entries(radix.installed).map(([name, version]) => ({
  name,
  version,
  manifest: radixRegistry[name]?.[version] ?? {},
  workspaces: ['.'],
}));
it.each(['react', '@radix-ui/react-tabs', '@radix-ui/react-tooltip'])(
  '%s keeps all five already-compatible Radix companions at their installed versions',
  async (name) => {
    const plan = await companionsOf({
      name,
      target: name === 'react' ? '19.3.0' : '1.1.0',
      peerTargets: { react: '19.3.0', 'react-dom': '19.3.0' },
      installed: radixInstalled,
      manifests: async (pkg) => radixRegistry[pkg] ?? {},
    });
    expect(plan.conflicts).toEqual([]);
    expect(plan.companions.filter((c) => c.name.startsWith('@radix-ui/'))).toEqual([]);
  },
);

it('never lowers a planned companion across installed versions, registry order, pins and peer ranges', async () => {
  for (const from of ['1.0.0', '1.1.0', '1.2.0', '2.0.0', '3.0.0']) {
    for (const target of ['1.0.0', '1.1.0', '1.2.0', '2.0.0']) {
      for (const pin of [false, true]) {
        for (const reverse of [false, true]) {
          const published = ['1.0.0', '1.1.0', '1.2.0', '2.0.0', '3.0.0'];
          if (reverse) published.reverse();
          const versions = Object.fromEntries(
            published.map((v) => [v, { peerDependencies: { host: `^${v}` } }]),
          );
          const plan = await companionsOf({
            name: 'host',
            target,
            installed: [
              { name: 'host', version: '1.0.0', manifest: {}, workspaces: ['.'] },
              { name: 'plugin', version: from, manifest: versions[from] ?? {}, workspaces: ['.'] },
            ],
            lockstep: ['plugin'],
            manifests: async (name) =>
              name === 'host'
                ? { [target]: pin ? { dependencies: { plugin: target } } : {} }
                : versions,
          });
          for (const c of plan.companions)
            expect(compareVersions(c.to, c.from)).toBeGreaterThanOrEqual(0);
          const peer = compatiblePeerVersion(versions, from, { host: target });
          if (peer) expect(compareVersions(peer, from)).toBeGreaterThanOrEqual(0);
        }
      }
    }
  }
});

/**
 * A scope that mixes the lockstep SDK with packages released on their own, as two public
 * Sentry 10 → 11 upgrades had it: frog-pond/ccc-server (@sentry/node with @sentry/profiling-node
 * and the old @sentry/utils 8) and owine/youth-activity-scheduler (@sentry/react with
 * @sentry/vite-plugin 5). Neither upgrade moved the independent package.
 */
describe('a scope with packages released on their own', () => {
  const sentry: Record<string, Versions> = {
    '@sentry/core': { '8.55.2': {}, '10.75.3': {}, '11.0.0': {}, '11.2.0': {} },
    '@sentry/node': {
      '10.75.3': { dependencies: { '@sentry/core': '10.75.3' } },
      '11.2.0': { dependencies: { '@sentry/core': '11.2.0' } },
    },
    '@sentry/profiling-node': {
      '10.75.3': { dependencies: { '@sentry/core': '10.75.3', '@sentry/node': '10.75.3' } },
      '11.2.0': { dependencies: { '@sentry/core': '11.2.0', '@sentry/node': '11.2.0' } },
    },
    '@sentry/utils': { '8.55.2': { dependencies: { '@sentry/core': '8.55.2' } } },
    '@sentry/react': {
      '10.75.3': { dependencies: { '@sentry/browser': '10.75.3' } },
      '11.0.0': { dependencies: { '@sentry/browser': '11.0.0' } },
    },
    '@sentry/browser': { '10.75.3': {}, '11.0.0': {} },
    '@sentry/replay': { '10.75.3': {}, '11.0.0': {} },
    '@sentry/types': { '10.75.3': {} },
    '@sentry/vite-plugin': {
      '5.4.0': { dependencies: { '@sentry/bundler-plugins': '^10.64.0' } },
      '5.4.1': { dependencies: { '@sentry/bundler-plugins': '^10.76.0' } },
    },
    '@sentry/cli': { '2.58.5': {}, '3.8.0': {} },
  };
  const of = async (name: string) => sentry[name] ?? {};
  const pkg = (name: string, version: string): InstalledDependency => ({
    name,
    version,
    manifest: { name, version, ...sentry[name]?.[version] },
    workspaces: ['.'],
  });
  const ccc = [
    pkg('@sentry/node', '10.75.3'),
    pkg('@sentry/profiling-node', '10.75.3'),
    pkg('@sentry/utils', '8.55.2'),
  ];
  const scheduler = [
    pkg('@sentry/react', '10.75.3'),
    pkg('@sentry/vite-plugin', '5.4.0'),
    pkg('@sentry/cli', '2.58.5'),
  ];

  it.each([
    ['without a pack', undefined],
    ['with a declared release group', ['@sentry/profiling-node', '@sentry/core', '@sentry/react']],
  ])(
    'ccc-server %s: moves profiling-node, leaves @sentry/utils 8 where it is',
    async (_, group) => {
      const plan = await companionsOf({
        name: '@sentry/node',
        target: '11.2.0',
        installed: ccc,
        manifests: of,
        ...(group ? { releaseGroup: group } : {}),
      });
      expect(plan.conflicts).toEqual([]);
      expect(plan.companions.map((c) => `${c.name} ${c.to}`)).toEqual([
        '@sentry/profiling-node 11.2.0',
      ]);
      expect(plan.stays).toEqual([expect.stringMatching(/^@sentry\/utils stays at 8\.55\.2 \(/)]);
    },
  );

  it.each([
    ['without a pack', undefined],
    ['with a declared release group', ['@sentry/browser', '@sentry/core']],
  ])('youth-activity-scheduler %s: vite-plugin and cli stay, nothing blocks', async (_, group) => {
    const plan = await companionsOf({
      name: '@sentry/react',
      target: '11.0.0',
      installed: scheduler,
      manifests: of,
      ...(group ? { releaseGroup: group } : {}),
    });
    expect(plan.conflicts).toEqual([]);
    expect(plan.companions).toEqual([]);
    expect(plan.stays).toEqual([
      expect.stringMatching(/^@sentry\/cli stays at 2\.58\.5 \(/),
      expect.stringMatching(/^@sentry\/vite-plugin stays at 5\.4\.0 \(/),
    ]);
  });

  it('without a pack, leaves unrelated same-scope packages even with matching release versions', async () => {
    const plan = await companionsOf({
      name: '@sentry/react',
      target: '11.0.0',
      installed: [pkg('@sentry/react', '10.75.3'), pkg('@sentry/replay', '10.75.3')],
      manifests: of,
    });
    expect(plan.companions).toEqual([]);
  });

  it('a same-version package with no release at the target stays rather than failing the plan', async () => {
    const plan = await companionsOf({
      name: '@sentry/react',
      target: '11.0.0',
      installed: [pkg('@sentry/react', '10.75.3'), pkg('@sentry/types', '10.75.3')],
      manifests: of,
    });
    expect(plan.conflicts).toEqual([]);
    expect(plan.stays).toEqual([
      '@sentry/types stays at 10.75.3 (versioned on its own, apart from @sentry/react)',
    ]);
  });

  it('a declared member with no agreeing release is still a conflict', async () => {
    const plan = await companionsOf({
      name: '@sentry/react',
      target: '11.0.0',
      installed: [pkg('@sentry/react', '10.75.3'), pkg('@sentry/types', '10.75.3')],
      manifests: of,
      releaseGroup: ['@sentry/types'],
    });
    expect(plan.conflicts).toEqual([
      '@sentry/types 10.75.3 has no release that agrees with @sentry/react 11.0.0 (declared release group requires @sentry/types 11.0.0); next: keep @sentry/react at 10.75.3 until a compatible @sentry/types release is available',
    ]);
  });
});

it('names only packages of the lead’s own scope as staying', async () => {
  const plan = await companionsOf({
    name: '@sentry/react',
    target: '11.0.0',
    installed: [
      { name: '@sentry/react', version: '10.75.3', manifest: {}, workspaces: ['.'] },
      { name: '@sentry/cli', version: '2.58.5', manifest: {}, workspaces: ['.'] },
      {
        name: '@tanstack/router-vite-plugin',
        version: '1.167.42',
        manifest: {},
        workspaces: ['.'],
      },
    ],
    manifests: async (name): Promise<Record<string, object>> =>
      name === '@sentry/react' ? { '11.0.0': {} } : {},
    releaseGroup: ['@sentry/browser'],
  });
  expect(plan.stays).toEqual([
    '@sentry/cli stays at 2.58.5 (not in the release group of @sentry/react)',
  ]);
});

// Modeled on enki: tokens and toggle share a publisher, not a dependency edge.
it.each([false, true])(
  'enki react 18 → 19 does not pull unrelated scope packages (reverse: %s)',
  async (reverse) => {
    const installed = enki.installed.map(({ name, version }) => ({
      name,
      version,
      workspaces: ['.'],
      manifest: (enki.registry as Record<string, Versions>)[name]?.[version] ?? {},
    }));
    const lookedUp: string[] = [];
    const plan = await companionsOf({
      name: 'react',
      target: '19.0.0',
      installed: reverse ? installed.reverse() : installed,
      manifests: async (name) => {
        lookedUp.push(name);
        return (enki.registry as Record<string, Versions>)[name] ?? {};
      },
    });
    expect(plan.conflicts).toEqual([]);
    expect(plan.peerConflicts).toEqual([]);
    expect(plan.blockers ?? []).toEqual([]);
    expect(plan.companions.map((c) => c.name)).toEqual([
      '@entur/react-component-toggle',
      'react-dom',
    ]);
    expect(lookedUp).not.toContain('@entur/tokens');
  },
);

it('names the target pin when an otherwise empty companion has no matching release', async () => {
  const plan = await companionsOf({
    name: '@example/lead',
    target: '2.0.0',
    installed: [
      {
        name: '@example/lead',
        version: '1.0.0',
        manifest: { dependencies: { '@example/helper': '1.0.0' } },
        workspaces: ['.'],
      },
      { name: '@example/helper', version: '1.0.0', manifest: {}, workspaces: ['.'] },
    ],
    manifests: async (name): Promise<Versions> =>
      name === '@example/lead'
        ? { '2.0.0': { dependencies: { '@example/helper': '2.0.0' } } }
        : { '1.0.0': {} },
  });
  expect(plan.conflicts).toEqual([
    '@example/helper 1.0.0 has no release that agrees with @example/lead 2.0.0 (@example/lead 2.0.0 requires @example/helper 2.0.0); next: keep @example/lead at 1.0.0 until a compatible @example/helper release is available',
  ]);
});

it('leaves a member where it is when the target accepts it, though the member says nothing about the lead (UPT-10)', async () => {
  const casl: Record<string, Versions> = {
    '@casl/react': {
      '4.0.0': { peerDependencies: { '@casl/ability': '^3.0.0 || ^4.0.0 || ^5.1.0 || ^6.0.0' } },
      '5.0.0': { peerDependencies: { '@casl/ability': '^4.0.0 || ^5.1.0 || ^6.0.0' } },
    },
    '@casl/ability': { '6.8.0': { dependencies: { '@ucast/mongo2js': '^1.3.0' } } },
  };
  const installed = (name: string, version: string): InstalledDependency => ({
    name,
    version,
    manifest: { name, version, ...casl[name]?.[version] },
    workspaces: ['.'],
  });
  const plan = await companionsOf({
    name: '@casl/react',
    target: '5.0.0',
    installed: [installed('@casl/react', '4.0.0'), installed('@casl/ability', '6.8.0')],
    manifests: async (name) => casl[name] ?? {},
  });
  expect(plan.conflicts).toEqual([]);
  expect(plan.companions).toEqual([]);
});

describe('pins of members that do not move (UPT-126)', () => {
  // guardian/support-dotcom-components at 4a256bf: @guardian/libs 33.0.0 lists ophan-tracker-js
  // both as a dependency (3.1.0) and as a peer (^2.2.10), and the lockfile resolves the peer, 2.8.3.
  const libs33 = {
    dependencies: { '@guardian/ophan-tracker-js': '3.1.0' },
    peerDependencies: {
      '@guardian/ophan-tracker-js': '^2.2.10',
      tslib: '^2.8.1',
      typescript: '~6.0.3',
    },
  };
  const guardian: Record<string, Versions> = {
    typescript: { '5.9.3': {}, '6.0.3': {} },
    '@guardian/libs': {
      '32.0.0': { dependencies: { '@guardian/ophan-tracker-js': '2.8.3' } },
      '33.0.0': libs33,
    },
    '@guardian/ophan-tracker-js': { '2.8.0': {}, '2.8.3': {}, '3.1.0': {} },
  };
  const installed = (name: string, version: string, workspaces = ['.']): InstalledDependency => ({
    name,
    version,
    manifest: { name, version, ...guardian[name]?.[version] },
    workspaces,
  });

  it('moves nothing through a member that stays at its installed version (guardian, typescript 6)', async () => {
    const plan = await companionsOf({
      name: 'typescript',
      target: '6.0.3',
      installed: [
        installed('typescript', '5.9.3', ['.', 'cdk']),
        installed('@guardian/libs', '33.0.0'),
        installed('@guardian/ophan-tracker-js', '2.8.3'),
      ],
      manifests: async (name) => guardian[name] ?? {},
    });
    expect(plan.companions).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it('moves nothing through the exact pin of a member that stays, peer or not', async () => {
    // The pin alone, as npm sees it: libs keeps its own nested ophan-tracker-js 3.1.0 today.
    const pinOnly: Record<string, Versions> = {
      ...guardian,
      '@guardian/libs': { '33.0.0': { ...libs33, peerDependencies: { typescript: '~6.0.3' } } },
    };
    const plan = await companionsOf({
      name: 'typescript',
      target: '6.0.3',
      installed: [
        installed('typescript', '5.9.3'),
        {
          ...installed('@guardian/libs', '33.0.0'),
          manifest: {
            name: '@guardian/libs',
            version: '33.0.0',
            ...pinOnly['@guardian/libs']?.['33.0.0'],
          },
        },
        installed('@guardian/ophan-tracker-js', '2.8.3'),
      ],
      manifests: async (name) => pinOnly[name] ?? {},
    });
    expect(plan.companions).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it('leaves a pin alone when the moving package also peers on it and the install satisfies the peer', async () => {
    const plan = await companionsOf({
      name: '@guardian/libs',
      target: '33.0.0',
      installed: [
        installed('@guardian/libs', '32.0.0'),
        installed('@guardian/ophan-tracker-js', '2.8.3'),
      ],
      manifests: async (name) => guardian[name] ?? {},
    });
    expect(plan.companions).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it('names the declaring package, its manifest field and the installed version in a pin reason', async () => {
    const plan = await companionsOf({
      name: 'ai',
      target: '7.0.9',
      installed: repository,
      manifests,
    });
    expect(plan.companions.find((c) => c.name === '@ai-sdk/provider')?.reason).toBe(
      'ai 7.0.9 pins @ai-sdk/provider 4.0.1 in its dependencies; installed 3.0.3',
    );
  });
});
