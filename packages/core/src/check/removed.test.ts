import { describe, expect, it } from 'vitest';
import { companionsOf, type InstalledDependency } from './companions.js';

type Versions = Record<
  string,
  {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    deprecated?: string;
  }
>;

// As npm publishes them: the last @types release of each is a stub that only depends on the
// package, deprecated once (`@types/stripe` 8.0.0 to 8.0.416 are stubs npm never flagged).
const stub = (name: string) =>
  `This is a stub types definition. ${name} provides its own type definitions, so you do not need this installed.`;
const registry: Record<string, Versions> = {
  ioredis: { '4.28.5': {}, '5.4.1': {} },
  '@types/ioredis': {
    '4.28.10': { dependencies: { '@types/node': '*' } },
    '5.0.0': { dependencies: { ioredis: '*' }, deprecated: stub('ioredis') },
  },
  stripe: { '7.15.0': {}, '8.0.0': {}, '18.0.0': {} },
  '@types/stripe': {
    '7.13.25': { dependencies: { '@types/node': '*' } },
    '8.0.0': { dependencies: { stripe: '*' } },
    '8.0.416': { dependencies: { stripe: '*' } },
    '8.0.417': { dependencies: { stripe: '*' }, deprecated: stub('stripe') },
  },
};
// What each version's full manifest declares: ioredis 5 `types`, stripe 8 `types`, stripe 18
// `types` and a `types` export. Neither ioredis 4 nor stripe 7 ships any.
const typed = new Set(['ioredis@5.4.1', 'stripe@8.0.0', 'stripe@18.0.0']);
const ownTypes = async (name: string, version: string) => typed.has(`${name}@${version}`);

const installed = (name: string, version: string): InstalledDependency => ({
  name,
  version,
  manifest: { name, version, ...registry[name]?.[version] },
  workspaces: ['.'],
});
const plan = (
  lead: string,
  from: string,
  target: string,
  types: [string, string],
  extra: Partial<Parameters<typeof companionsOf>[0]> = {},
) =>
  companionsOf({
    name: lead,
    target,
    installed: [installed(lead, from), installed(...types)],
    manifests: async (name) => registry[name] ?? {},
    ownTypes,
    ...extra,
  });

describe('a deprecated @types stub is removed instead of upgraded', () => {
  it('removes @types/ioredis: ioredis 5 ships its own types and @types/ioredis 5.0.0 is a stub', async () => {
    const result = await plan('ioredis', '4.28.5', '5.4.1', ['@types/ioredis', '4.28.10']);
    expect(result.companions).toEqual([]);
    expect(result.removals).toEqual([
      { name: '@types/ioredis', from: '4.28.10', reason: 'ioredis 5 ships its own types' },
    ]);
  });

  it('removes @types/stripe: the release the plan would reach is the deprecated stub', async () => {
    const result = await plan('stripe', '7.15.0', '18.0.0', ['@types/stripe', '7.13.25']);
    expect(result.companions).toEqual([]);
    expect(result.removals).toEqual([
      { name: '@types/stripe', from: '7.13.25', reason: 'stripe 18 ships its own types' },
    ]);
  });

  it('upgrades it as before when the release it reaches is not deprecated', async () => {
    // stripe 8.0.0 ships types, but @types/stripe 8.0.416 carries no deprecation: npm's word
    // decides, not the stub's look.
    const result = await plan('stripe', '7.15.0', '8.0.0', ['@types/stripe', '7.13.25'], {
      manifests: async (name) =>
        name === '@types/stripe'
          ? { '7.13.25': {}, '8.0.416': { dependencies: { stripe: '*' } } }
          : (registry[name] ?? {}),
    });
    expect(result.removals).toBeUndefined();
    expect(result.companions).toEqual([
      expect.objectContaining({ name: '@types/stripe', from: '7.13.25', to: '8.0.416' }),
    ]);
  });

  it('upgrades it as before when the target does not declare its own types', async () => {
    const result = await plan('ioredis', '4.28.5', '5.4.1', ['@types/ioredis', '4.28.10'], {
      ownTypes: async () => false,
    });
    expect(result.removals).toBeUndefined();
    expect(result.companions).toEqual([
      expect.objectContaining({ name: '@types/ioredis', from: '4.28.10', to: '5.0.0' }),
    ]);
  });

  it('upgrades it as before when nothing can say whether the target ships types', async () => {
    const result = await plan('ioredis', '4.28.5', '5.4.1', ['@types/ioredis', '4.28.10'], {
      ownTypes: undefined,
    });
    expect(result.removals).toBeUndefined();
    expect(result.companions.map((c) => c.name)).toEqual(['@types/ioredis']);
  });
});
