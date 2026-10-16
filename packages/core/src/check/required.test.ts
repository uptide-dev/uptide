import { describe, expect, it } from 'vitest';
import { companionsOf, type InstalledDependency } from './companions.js';

type Versions = Record<
  string,
  {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  }
>;

// openai as its 4.x and 7.x releases declare zod: an optional peer, `^3.25 || ^4.0` from 7.
const openai: Versions = {
  '4.83.0': {
    peerDependencies: { zod: '^3.23.8' },
    peerDependenciesMeta: { zod: { optional: true } },
  },
  '4.104.0': {
    peerDependencies: { zod: '^3.23.8' },
    peerDependenciesMeta: { zod: { optional: true } },
  },
  '7.4.0': {
    peerDependencies: { zod: '^3.25 || ^4.0' },
    peerDependenciesMeta: { zod: { optional: true } },
  },
  '7.9.0': {
    peerDependencies: { zod: '^3.25 || ^4.0' },
    peerDependenciesMeta: { zod: { optional: true } },
  },
};
const zod: Versions = {
  '3.24.1': {},
  '3.24.2': {},
  '3.25.0-canary.20250504T221648': {},
  '3.25.0': {},
  '3.25.40': {},
  '3.25.76': {},
  '4.0.0': {},
  '4.4.3': {},
  '4.5.4': {},
};
// @openai/agents is on its own 0.x line; 0.15 is its first release on openai 7, and needs zod 4.
const agents: Versions = {
  '0.1.11': { dependencies: { openai: '^5.20.2' }, peerDependencies: { zod: '^3.25.40' } },
  '0.14.3': { dependencies: { openai: '^6.46.0' }, peerDependencies: { zod: '^4.0.0' } },
  '0.15.0': { dependencies: { openai: '^7.2.0' }, peerDependencies: { zod: '^4.0.0' } },
  '0.17.2': { dependencies: { openai: '^7.2.0' }, peerDependencies: { zod: '^4.0.0' } },
};

const registryOf =
  (registry: Record<string, Versions>) =>
  async (name: string): Promise<Versions> =>
    registry[name] ?? {};
const at = (
  registry: Record<string, Versions>,
  name: string,
  version: string,
  workspaces = ['.'],
): InstalledDependency => ({
  name,
  version,
  manifest: { name, version, ...registry[name]?.[version] },
  workspaces,
});

const batchAi = { openai, zod };
const guardrails = { openai, zod, '@openai/agents': agents };

