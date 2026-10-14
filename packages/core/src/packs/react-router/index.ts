import { definePack } from '../contract.js';
import { reactRouterBehavior } from './behavior.js';
import {
  domEntrySites,
  domImportSites,
  domServerSites,
  formMethodSites,
  futureOptionSites,
  moveDomImport,
  moveDomServerImport,
  removedCallSites,
  removeFutureOption,
  removeFutureProp,
  uppercaseFormMethod,
} from './detect.js';

/**
 * react-router >=6 <7 → >=7 <8, with react-router-dom (a re-export of react-router in v7)
 * moving in lockstep. Sources read 2026-10-14, pinned to the release commits below; the full
 * classification, why 6 → 8 is two upgrades, and the ground truth are in RESEARCH.md. Only
 * edits that hold whatever the surrounding code is are mechanical; the six v6 future flags
 * become defaults and are behavior notes, scoped by the repository's router setup.
 */
const repo = 'https://github.com/remix-run/react-router/blob';
const v7 = '1b1e0b0e79b21692ce907933475233babdd16e3e'; // react-router@7.18.4
const v6 = 'dead4962d6c33e962f266af910b7a09e3ece30cf'; // react-router-dom@6.30.6
const upgrading = `${repo}/${v7}/docs/upgrading/v6.md`;

