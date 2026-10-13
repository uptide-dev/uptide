import { definePack } from '../contract.js';
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
  companions: [
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
  behavior: [
    {
      id: 'minor-config',
      summary:
        'Check the target minor: cacheLife/cacheHandlers and enablePrerenderSourcemaps stabilize in 16.0; turbopack.moduleIds moves under experimental. Later 16.x removes clientSegmentCache, devCacheControlNoCache and appNewScrollHandler; adapterPath and browser log forwarding stabilize; experimental unstable_prefetch becomes unstable_instant, and agentUpgrade no longer accepts true. Build caching, shared runtime, CJS tree shaking and export mangling defaults evolve. Review exact release notes rather than applying these options to every 16.x target.',
      reported: ['decision'],
    },
    {
      id: 'platform-minimums',
      summary:
        'Both routers require Node >=20.9.0 and TypeScript >=5.1.0; supported browsers start at Chrome/Edge/Firefox 111 and Safari 16.4. Check CI, Docker and deployment runtimes.',
      reported: ['decision'],
    },
    {
      id: 'turbopack-default',
      summary:
        'next dev/build default to Turbopack. Review webpack plugins/loaders, Sass tilde imports, Node-module fallbacks and modern Sass API. A custom webpack config can fail the default build; choose migration or explicit --webpack. File-system caching defaults vary across 16.x.',
      reported: ['decision'],
    },
    {
      id: 'config-conventions',
      summary:
        'Review next.config.js/mjs/ts: experimental.turbo becomes turbopack; reactCompiler moves to top level; turbo minify/treeShaking/sourceMaps map to experimental.turbopackMinify/turbopackModuleFragments/turbopackSourceMaps; memoryLimit/turbopackMemoryLimit are removed. Pack discovery is limited to usage files and cannot guarantee untyped config coverage.',
      reported: ['decision'],
    },
    {
      id: 'middleware-proxy',
      summary:
        'middleware is deprecated in favor of proxy (including named export and NextMiddleware/MiddlewareConfig types). proxy is Node-only; retain middleware when Edge is required. Review skipMiddlewareUrlNormalize and experimental middlewarePrefetch/middlewareClientMaxBodySize/externalMiddlewareRewritesResolve renames. Pack edits cannot rename files atomically.',
      reported: ['decision'],
    },
    {
      id: 'lint-removal',
      summary:
        'next lint and next.config eslint are removed; next build no longer lints. Migrate scripts and ESLint config explicitly; eslint-config-next uses flat config. The pack cannot create a coordinated config/script migration.',
      reported: ['decision'],
    },
    {
      id: 'removed-options',
      summary:
        'Remove AMP options and next/amp, serverRuntimeConfig/publicRuntimeConfig and next/config, and devIndicators.appIsrStatus/buildActivity/buildActivityPosition after review. Preserve private runtime environment visibility. Type-visible imports have rules; untyped configuration needs manual inspection.',
      reported: ['decision'],
    },
    {
      id: 'cache-components',
      summary:
        'experimental.ppr, route experimental_ppr, dynamicIO and useCache no longer select the old behavior. cacheComponents is an opt-in model change, not a rename: review Suspense, runtime, segment options and caching. Do not auto-enable it or delete route options silently. Later 16.x partial-prefetch/instant opt-in codemods are not required baseline migrations.',
      reported: ['decision'],
    },
    {
      id: 'metadata-promises',
      summary:
        'App Router image generators receive Promise params and id; generateImageMetadata params remain synchronous. sitemap id becomes Promise<string>, requiring await and explicit numeric conversion if used arithmetically. Local annotations can hide this from tsc without Next type generation. Pages Router data fetching is unchanged.',
      reported: ['decision'],
    },
    {
      id: 'image-defaults',
      summary:
        'Review images: local query strings require localPatterns.search; minimumCacheTTL is 14400 seconds, default imageSizes omits 16, qualities defaults to [75], local IP optimization is blocked, redirects are limited to 3. Review priority/preload, deprecated legacy/image and domains. Never silently loosen image security.',
      reported: ['decision'],
    },
    {
      id: 'routing-build',
      summary:
        'Parallel route slots need default files; choose notFound or null explicitly. Prefetch deduplication changes request counts. Smooth-scroll override now needs data-scroll-behavior="smooth". Development output moves to .next/dev with process locks; build size/First Load JS columns are removed. next dev config process.argv no longer contains dev; use phase/NODE_ENV as appropriate.',
      reported: ['decision'],
    },
    {
      id: 'peers',
      summary:
        'Check installed peer ranges before publication. Next 16.0.0 and 16.4.0 accept react/react-dom ^18.2.0 || 19.0.0-rc-de68d2f4-20241204 || ^19.0.0; App Router bundles React canary features. Do not force React 19 for Pages Router or auto-upgrade a third-party peer blocker. Published next-i18next 15.4.2 accepts next >=12.0.0; inspect the exact installed manifest.',
      reported: ['decision'],
    },
  ],
  instructions:
    'Sources read 2026-10-13; see RESEARCH.md. Migrate only supported reported sites. Preserve values, control flow, caching freshness, router boundaries and secret visibility. Never cast to any, suppress diagnostics, run an unpinned codemod, or enable experimental behavior to get a clean compile. Review behavior decisions and run the actual application build before publication. Candidate status does not authorize a verified Next upgrade PR.',
});
