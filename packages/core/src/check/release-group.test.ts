import { expect, it } from 'vitest';
import type { Manifest } from '../list/evidence.js';
import { companionsOf } from './companions.js';

it.each([
  [
    'exif-photo-blog @3f1a363',
    '15.5.5',
    '16.0.1',
    ['eslint-config-next', '@next/eslint-plugin-next', '@next/bundle-analyzer'],
  ],
  ['wortkarte @e3bd367', '15.5.27', '16.3.8', ['eslint-config-next']],
] as const)('moves the complete release group: %s', async (_, from, target, members) => {
  const input: Parameters<typeof companionsOf>[0] = {
    name: 'next',
    target,
    releaseGroup: members,
    installed: ['next', ...members].map((name) => ({
      name,
      version: from,
      workspaces: ['.'],
      manifest: name === 'eslint-config-next' ? { peerDependencies: { next: '>=15' } } : {},
    })),
    manifests: async () => ({ [from]: {}, [target]: {} }),
  };
  const plan = await companionsOf(input);
  expect(plan.conflicts).toEqual([]);
  expect(plan.companions.map((c) => [c.name, c.from, c.to])).toEqual(
    [...members].sort((a, b) => a.localeCompare(b)).map((name) => [name, from, target]),
  );
});

it('chooses the newest demonstrably compatible fallback, excluding prereleases', async () => {
  const input: Parameters<typeof companionsOf>[0] = {
    name: 'next',
    target: '16.0.1',
    releaseGroup: ['@next/mdx'],
    installed: ['next', '@next/mdx'].map((name) => ({
      name,
      version: '15.5.5',
      workspaces: ['.'],
      manifest: {},
    })),
    manifests: async (name: string): Promise<Record<string, Manifest>> =>
      name === 'next'
        ? { '16.0.1': {} }
        : {
            '16.0.0': { peerDependencies: { next: '^16' } },
            '16.0.2': { peerDependencies: { next: '^16' } },
            '16.0.3-beta.1': { peerDependencies: { next: '^16' } },
            '17.0.0': { peerDependencies: { next: '^17' } },
          },
  };
  expect((await companionsOf(input)).companions[0]?.to).toBe('16.0.2');
});

it('blocks a declared member with no provably compatible release', async () => {
  const input: Parameters<typeof companionsOf>[0] = {
    name: 'next',
    target: '16.0.1',
    releaseGroup: ['@next/mdx'],
    installed: ['next', '@next/mdx'].map((name) => ({
      name,
      version: '15.5.5',
      workspaces: ['.'],
      manifest: {},
    })),
    manifests: async (name: string): Promise<Record<string, Manifest>> =>
      name === 'next' ? { '16.0.1': {} } : { '15.5.5': {} },
  };
  expect((await companionsOf(input)).conflicts).toEqual([
    '@next/mdx 15.5.5 has no release that agrees with next 16.0.1 (declared release group requires @next/mdx 16.0.1); next: keep next at 15.5.5 until a compatible @next/mdx release is available',
  ]);
});