describe('what the target requires', () => {
  it('moves a peer the target requires to the lowest release of its major that satisfies it (batch-ai)', async () => {
    // grantsingleton/batch-ai: openai 4.83.0 → 7.4.0 with zod 3.24.2, below openai 7's zod peer.
    const plan = await companionsOf({
      name: 'openai',
      target: '7.4.0',
      installed: [at(batchAi, 'openai', '4.83.0'), at(batchAi, 'zod', '3.24.2')],
      manifests: registryOf(batchAi),
    });
    expect(plan.companions).toEqual([
      {
        name: 'zod',
        from: '3.24.2',
        to: '3.25.0',
        reason: 'openai 7.4.0 requires zod ^3.25 || ^4.0',
        required: true,
      },
    ]);
    expect(plan.blockers ?? []).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it('never moves a package that already satisfies the target, or one that is not installed', async () => {
    const satisfied = await companionsOf({
      name: 'openai',
      target: '7.4.0',
      installed: [at(batchAi, 'openai', '4.104.0'), at(batchAi, 'zod', '3.25.76')],
      manifests: registryOf(batchAi),
    });
    expect(satisfied.companions).toEqual([]);
    expect(satisfied.blockers ?? []).toEqual([]);
    const absent = await companionsOf({
      name: 'openai',
      target: '7.4.0',
      installed: [at(batchAi, 'openai', '4.104.0')],
      manifests: registryOf(batchAi),
    });
    expect(absent).toEqual({ companions: [], conflicts: [], peerConflicts: [] });
  });

  it('reports a peer that only a new major satisfies as a blocker, with the exact range, and does not move it', async () => {
    const registry = {
      schema: {
        '1.0.0': { peerDependencies: { zod: '^3.23.8' } },
        '2.0.0': { peerDependencies: { zod: '^4.0.0' } },
      },
      zod,
    };
    const plan = await companionsOf({
      name: 'schema',
      target: '2.0.0',
      installed: [at(registry, 'schema', '1.0.0'), at(registry, 'zod', '3.25.76')],
      manifests: registryOf(registry),
    });
    expect(plan.companions).toEqual([]);
    expect(plan.blockers).toEqual([
      'schema 2.0.0 needs zod ^4.0.0; installed 3.25.76, and only a new major satisfies it (zod 4.0.0); next: keep schema at 1.0.0 and plan the required peer upgrade explicitly',
    ]);
  });

  it('treats a 0.x minor as a new major: 0.1.4 never moves to 0.2.0 on its own', async () => {
    const registry = {
      lead: {
        '1.0.0': { peerDependencies: { tiny: '^0.1.0' } },
        '2.0.0': { peerDependencies: { tiny: '^0.2.0' } },
      },
      tiny: { '0.1.4': {}, '0.1.9': {}, '0.2.0': {} },
    };
    const plan = await companionsOf({
      name: 'lead',
      target: '2.0.0',
      installed: [at(registry, 'lead', '1.0.0'), at(registry, 'tiny', '0.1.4')],
      manifests: registryOf(registry),
    });
    expect(plan.companions).toEqual([]);
    expect(plan.blockers).toEqual([
      'lead 2.0.0 needs tiny ^0.2.0; installed 0.1.4, and only a new major satisfies it (tiny 0.2.0); next: keep lead at 1.0.0 and plan the required peer upgrade explicitly',
    ]);
  });

  it('moves a plain dependency within its major, and leaves one that needs a new major to a nested copy', async () => {
    const registry = {
      lead: {
        '1.0.0': { dependencies: { helper: '^1.0.0', other: '^1.0.0' } },
        '2.0.0': { dependencies: { helper: '^1.4.0', other: '^2.0.0' } },
      },
      helper: { '1.2.0': {}, '1.4.0': {}, '1.5.0': {} },
      other: { '1.0.0': {}, '2.0.0': {} },
    };
    const plan = await companionsOf({
      name: 'lead',
      target: '2.0.0',
      installed: [
        at(registry, 'lead', '1.0.0'),
        at(registry, 'helper', '1.2.0'),
        at(registry, 'other', '1.0.0'),
      ],
      manifests: registryOf(registry),
    });
    expect(plan.companions).toEqual([
      {
        name: 'helper',
        from: '1.2.0',
        to: '1.4.0',
        reason: 'lead 2.0.0 requires helper ^1.4.0',
        required: true,
      },
    ]);
    // The package manager installs other 2.0.0 for lead alone; the repository's 1.0.0 stays.
    expect(plan.blockers ?? []).toEqual([]);
  });

  it('only plans what a workspace of the lead resolves', async () => {
    const plan = await companionsOf({
      name: 'openai',
      target: '7.4.0',
      installed: [
        at(batchAi, 'openai', '4.83.0', ['packages/api']),
        at(batchAi, 'zod', '3.24.2', ['packages/web']),
      ],
      manifests: registryOf(batchAi),
    });
    expect(plan.companions).toEqual([]);
    expect(plan.blockers ?? []).toEqual([]);
    const hoisted = await companionsOf({
      name: 'openai',
      target: '7.4.0',
      installed: [
        at(batchAi, 'openai', '4.83.0', ['packages/api']),
        at(batchAi, 'zod', '3.24.2', ['.']),
      ],
      manifests: registryOf(batchAi),
    });
    expect(hoisted.companions.map((c) => `${c.name} ${c.to}`)).toEqual(['zod 3.25.0']);
  });

  it('leaves a dependent that needs a new 0.x line its own copy, and says what that line would need (openai-guardrails-js)', async () => {
    // openai/openai-guardrails-js: @openai/agents 0.1.11 depends on openai ^5.20.2. Its first
    // release on openai 7 is 0.15.0, a new line, which needs zod 4; zod 3.25.76 is installed.
    // A plain dependency, so npm keeps its nested openai 5 (as it does today, beside openai 4):
    // never a blocker. The real upgrade chose to move both across their majors; Uptide says
    // what that takes and moves neither.
    const plan = await companionsOf({
      name: 'openai',
      target: '7.9.0',
      installed: [
        at(guardrails, 'openai', '4.104.0'),
        at(guardrails, '@openai/agents', '0.1.11'),
        at(guardrails, 'zod', '3.25.76'),
      ],
      manifests: registryOf(guardrails),
    });
    expect(plan.companions).toEqual([]);
    expect(plan.blockers ?? []).toEqual([]);
    expect(plan.stays).toEqual([
      '@openai/agents 0.1.11 keeps its own openai ^5.20.2; only a new major accepts openai 7.9.0 (@openai/agents 0.15.0, which needs zod ^4.0.0; installed 3.25.76)',
    ]);
  });

  it('never blocks on a dependent whose plain dependency rejects the target (microsoft/prompty)', async () => {
    // microsoft/prompty: @azure/ai-projects 2.4.0 depends on openai ^6.16.0, and no release
    // accepts openai 7. The real upgrade kept it, with openai 6.49.0 nested under it.
    const registry = {
      openai: { ...openai, '6.49.0': {}, '7.10.0': {} },
      '@azure/ai-projects': {
        '2.4.0': { dependencies: { openai: '^6.16.0' } },
        '2.5.0': { dependencies: { openai: '^6.16.0' } },
      },
    };
    const plan = await companionsOf({
      name: 'openai',
      target: '7.10.0',
      installed: [at(registry, 'openai', '4.104.0'), at(registry, '@azure/ai-projects', '2.4.0')],
      manifests: registryOf(registry),
    });
    expect(plan.companions).toEqual([]);
    expect(plan.blockers ?? []).toEqual([]);
    expect(plan.stays).toEqual([
      '@azure/ai-projects 2.4.0 keeps its own openai ^6.16.0; no release accepts openai 7.10.0',
    ]);
  });

  it('never blocks on a dependent that pins the lead exactly (netlify/cli, verdaccio)', async () => {
    // netlify/cli: verdaccio 6 pins express 4.21.0; npm nests it, and the real upgrade to
    // express 5 left verdaccio alone.
    const registry = {
      express: { '4.22.1': {}, '5.2.1': {} },
      verdaccio: {
        '6.1.6': { dependencies: { express: '4.21.0' } },
        '6.2.1': { dependencies: { express: '4.21.2' } },
      },
    };
    const plan = await companionsOf({
      name: 'express',
      target: '5.2.1',
      installed: [at(registry, 'express', '4.22.1'), at(registry, 'verdaccio', '6.1.6')],
      manifests: registryOf(registry),
    });
    expect(plan.companions).toEqual([]);
    expect(plan.blockers ?? []).toEqual([]);
    expect(plan.stays).toEqual([
      'verdaccio 6.1.6 keeps its own express 4.21.0; no release accepts express 5.2.1',
    ]);
  });

  it('moves a dependent within its line when a release there accepts the target, and checks what that release requires', async () => {
    const registry = {
      ...guardrails,
      '@openai/agents': {
        ...agents,
        '0.1.12': { dependencies: { openai: '^7.0.0' }, peerDependencies: { zod: '^3.25.60' } },
      },
    };
    const plan = await companionsOf({
      name: 'openai',
      target: '7.9.0',
      installed: [
        at(registry, 'openai', '4.104.0'),
        at(registry, '@openai/agents', '0.1.11'),
        at(registry, 'zod', '3.25.40'),
      ],
      manifests: registryOf(registry),
    });
    expect(plan.companions).toEqual([
      {
        name: '@openai/agents',
        from: '0.1.11',
        to: '0.1.12',
        reason: '@openai/agents 0.1.11 depends on openai ^5.20.2, which rejects openai 7.9.0',
        required: true,
      },
      {
        name: 'zod',
        from: '3.25.40',
        to: '3.25.76',
        reason: '@openai/agents 0.1.12 requires zod ^3.25.60',
        required: true,
      },
    ]);
    expect(plan.blockers ?? []).toEqual([]);
  });

  it('keeps release-group companions as they are and adds the required moves next to them', async () => {
    // companions.test.ts's AI SDK 6 → 7 registry, with ai 7's zod peer.
    const registry: Record<string, Versions> = {
      ai: {
        '6.0.116': {
          dependencies: { '@ai-sdk/provider': '3.0.3', '@ai-sdk/provider-utils': '4.0.5' },
        },
        '7.0.9': {
          dependencies: { '@ai-sdk/provider': '4.0.1', '@ai-sdk/provider-utils': '5.0.1' },
          peerDependencies: { zod: '^3.25.76 || ^4.1.8' },
        },
      },
      '@ai-sdk/provider': { '3.0.3': {}, '4.0.1': {}, '4.0.2': {} },
      '@ai-sdk/react': {
        '3.0.118': { dependencies: { ai: '6.0.116', '@ai-sdk/provider-utils': '4.0.5' } },
        '4.0.10': { dependencies: { ai: '7.0.9', '@ai-sdk/provider-utils': '5.0.1' } },
      },
      zod: { '3.25.0': {}, '3.25.76': {}, '4.1.8': {} },
    };
    const plan = await companionsOf({
      name: 'ai',
      target: '7.0.9',
      installed: [
        at(registry, 'ai', '6.0.116'),
        at(registry, '@ai-sdk/provider', '3.0.3'),
        at(registry, '@ai-sdk/react', '3.0.118'),
        at(registry, 'zod', '3.25.0'),
      ],
      manifests: registryOf(registry),
    });
    const group = plan.companions.filter((c) => c.name.startsWith('@ai-sdk/'));
    expect(group.map((c) => `${c.name} ${c.to}`)).toEqual([
      '@ai-sdk/provider 4.0.1',
      '@ai-sdk/react 4.0.10',
    ]);
    expect(group.every((c) => c.required === undefined)).toBe(true);
    expect(plan.companions).toEqual([
      ...group,
      {
        name: 'zod',
        from: '3.25.0',
        to: '3.25.76',
        reason: 'ai 7.0.9 requires zod ^3.25.76 || ^4.1.8',
        required: true,
      },
    ]);
  });

  it('leaves a requirement the install already breaks today, and what depends on it (miurla/morphic)', async () => {
    // @ai-sdk/react 3.0.182 already peers on react ~19.1.2 || ^19.2.1 and react 19.2.0 is
    // installed: the upgrade does not introduce that, so react stays, and so does
    // @supabase/auth-ui-react, whose react ^18.2.0 rejects 19.x before and after.
    const peers = { react: '^18 || ~19.0.1 || ~19.1.2 || ^19.2.1' };
    const registry: Record<string, Versions> = {
      ai: { '6.0.180': {}, '7.0.66': {} },
      '@ai-sdk/react': {
        '3.0.182': { dependencies: { ai: '6.0.180' }, peerDependencies: peers },
        '4.0.69': { dependencies: { ai: '7.0.66' }, peerDependencies: peers },
      },
      react: { '19.2.0': {}, '19.2.1': {} },
      '@supabase/auth-ui-react': { '0.4.7': { dependencies: { react: '^18.2.0' } } },
    };
    const plan = await companionsOf({
      name: 'ai',
      target: '7.0.66',
      installed: [
        at(registry, 'ai', '6.0.180'),
        at(registry, '@ai-sdk/react', '3.0.182'),
        at(registry, 'react', '19.2.0'),
        at(registry, '@supabase/auth-ui-react', '0.4.7'),
      ],
      manifests: registryOf(registry),
      releaseGroup: ['@ai-sdk/react'],
    });
    expect(plan.companions.map((c) => `${c.name} ${c.to}`)).toEqual(['@ai-sdk/react 4.0.69']);
    expect(plan.blockers ?? []).toEqual([]);
  });
});
