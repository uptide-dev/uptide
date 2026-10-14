import { definePack } from '../contract.js';
import { lucideBehavior } from './behavior.js';
import { absoluteStrokeWidthSites, brandIconUseSites, renameIcon } from './detect.js';
import { BRAND_ICONS, BRAND_NAMES, LEGACY_EXPORTS, pathOf, quoted, RENAMES } from './names.js';

const docs = 'https://github.com/lucide-icons/lucide/blob/1.56.0';
const release = (version: string) =>
  `https://github.com/lucide-icons/lucide/releases/tag/${version}`;
const RENAMED = [...RENAMES.keys()];
const BRAND = [...BRAND_NAMES, ...Object.values(BRAND_ICONS)];

/**
 * lucide-react >=0 <1 → >=1 <2. Sources pinned at the 1.56.0 tag and read 2026-10-14; every
 * entry of the name map, its version and its evidence are in RESEARCH.md. 1.x changes the
 * icon set (brand icons removed), the build layout (no UMD, `.mjs` ESM files) and deprecates two
 * names; `LucideProps`, `LucideIcon`, `createLucideIcon(name, node)`, `DynamicIcon` and
 * `dynamicIconImports` keep their shapes.
 */
export const lucideReactPack = definePack({
  meta: {
    package: 'lucide-react',
    from: '>=0 <1',
    to: '>=1 <2',
    sources: [
      {
        title: 'Lucide for React: migration from v0 (1.56.0, read 2026-10-14)',
        url: `${docs}/docs/guide/react/migration.md`,
      },
      {
        title: 'Lucide Version 1 (1.56.0, read 2026-10-14)',
        url: `${docs}/docs/guide/version-1.md`,
      },
      {
        title: 'Brand logos statement (1.56.0, read 2026-10-14)',
        url: `${docs}/BRAND_LOGOS_STATEMENT.md`,
      },
      {
        title: 'Release 1.0.0, published unintentionally (read 2026-10-14)',
        url: release('1.0.0'),
      },
      { title: 'Release 1.0.1, Version 1 (read 2026-10-14)', url: release('1.0.1') },
      {
        title: 'Release 1.9.0, ESM bundles use .mjs (#4285, read 2026-10-14)',
        url: release('1.9.0'),
      },
      {
        title: 'Release 0.489.0, aria-hidden for decorative icons (#2158, read 2026-10-14)',
        url: release('0.489.0'),
      },
      {
        title: 'Icon metadata at 0.351.0 and 0.352.0 (renamed icons)',
        url: 'https://github.com/lucide-icons/lucide/tree/0.352.0/icons',
      },
      {
        title: 'Published declarations, lucide-react 0.577.0 and 1.56.0',
        url: 'https://registry.npmjs.org/lucide-react',
      },
    ],
    maintainer: 'uptide-dev',
  },
  defaultTarget: '1.56.0',
  // Deep imports of the build output are typed by local shims or not at all: a path 1.x no
  // longer ships compiles and fails in the bundler, so the consumer's build is the gate.
  requiresBuild: true,
  inventory: [
    'next.config.{js,mjs,ts,cjs,mts}',
    '**/*.{test,spec}.{ts,tsx,js,jsx}',
    '**/__tests__/**/*.{ts,tsx,js,jsx}',
  ],
  // Published together at one version by lucide's release workflow (matrix + lucide-static job).
  releaseGroup: [
    'lucide',
    'lucide-static',
    'lucide-react-native',
    'lucide-preact',
    'lucide-solid',
  ].map((name) => ({ name, source: `${docs}/.github/workflows/release.yml` })),
  rules: [
    {
      id: 'brand-icons-removed',
      summary:
        'brand icons (Github, Twitter, Linkedin, Youtube, Slack, Figma and 13 more) are removed in 1.x, with no replacement in lucide',
      severity: 'breaking',
      kinds: ['removed', 'type'],
      symbols: pathOf(BRAND),
      message: quoted(BRAND),
      // The compiler stops at the import; each use is a site the replacement must reach.
      detect: (text) => brandIconUseSites(text),
      guide:
        "Lucide 1.x removed every brand icon for legal reasons and will not add them back (BRAND_LOGOS_STATEMENT.md); there is no lucide icon with the same meaning, so never substitute one silently. This is a choice for the owner; make one and record it in decisions with the files and icons it covers: (a) the brand's official SVG from its brand asset page, or Simple Icons (simpleicons.org, same 24x24 viewBox), as a local component that accepts the same props the call sites pass (size, className, strokeWidth via LucideProps); (b) a brand icon package such as Simple Icons, which adds a dependency; (c) a generic lucide icon (Globe, Link, Mail, MessageCircle) only where the logo was decorative, which changes what users see. Keep the import name the call sites use, re-exported names and alt text/aria labels as they are. Do not copy the 0.x lucide brand paths back.",
    },
    {
      id: 'renamed-icons',
      summary:
        'icon names dropped in 0.x have a 1.x name with the same glyph: SquareGantt and GanttSquare are SquareChartGantt, SquareKanbanDashed is SquareDashedKanban, MousePointerSquare is SquareMousePointer',
      severity: 'breaking',
      kinds: ['removed', 'type'],
      symbols: pathOf(RENAMED),
      message: quoted(RENAMED),
      rewrite: (text, finding) => renameIcon(text, finding),
      guide:
        'Import the 1.x name and keep the old one as the local or exported name (`import { SquareChartGantt as SquareGantt }`, `export { SquareChartGantt as SquareGantt } from "lucide-react"`), so no use of the binding and no public export changes. The Icon-suffixed and Lucide-prefixed forms map the same way (SquareGanttIcon → SquareChartGanttIcon, LucideSquareGantt → LucideSquareChartGantt). Map: SquareGantt, GanttSquare → SquareChartGantt; SquareKanbanDashed → SquareDashedKanban; MousePointerSquare → SquareMousePointer; AlignHorizonalDistributeCenter/End/Start → AlignHorizontalDistributeCenter/End/Start. Kebab names (DynamicIcon, dynamicIconImports): square-gantt and gantt-square → square-chart-gantt, square-kanban-dashed → square-dashed-kanban, mouse-pointer-square → square-mouse-pointer.',
    },
    {
      id: 'legacy-exports',
      summary:
        '`createReactComponent` (removed in 0.105.0) and the `JerseyPound` icon (removed in 0.16.19) have no drop-in export in 1.x',
      severity: 'breaking',
      kinds: ['removed', 'type'],
      symbols: pathOf(LEGACY_EXPORTS),
      message: quoted(LEGACY_EXPORTS),
      guide:
        '`createReactComponent(name, node)` is `createLucideIcon(name, node)`: the node is typed (`LucideIconNode[]`: `[tag, attributes]` tuples) and the result is a forwardRef component (`LucideIcon`), so fix the node literal rather than casting it. `JerseyPound` was removed without a successor: choose an icon with the owner and record it in decisions (PoundSterling is a different glyph).',
    },
    {
      id: 'absolute-stroke-width',
      summary:
        '`absoluteStrokeWidth` is deprecated in favor of `nonScalingStroke`, which is not the same rendering',
      severity: 'deprecated',
      kinds: [],
      symbols: /$^/,
      detect: (text) => absoluteStrokeWidthSites(text),
      guide:
        '`absoluteStrokeWidth` still works in 1.x (deprecated). It scales `stroke-width` by 24/size; `nonScalingStroke` sets `vector-effect="non-scaling-stroke"` on the paths, which also holds the width when CSS or a transform resizes the icon. This is a choice; record it in decisions with the files: keep `absoluteStrokeWidth` (no visual change, deprecated) or switch to `nonScalingStroke` after checking icons sized by CSS. Never set both. The same applies to `LucideProvider`.',
    },
    {
      id: 'icon-node-type',
      summary: '`IconNode` is deprecated: it is `LucideIconNode[]`',
      severity: 'deprecated',
      kinds: ['deprecated'],
      symbols: /^IconNode$/,
      guide:
        '`IconNode` is exactly `LucideIconNode[]` in 1.x: import the type `LucideIconNode` from "lucide-react" and write `LucideIconNode[]`. Its element is `[tag, attributes]` or `[tag, attributes, children]` with SVG attribute types instead of `Record<string, string>`: code that reads attributes as `string` may need a check for `undefined`, not a cast.',
    },
  ],
  behavior: lucideBehavior,
  instructions:
    'Sources pinned at lucide 1.56.0, read 2026-10-14; see RESEARCH.md. Migrate only the reported site. Keep local and exported names, props, accessible names and rendering as they are. Never cast an icon map or an icon name to any, never pin an icon to a 0.x copy, and never substitute a different icon without recording it in decisions.',
});