export const reactRouterPack = definePack({
  meta: {
    package: 'react-router',
    from: '>=6 <7',
    to: '>=7 <8',
    sources: [
      {
        title: 'Upgrading from v6, pinned at react-router@7.18.4 (read 2026-10-14)',
        url: upgrading,
      },
      {
        title: 'v6 future flags, pinned at react-router-dom@6.30.6 (read 2026-10-14)',
        url: `${repo}/${v6}/docs/upgrading/future.md`,
      },
      {
        title: 'react-router CHANGELOG 7.0.0 to 7.18.4 (read 2026-10-14)',
        url: `${repo}/${v7}/packages/react-router/CHANGELOG.md`,
      },
      {
        title: 'react-router-dom CHANGELOG 7.0.0 (read 2026-10-14)',
        url: `${repo}/${v7}/packages/react-router-dom/CHANGELOG.md`,
      },
      {
        title: 'react-router-dom 7 entry: re-exports react-router and react-router/dom',
        url: `${repo}/e8e3b004d94a949372e77ce97a543bff5bc6fb89/packages/react-router-dom/index.ts`,
      },
      {
        title: 'Release notes 7.0.0, root CHANGELOG (read 2026-10-14)',
        url: `${repo}/${v7}/CHANGELOG.md`,
      },
    ],
    maintainer: 'uptide-dev',
  },
  defaultTarget: '7.18.4',
  releaseGroup: [
    {
      // Published at every react-router 7 version, pinning it exactly; the guide upgrades both.
      name: 'react-router-dom',
      source: `${repo}/${v7}/packages/react-router-dom/CHANGELOG.md`,
    },
  ],
  inventory: [
    'package.json',
    '{.nvmrc,.node-version}',
    '{.eslintrc,.eslintrc.json,.eslintrc.js,.eslintrc.cjs,eslint.config.js,eslint.config.mjs,eslint.config.cjs,eslint.config.ts}',
    '{src,app,lib,client,test,tests,__tests__,__mocks__}/**/*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}',
    '*.{ts,tsx,js,jsx,mts,mjs}',
  ],
  rules: [
    {
      id: 'dom-imports',
      summary:
        'import from react-router instead of react-router-dom, which v7 keeps only as a re-export',
      severity: 'deprecated',
      kinds: [],
      symbols: /$^/,
      detect: domImportSites,
      rewrite: (text, finding, context) => moveDomImport(text, finding, context),
      guide:
        'react-router-dom 7 is `export * from "react-router"` plus RouterProvider and HydratedRouter from "react-router/dom", and React Router 8 removes it. The guide moves every import to "react-router". Only the module specifier changes. A test that mocks "react-router-dom" by name (jest.mock, vi.mock, vi.importActual, __mocks__/react-router-dom) no longer stands in for code that imports "react-router": move the mock and the imports together, or leave both.',
    },
    {
      id: 'dom-entry-imports',
      summary:
        'RouterProvider and HydratedRouter come from react-router/dom in a DOM app in v7; a namespace or wildcard react-router-dom import needs a choice',
      severity: 'deprecated',
      kinds: [],
      symbols: /$^/,
      detect: (text, file) => domEntrySites(text, file),
      guide:
        'In a DOM app, import RouterProvider (and HydratedRouter) from "react-router/dom": it is the one wired to ReactDOM.flushSync; the "react-router" RouterProvider is for non-DOM code and Jest tests, as the guide says. Every other name comes from "react-router". "react-router/dom" resolves only under moduleResolution bundler, node16 or nodenext; under node/node10 keep this import on react-router-dom 7 for now. A decision for the owner: say which entry each file uses and why.',
    },
    {
      id: 'dom-server-entry',
      summary:
        'react-router-dom/server is gone in v7: StaticRouter, createStaticHandler and the rest come from react-router',
      severity: 'breaking',
      kinds: ['type'],
      symbols: /^TS2307$/,
      message: /react-router-dom\/server/,
      detect: domServerSites,
      rewrite: moveDomServerImport,
      guide:
        'react-router-dom 7 exports only its main entry, so "react-router-dom/server" no longer resolves even when react-router-dom is kept. StaticRouter, StaticRouterProvider, createStaticHandler, createStaticRouter and their types are exported by "react-router".',
    },
    {
      id: 'future-prop',
      summary: 'router components take no `future` prop in v7: the v6 flags are the default',
      severity: 'breaking',
      kinds: ['type', 'removed', 'signature'],
      symbols:
        /(?:^TS2322$|(?:^|:)(?:BrowserRouter|HashRouter|MemoryRouter|Router|StaticRouter|RouterProvider|(?:unstable_)?HistoryRouter)$)/,
      message: /Property 'future' does not exist/,
      rewrite: removeFutureProp,
      guide:
        'Remove the `future` prop: every v6 flag it set is v7 behavior, and the prop no longer exists. A flag set to false or left out changes behavior now; the behavior notes say which. When the prop is a variable, remove the variable too if nothing else reads it.',
    },
    {
      id: 'future-option',
      summary: 'the `future` option of a router factory holds v6 flags that v7 ignores',
      severity: 'deprecated',
      kinds: [],
      symbols: /$^/,
      detect: futureOptionSites,
      rewrite: removeFutureOption,
      guide:
        'v7 types `future` as an empty interface: the v6 keys still compile, do nothing, and become errors in 8.4. Remove them; keep any other option.',
    },
    {
      id: 'fallback-element',
      summary:
        '`<RouterProvider fallbackElement>` is removed: the root route renders `HydrateFallback`',
      severity: 'breaking',
      kinds: ['type', 'removed', 'signature'],
      symbols: /(?:^TS2322$|(?:^|:)RouterProvider$)/,
      message: /Property 'fallbackElement' does not exist/,
      guide:
        'Move the element to the root route as `hydrateFallbackElement` (route objects) or a `HydrateFallback` component, and remove the prop. With several root routes, it belongs on the one that renders first. useNavigation().state is "idle" during the initial load now: code that showed a spinner from it during the first load needs the fallback instead.',
    },
    {
      id: 'removed-json',
      summary:
        '`json()` is removed: return the data, or `data(value, init)` for a status or headers',
      severity: 'breaking',
      kinds: ['type', 'removed'],
      symbols: /(?:^TS(?:2305|2724|2614)$|(?:^|:)(?:json|JsonFunction)$)/,
      message: /(?:^$|'(?:json|JsonFunction)')/,
      detect: (text) => removedCallSites(text, ['json']),
      guide:
        'Choose per call, and report the choice in decisions: `return json(value)` becomes `return value` (v7 hands loader data to the component as is: a Date or class instance stays one instead of becoming JSON); `json(value, { status, headers })` becomes `data(value, { status, headers })` from "react-router"; where a real Response is needed (a fetch handler, a test that reads `.json()` or `.status` on the result), use `Response.json(value, init)`. Tests that call a loader and read the Response change with it.',
    },
    {
      id: 'removed-defer',
      summary:
        '`defer()` and `AbortedDeferredError` are removed: return the promises in a plain object',
      severity: 'breaking',
      kinds: ['type', 'removed'],
      symbols:
        /(?:^TS(?:2305|2724|2614)$|(?:^|:)(?:defer|AbortedDeferredError|TypedDeferredData|UNSAFE_DeferredData|UNSAFE_DEFERRED_SYMBOL)$)/,
      message:
        /(?:^$|'(?:defer|AbortedDeferredError|TypedDeferredData|UNSAFE_DeferredData|UNSAFE_DEFERRED_SYMBOL)')/,
      detect: (text) => removedCallSites(text, ['defer', 'AbortedDeferredError']),
      guide:
        '`return defer({ a, b })` becomes `return { a, b }`; with an init, `data({ a, b }, init)`. `<Await>` and `useAsyncValue` read the promises as before. v6 aborted deferred promises on navigation (AbortedDeferredError); raw promises are not aborted: code that caught that error, or relied on cancellation, needs a decision.',
    },
    {
      id: 'removed-exports',
      summary:
        'type aliases and internals removed from v7: Hash, Pathname, Search are `string`, V7_FormMethod is FormMethod; FutureConfig and UNSAFE_useRouteId have no replacement',
      severity: 'breaking',
      kinds: ['type', 'removed'],
      symbols:
        /(?:^TS(?:2305|2724|2459|2614)$|(?:^|:)(?:Hash|Pathname|Search|V7_FormMethod|FutureConfig|UNSAFE_useRouteId)$)/,
      message: /(?:^$|'(?:Hash|Pathname|Search|V7_FormMethod|FutureConfig|UNSAFE_useRouteId)')/,
      guide:
        '`Hash`, `Pathname` and `Search` were aliases of `string`: use `string`. `V7_FormMethod` is v7 `FormMethod` (uppercase). `FutureConfig` described the v6 flags, which are gone: delete what uses it. `UNSAFE_useRouteId` has no public replacement: stop and say so rather than reaching into internals.',
    },
    {
      id: 'form-method-case',
      summary:
        '`formMethod` is uppercase in v7: a comparison with a lowercase method is always false',
      severity: 'breaking',
      kinds: ['type'],
      symbols: /^TS(?:2367|2678|2820)$/,
      message:
        /"(?:get|post|put|patch|delete)"[\s\S]*"(?:GET|POST|PUT|PATCH|DELETE)"|"(?:GET|POST|PUT|PATCH|DELETE)"[\s\S]*"(?:get|post|put|patch|delete)"/,
      detect: formMethodSites,
      rewrite: uppercaseFormMethod,
      guide:
        'Compare `formMethod` with the uppercase method ("POST"). A value typed `FormMethod` that is assigned a lowercase literal takes the uppercase one. `<Form method="post">` and `submit({ method: "post" })` still accept lowercase: leave them.',
    },
    {
      id: 'stabilized-options',
      summary:
        '`unstable_dataStrategy` and `unstable_patchRoutesOnNavigation` are `dataStrategy` and `patchRoutesOnNavigation`',
      severity: 'breaking',
      kinds: ['type', 'signature'],
      symbols: /^TS(?:2353|2561|2345|2769)$/,
      message: /unstable_(?:dataStrategy|patchRoutesOnNavigation|patchRoutesOnMiss)/,
      guide:
        'Rename the option, then check the function against the v7 `DataStrategyFunction` / `PatchRoutesOnNavigationFunction` types: dataStrategy returns results keyed by route id (not an array) since 6.28. Keep what it loads and when.',
    },
  ],
  behavior: reactRouterBehavior,
  instructions:
    'Sources read 2026-10-14; see RESEARCH.md. Migrate only the reported sites to React Router 7, from the compiler error and the guide above. Keep routes, paths, loaders, actions and what each returns to the component as they are. Never introduce framework mode (routes.ts, the Vite plugin, route modules), never restructure the route tree, and never cast to any or suppress a diagnostic to make it compile. Where the guide offers options (json, defer, the RouterProvider entry), choose one and report it in decisions with the files.',
});
