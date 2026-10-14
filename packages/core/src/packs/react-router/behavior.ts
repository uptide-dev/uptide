import type { BehaviorNote } from '../contract.js';
import type { PackContext } from '../types.js';

/**
 * What compiles the same and behaves differently in React Router 7, each scoped by evidence
 * from the repository's own router setup (`PackContext.inventory`, read before any edit). A v6
 * future flag the code already turned on changed nothing when v7 made it the default, so its
 * note says so only where no setup enables it.
 */
const guide =
  'https://github.com/remix-run/react-router/blob/1b1e0b0e79b21692ce907933475233babdd16e3e/docs/upgrading/v6.md';
const SOURCE = /\.[cm]?[jt]sx?$/;
const ROUTER_IMPORT = /\bfrom\s*['"]react-router(?:-dom)?(?:\/server)?['"]/;

type File = { file: string; text: string };
const files = (c: PackContext): File[] => c.inventory ?? [];
/** Source files that import React Router. */
const routerFiles = (c: PackContext): File[] =>
  files(c).filter((f) => SOURCE.test(f.file) && ROUTER_IMPORT.test(f.text));

/** `file:line` for each match, the first three, and how many more. */
function where(found: File[], pattern: RegExp, limit = 3): string[] {
  const hits: string[] = [];
  for (const f of found) {
    const lines = f.text.split('\n');
    lines.forEach((line, i) => {
      if (pattern.test(line)) hits.push(`\`${f.file}:${i + 1}\``);
    });
  }
  return hits.length > limit ? [...hits.slice(0, limit), `${hits.length - limit} more`] : hits;
}

const SETUP =
  /<(?:BrowserRouter|HashRouter|MemoryRouter|StaticRouter|RouterProvider|(?:unstable_)?HistoryRouter)\b|\bcreate(?:Browser|Hash|Memory|Static)Router\s*\(/;

/** The flag is set to true somewhere: that router already behaved as v7 does. */
const adopted = (c: PackContext, flag: string): boolean =>
  routerFiles(c).some((f) => new RegExp(`\\b${flag}\\s*:\\s*true\\b`).test(f.text));

function flagNote(
  id: string,
  flag: string,
  summary: string,
  evidence: RegExp,
  what: string,
): BehaviorNote {
  return {
    id,
    summary,
    reported: ['decision'],
    applies(c) {
      if (adopted(c, flag)) return false;
      const sites = where(routerFiles(c), evidence);
      return sites.length ? `${what} (${sites.join(', ')}) without \`${flag}\`: ${summary}` : false;
    },
  };
}

export const reactRouterBehavior: BehaviorNote[] = [
  flagNote(
    'relative-splat-path',
    'v7_relativeSplatPath',
    'relative paths inside a splat route (`path="dashboard/*"`) now resolve from the route itself, one segment further down: a relative `<Link to>` or `navigate("..")` beneath it needs an extra `..`, or the route split into a parent `dashboard` and a child `*`. Choose which, per route.',
    /\bpath\s*[:=]\s*\{?\s*["'`][^"'`]*[^"'`/*]\/\*["'`]/,
    'multi-segment splat routes',
  ),
  flagNote(
    'start-transition',
    'v7_startTransition',
    'router state updates run in `React.startTransition`: a `React.lazy` created inside a component suspends differently; move it to module scope. `<RouterProvider useTransitions={false}>` (7.15+) opts out.',
    SETUP,
    'routers',
  ),
  flagNote(
    'fetcher-persist',
    'v7_fetcherPersist',
    'a fetcher now lives until it returns to idle, not until its component unmounts: `useFetchers()` can list fetchers whose component is gone.',
    /\buseFetchers?\s*[<(]/,
    'fetchers',
  ),
  flagNote(
    'normalize-form-method',
    'v7_normalizeFormMethod',
    '`formMethod` on `useNavigation()`, `useFetcher()` and `shouldRevalidate` is uppercase (`"POST"`): comparisons with lowercase methods are always false. The compiler rejects typed literals; values typed `string` or `any` and `.toLowerCase()` wrappers it cannot see.',
    /\bformMethod\b/,
    'reads of `formMethod`',
  ),
  flagNote(
    'partial-hydration',
    'v7_partialHydration',
    'the `fallbackElement` prop is gone: a root route `HydrateFallback` (or `hydrateFallbackElement`) renders during the initial load, and `useNavigation().state` stays "idle" during it. Without one, a router with initial loaders renders nothing until they finish.',
    /\bfallbackElement\b|\bhydrationData\b/,
    'initial-load fallbacks or hydration data',
  ),
  flagNote(
    'skip-action-error-revalidation',
    'v7_skipActionErrorRevalidation',
    'loaders no longer revalidate after an action returns or throws a 4xx/5xx result. An action that mutates data before failing needs `shouldRevalidate` to opt back in (`actionStatus`); otherwise validate before mutating. Choose per action.',
    /\b(?:ActionFunction(?:Args)?|useActionData)\b|<Route\b[^>]*\baction=|\baction\s*:\s*(?:async\b|\w+Action\b|\(|function\b)/,
    'route actions',
  ),
  {
    id: 'data-strategy',
    summary:
      'a custom `dataStrategy` or `patchRoutesOnNavigation` runs under the v7 contract: review its results (keyed by route id) and the `unstable_` names stabilized in 6.28, against the 7.x `DataStrategyFunction` type.',
    reported: ['decision'],
    applies(c) {
      const sites = where(
        routerFiles(c),
        /\b(?:unstable_)?(?:dataStrategy|patchRoutesOnNavigation|patchRoutesOnMiss)\b\s*[:,}]/,
      );
      return sites.length ? `custom data loading (${sites.join(', ')}): ${this.summary}` : false;
    },
  },
  {
    id: 'navigation-promises',
    summary:
      '`navigate()`, `submit()`, `fetcher.load/submit` and `revalidate()` return promises: a lint rule against floating promises now reports their calls, and a callback typed to return `void` may reject them.',
    reported: ['decision'],
    applies(c) {
      const lint = files(c).filter(
        (f) =>
          /(?:^|\/)(?:\.eslintrc[^/]*|eslint\.config\.[cm]?[jt]s)$/.test(f.file) &&
          /no-(?:floating|misused)-promises/.test(f.text),
      );
      const calls = where(routerFiles(c), /\buse(?:Navigate|Submit|Fetcher|Revalidator)\s*[<(]/);
      return lint.length && calls.length
        ? `${lint.map((f) => `\`${f.file}\``).join(', ')} enables no-floating-promises and the code navigates (${calls.join(', ')}): ${this.summary}`
        : false;
    },
  },
  {
    id: 'platform-minimums',
    summary: 'React Router 7 requires React 18 and Node 20.',
    reported: ['decision'],
    applies(c) {
      const found: string[] = [];
      for (const f of files(c)) {
        if (/(?:^|\/)package\.json$/.test(f.file)) {
          let pkg: Record<string, Record<string, string> | undefined>;
          try {
            pkg = JSON.parse(f.text);
          } catch {
            continue;
          }
          const react = pkg.dependencies?.react ?? pkg.peerDependencies?.react;
          const major = Number(/(\d+)/.exec(react ?? '')?.[1]);
          if (react && major < 18) found.push(`\`${f.file}\` declares react ${react}`);
          const node = pkg.engines?.node;
          const floor = Number(/(\d+)/.exec(node ?? '')?.[1]);
          if (node && floor < 20) found.push(`\`${f.file}\` declares node ${node}`);
        } else if (/(?:^|\/)\.(?:nvmrc|node-version)$/.test(f.file)) {
          const version = Number(/(\d+)/.exec(f.text)?.[1]);
          if (version < 20) found.push(`\`${f.file}\` pins Node ${f.text.trim()}`);
        }
      }
      return found.length ? `${found.join('; ')}: ${this.summary}` : false;
    },
  },
  {
    id: 'remix-router-package',
    summary:
      '`@remix-run/router` is folded into `react-router` and has no v7 release: import its names from `react-router` (`Router` is `DataRouter`, `Action` is `NavigationType`; the history factories and `createRouter` are internal) and remove the dependency.',
    reported: ['decision'],
    applies(c) {
      const declared = files(c).filter(
        (f) => /(?:^|\/)package\.json$/.test(f.file) && /"@remix-run\/router"\s*:/.test(f.text),
      );
      const imported = where(
        files(c).filter((f) => SOURCE.test(f.file)),
        /['"]@remix-run\/router['"]/,
      );
      const evidence = [...declared.map((f) => `\`${f.file}\` declares it`), ...imported];
      return evidence.length ? `${evidence.join(', ')}: ${this.summary}` : false;
    },
  },
  {
    id: 'dom-package',
    summary:
      '`react-router-dom` 7 only re-exports `react-router` and v8 removes it: once nothing imports it, remove the dependency.',
    reported: ['decision'],
    applies(c) {
      const declared = files(c).filter(
        (f) => /(?:^|\/)package\.json$/.test(f.file) && /"react-router-dom"\s*:/.test(f.text),
      );
      return declared.length
        ? `${declared.map((f) => `\`${f.file}\``).join(', ')} declares react-router-dom: ${this.summary}`
        : false;
    },
  },
  {
    id: 'also-review',
    summary: `Also review the [v6 to v7 upgrade guide](${guide}); React Router 8 is a separate upgrade from the latest 7.x, with its own future flags adopted on 7 first.`,
    reported: ['decision'],
  },
];
