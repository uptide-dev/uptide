import { definePack } from '../contract.js';
import { nextBehavior } from './behavior.js';
import {
  eslintConfigSites,
  middlewareSites,
  removeEslintConfig,
  renameMiddleware,
} from './conventions.js';
import { revalidateTagSites, stabilizeCacheImport, stableCacheSites } from './detect.js';

const guide = 'https://nextjs.org/docs/app/guides/upgrading/version-16';
const codemods = 'https://github.com/vercel/next.js/tree/v16.4.0/packages/next-codemod';

/** Sources read 2026-10-13. Full classification, exact peers and limits: RESEARCH.md.
 * App Router request props differ from Pages Router's synchronous data-fetching context.
 * No runtime/config decision is made by a mechanical rewrite.
 */
export const nextPack = definePack({
  meta: {
    package: 'next',
    from: '>=15 <16',
    to: '>=16 <17',
    sources: [
      { title: 'Next.js 16 upgrade guide (read 2026-10-13)', url: guide },
      {
        title: 'Image priority deprecation (read 2026-10-13)',
        url: 'https://nextjs.org/docs/app/api-reference/components/image#priority',
      },
      { title: 'Next.js 16 announcement', url: 'https://nextjs.org/blog/next-16' },
      { title: 'Official codemod source, pinned 16.4.0', url: codemods },
      ...['16.0.0', '16.1.0', '16.2.0', '16.3.0', '16.4.0'].map((version) => ({
        title: `Next.js ${version} release notes (read 2026-10-13)`,
        url: `https://github.com/vercel/next.js/releases/tag/v${version}`,
      })),
    ],
    maintainer: 'uptide-dev',
  },
  defaultTarget: '16.4.0',
  requiresBuild: true,
  inventory: [
    'next.config.{js,mjs,ts,cjs}',
    '{middleware,src/middleware}.{ts,js}',
    'package.json',
    '{app,src/app,pages,src/pages}/**/*.{ts,tsx,js,jsx}',
    '.github/workflows/*.{yml,yaml}',
    '{.nvmrc,.node-version}',
  ],
  releaseGroup: [
    {
      name: 'eslint-config-next',
      source: 'https://nextjs.org/docs/app/guides/upgrading/codemods#upgrade',
    },
    {
      name: '@next/eslint-plugin-next',
      source: 'https://nextjs.org/docs/app/guides/upgrading/codemods#upgrade',
    },
    ...['@next/bundle-analyzer', '@next/mdx', '@next/third-parties'].map((name) => ({
      name,
      source: 'https://github.com/vercel/next.js/blob/v16.4.0/scripts/publish-release.js',
    })),
  ],
  rules: [
    {
      id: 'middleware-proxy',
      summary:
        'Migrate the deprecated middleware convention to proxy after reviewing Node runtime compatibility',
      severity: 'deprecated',
      kinds: [],
      symbols: /$^/,
      detect: middlewareSites,
      rewrite: renameMiddleware,
      guide:
        'Port of the pinned middleware-to-proxy codemod for exported functions. Explicit runtime declarations and ambiguous exports remain assisted. Proxy runs on Node; retain middleware if Edge is required. The rename keeps the old finding anchor.',
    },
    {
      id: 'lint-removal',
      summary: 'Remove the unsupported next.config eslint option',
      severity: 'breaking',
      kinds: [],
      symbols: /$^/,
      detect: eslintConfigSites,
      rewrite: removeEslintConfig,
      guide:
        'Remove the obsolete eslint option from the exported Next config. Review lint scripts and ESLint flat config separately: next build no longer lints. Dynamic or side-effectful values require assistance.',
    },
    {
      id: 'image-priority',
      summary: 'next/image priority is deprecated in favor of explicit loading/preload choices',
      severity: 'deprecated',
      kinds: ['deprecated'],
      symbols: /(?:priority|^TS6385$)/,
      message: /(?:^$|'priority' is deprecated)/,
      guide:
        'Review next/image priority at the shared wrapper first, then its callers. Choose preload, loading or fetchPriority from intended image loading behavior. Never change all priority-named props on unrelated components.',
    },
    {
      id: 'stable-cache-exports',
      summary: 'unstable_cacheLife and unstable_cacheTag have stable next/cache exports',
      severity: 'deprecated',
      kinds: ['deprecated', 'renamed', 'removed'],
      symbols: /(?:^|:)(?:unstable_cacheLife|unstable_cacheTag)$/,
      detect: stableCacheSites,
      rewrite: stabilizeCacheImport,
      guide:
        'Use cacheLife/cacheTag from next/cache. The pinned remove-unstable-prefix codemod supplies this mapping. Only aliased named imports are rewritten mechanically, preserving local bindings. Unaliased imports, namespace access, re-exports and CommonJS require scope-aware assisted edits; preserve public export names and shadowed locals. Do not rename unstable_cache, which remains a distinct API.',
    },
    {
      id: 'async-request-apis',
      summary:
        'synchronous App Router request access and UnsafeUnwrapped escape hatches are removed',
      severity: 'breaking',
      kinds: ['removed', 'type', 'signature'],
      symbols:
        /(?:UnsafeUnwrapped(?:Cookies|Headers|DraftMode)|^TS(?:2305|2339|2352|2740|2344|2322)$)/,
      message:
        /(?:UnsafeUnwrapped(?:Cookies|Headers|DraftMode)|Promise<.*(?:ReadonlyHeaders|ReadonlyRequestCookies|DraftMode)|(?:params|searchParams).*Promise|Promise.*(?:params|searchParams))/,
      guide:
        'Await cookies(), headers() and draftMode() in async server functions. App Router params/searchParams in page/layout/route/default and metadata image entrypoints are promises; use React.use in a synchronous Client Component after reviewing its boundary. Remove UnsafeUnwrapped casts, never introduce them: the Next 15 codemod fallback is invalid in 16. Propagate async changes to callers. Pages Router getServerSideProps/getStaticProps context.params and router.query remain synchronous. Bare tsc cannot validate ungenerated Next route types; review build/typegen separately.',
    },
    {
      id: 'revalidate-tag-profile',
      summary: 'single-argument revalidateTag needs an explicit caching decision',
      severity: 'breaking',
      kinds: ['signature', 'required'],
      symbols: /(?:^|:)revalidateTag$/,
      detect: revalidateTagSites,
      guide:
        'Ask for the intended freshness semantics. revalidateTag(tag, "max") uses stale-while-revalidate; updateTag(tag) provides read-your-writes only in Server Actions; revalidateTag(tag, { expire: 0 }) is immediate expiration for other contexts. Never silently insert "max", migrate to updateTag in a Route Handler, or suppress the diagnostic. Published 16.0.0, 16.0.1 and 16.4.0 declarations require the second argument.',
    },
    {
      id: 'removed-amp',
      summary: 'next/amp and AMP configuration are removed',
      severity: 'breaking',
      kinds: ['removed', 'type'],
      symbols: /(?:useAmp|^TS2307$)/,
      message: /(?:next\/amp|useAmp)/,
      guide:
        'AMP is removed. Redesign the AMP page as a normal page with the same content and metadata; remove AMP configuration after review. Do not replace useAmp with an arbitrary boolean to silence the compiler.',
    },
    {
      id: 'removed-runtime-config',
      summary: 'next/config runtime configuration is removed',
      severity: 'breaking',
      kinds: ['removed', 'type'],
      symbols: /(?:getConfig|^TS2307$)/,
      message: /next\/config/,
      guide:
        'Replace runtime config after deciding server/client visibility and evaluation time. Never expose serverRuntimeConfig secrets through NEXT_PUBLIC_ variables. Public build-time values and server runtime environment reads are not interchangeable. Review standalone deployment and serialization.',
    },
    {
      id: 'removed-root-params',
      summary: 'unstable_rootParams is removed',
      severity: 'breaking',
      kinds: ['removed', 'type'],
      symbols: /(?:unstable_rootParams|^TS2305$)/,
      message: /unstable_rootParams/,
      guide:
        'The replacement was not available at 16.0 launch. Where the target supplies generated next/root-params APIs, use those appropriate to the route; otherwise stop for a route-specific redesign. Review generation and caching context; do not invent route parameter names or cast the old value.',
    },
  ],
  behavior: nextBehavior,
  instructions:
    'Sources read 2026-10-13; see RESEARCH.md. Migrate only supported reported sites. Preserve values, control flow, caching freshness, router boundaries and secret visibility. Never cast to any, suppress diagnostics, run an unpinned codemod, or enable experimental behavior to get a clean compile. Review behavior decisions and run the actual application build before publication. A verified pack score does not replace the required consumer build or unresolved runtime decisions.',
});
