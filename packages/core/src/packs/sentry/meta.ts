import type { PackSource } from '../contract.js';
import type { PackCompanion } from '../types.js';

/** Config the compiler may not reach: init files, next.config, manifests and runtime pins. */
export const INVENTORY = [
  'package.json',
  '{.nvmrc,.node-version}',
  '**/*{sentry,Sentry,instrument}*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}',
  '**/sentry/**/*.{ts,tsx,js,jsx,mjs,cjs}',
];
export const NEXT_INVENTORY = [
  'next.config.{js,mjs,cjs,ts,mts}',
  '{middleware,proxy,src/middleware,src/proxy}.{ts,js}',
];

/** Read date of every source below; RESEARCH.md classifies each change against them. */
export const READ = '2026-10-14';

const repo = 'https://github.com/getsentry/sentry-javascript';
export const GUIDE = `${repo}/blob/11.7.0/MIGRATION.md#upgrading-from-10x-to-11x`;
export const CHANGELOG = `${repo}/blob/11.7.0/CHANGELOG.md`;
/** One craft release publishes every SDK package at the same version: the lockstep group. */
export const RELEASE_CONFIG = `${repo}/blob/11.7.0/.craft.yml`;

export const SOURCES: readonly PackSource[] = [
  {
    title: `Sentry JavaScript SDK migration guide 10.x to 11.x, tag 11.7.0 (read ${READ})`,
    url: GUIDE,
  },
  {
    title: `Sentry JavaScript SDK CHANGELOG.md, 11.0.0 to 11.7.0, tag 11.7.0 (read ${READ})`,
    url: CHANGELOG,
  },
  { title: `Release configuration, tag 11.7.0 (read ${READ})`, url: RELEASE_CONFIG },
];

/**
 * Every npm target of the SDK's craft release at 11.7.0, published at the one version of the
 * tag. Tooling-only targets (`@sentry/typescript`, the SDK's own eslint config) are left out:
 * no application depends on them. `@sentry/types` and `@sentry/node-core` are not here: they
 * have no 11.x release (the guide removes both); `@sentry/cli`, `@sentry/webpack-plugin` and
 * `@sentry/vite-plugin` are versioned on their own. `@sentry/bundler-plugins` is a lockstep target
 * too, but consumers reach it through `@sentry/vite-plugin`/`@sentry/webpack-plugin` 5.x, whose
 * manifests require it at ^10 (vite-plugin 5.4.0: `@sentry/bundler-plugins ^10.64.0`); moving it
 * with the SDK would break them, so it is left to those plugins.
 */
export const LOCKSTEP = [
  '@sentry/core',
  '@sentry/server-utils',
  '@sentry/browser-utils',
  '@sentry/replay',
  '@sentry/opentelemetry',
  '@sentry/feedback',
  '@sentry/replay-canvas',
  '@sentry/browser',
  '@sentry/node',
  '@sentry/profiling-node',
  '@sentry/node-native',
  '@sentry/angular',
  '@sentry/ember',
  '@sentry/react',
  '@sentry/solid',
  '@sentry/svelte',
  '@sentry/vue',
  '@sentry/wasm',
  '@sentry/vercel-edge',
  '@sentry/cloudflare',
  '@sentry/deno',
  '@sentry/aws-serverless',
  '@sentry/google-cloud-serverless',
  '@sentry/bun',
  '@sentry/elysia',
  '@sentry/hono',
  '@sentry/nestjs',
  '@sentry/effect',
  '@sentry/nextjs',
  '@sentry/nuxt',
  '@sentry/remix',
  '@sentry/solidstart',
  '@sentry/sveltekit',
  '@sentry/tanstackstart-react',
  '@sentry/gatsby',
  '@sentry/astro',
  '@sentry/react-router',
  '@sentry/nitro',
] as const;

export function releaseGroup(lead: string): PackCompanion[] {
  return LOCKSTEP.filter((name) => name !== lead).map((name) => ({ name, source: RELEASE_CONFIG }));
}
