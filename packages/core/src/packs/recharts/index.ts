import { definePack, type PackRule } from '../contract.js';
import { alwaysShowToIfOverflow, removeAttributes } from './jsx.js';

/**
 * recharts >=2 <3 → >=3 <4. Taken from the official 3.0 migration guide (the recharts wiki,
 * read 2026-10-13), the guides it links on recharts.github.io (activeIndex, Cell) and the
 * `@deprecated` notes in the 3.x type declarations (`Cell`, `Pie.activeShape`). What the
 * compiler rejects is `breaking`, what it strikes through is `deprecated`, and what compiles
 * and renders differently is a behavior note. Recharts ships no codemod for this major.
 *
 * Not in the guide, so not a rule: the 3.x declarations also narrowed the SVG props of
 * `ReferenceArea` (`fill`, `strokeWidth`), dropped `Bar.layout`, widened `dataKey` to include
 * `symbol` and changed the typing of `Label`, `LabelList` and `tick` render functions. Those
 * sites are reported by `check` and are `generic` in the ground truth.
 */

const rules: PackRule[] = [
  {
    id: 'categorical-chart-state',
    summary:
      '`CategoricalChartState` no longer exists: mouse handlers get `activeCoordinate`, `activeLabel` and `activeTooltipIndex`, not `chartX`, `chartY` or `activePayload`',
    severity: 'breaking',
    kinds: ['removed', 'type', 'signature', 'required', 'cause'],
    symbols: /^(?:CategoricalChartState|MouseHandlerDataParam|TS(?:2305|2339|2345))$/,
    message: /CategoricalChartState|MouseHandlerDataParam|\b(?:chartX|chartY|activePayload)\b/,
    guide:
      'Recharts 3 removed the internal `CategoricalChartState` that `Customized` and the chart mouse handlers received. A handler now gets the tooltip state (`activeCoordinate`, `activeLabel`, `activeTooltipIndex`, `isTooltipActive`); `chartX` and `chartY` are not there, so take the pointer position from `activeCoordinate`, or from the native event when the code needs the pixel under the cursor, and rebuild `activePayload` from your own data with the active index or label. `useActiveTooltipLabel` is the one hook the guide names for reading the state elsewhere. `chart.setState` and refs to the chart instance no longer reach any state: replace the pattern with the controlled `active` and `defaultIndex` props of `Tooltip`. Keep what the handler does for the user (zoom brush, click drill-down, pinned tooltip) as it is.',
  },
  {
    id: 'tooltip-content-props',
    summary:
      'a custom `Tooltip` content typed with `TooltipProps` (or `ComponentProps<typeof Tooltip>`) no longer has `payload`, `label`, `active` or `coordinate`: type it with `TooltipContentProps`',
    severity: 'breaking',
    kinds: ['removed', 'type', 'signature', 'required', 'cause'],
    symbols: /^(?:TooltipProps|TooltipContentProps|TS(?:2339|2344|2741))$/,
    message:
      /(?:\b(?:payload|label|active|coordinate|accessibilityLayer)\b.*(?:Tooltip|PropertiesReadFromContext|DefaultTooltipContent))|(?:Tooltip.*\b(?:payload|label)\b)/s,
    guide:
      'Since 3.0, `Tooltip` reads `payload`, `label`, `active`, `coordinate` and `accessibilityLayer` from its context and hands them only to the component given as `content`. Type that component with `TooltipContentProps` (not `TooltipProps`, which describes the props of `<Tooltip>` itself); `TooltipContentProps.label` is `undefined | string | number`, so a function that took a string must accept the other two. When the type is also used to describe `<Tooltip>` props, keep `TooltipProps` for those and add `TooltipContentProps` for the content. Errors about implicit `any` parameters further down the same component (`payload.filter((item) => ...)`) have this one cause: fix the props type once, then recompile.',
  },
  {
    id: 'legend-payload',
    summary:
      'the `payload` prop of `Legend` was an internal prop and is gone: a custom legend content is typed with `DefaultLegendContentProps` and is given `payload` by the legend',
    severity: 'breaking',
    kinds: ['removed', 'type', 'signature', 'required', 'cause'],
    symbols: /^(?:Legend(?:Props)?|TS(?:2344|2741))$/,
    message: /Property 'payload' (?:does not exist|is missing)|"payload" \| "verticalAlign"/,
    guide:
      'The guide lists `Legend` `payload` among the internal props removed in 3.0. A component rendered as `Legend` `content` is still given the entries, but typed by `DefaultLegendContentProps` (or the `LegendPayload` entries it carries), not by `Pick<LegendProps, "payload" | ...>`. A wrapper that rendered `<ChartLegendContent />` with no props and relied on the legend to fill `payload` in must accept the props from `DefaultLegendContentProps` and read `payload` from them. Do not pass `payload` to `<Legend>`: build the entries in the content component or with `formatter`. Legend order has no promised default, see the behavior notes.',
  },
  {
    id: 'active-index',
    summary:
      '`activeIndex` was removed from `Bar`, `Pie`, `Scatter` and the other graphical items: highlight with `Tooltip` (`defaultIndex`) or with the `shape` prop and its `index`',
    severity: 'breaking',
    kinds: ['removed', 'type', 'signature', 'required'],
    symbols: /^(?:Bar|Pie|Scatter|Radar|RadialBar|Funnel|Line|Area)(?:Props)?$|^TS2(?:322|769)$/,
    message: /Property 'activeIndex' does not exist/,
    guide:
      'Recharts 3 removed `activeIndex` from `Scatter`, `Bar`, `Pie` and the other graphical items (guide: https://recharts.github.io/en-US/guide/activeIndex). To keep an item highlighted, draw it differently in the `shape` render function, which is given the item `index`, and compare it with the index you want (`index === activeIndex`); for the hovered item use the `Tooltip` props `defaultIndex` and `active`. `activeBar` and `activeShape` follow the same move to `shape`. Keep the highlighted element, its size and its colors as they are.',
  },
  {
    id: 'internal-props',
    summary:
      'props that only passed internal state were removed (`Scatter` `points`, `Area` `points`, `ResponsiveContainer` `ref.current.current`)',
    severity: 'breaking',
    kinds: ['removed', 'type', 'signature'],
    symbols: /^(?:Scatter|Area)(?:Props)?$/,
    message: /Property 'points' does not exist/,
    guide:
      'Recharts 2 passed its internal state to the graphical items through cloned props, and documented a few of them as public. 3.0 removed them (`Scatter` `points`, `Area` `points`) and `ref.current.current` of `ResponsiveContainer`: they did nothing when a consumer passed them, so remove the prop. A consumer that read them from a ref has no replacement; say so instead of inventing one.',
  },
  {
    id: 'pie-blend-stroke',
    summary: '`Pie` `blendStroke` was removed: use `stroke="none"`',
    severity: 'breaking',
    kinds: ['removed', 'type', 'signature'],
    symbols: /^Pie(?:Props)?$/,
    message: /Property 'blendStroke' does not exist/,
    guide:
      '`blendStroke` was removed from `Pie`; the guide recommends `stroke="none"`. Replace `blendStroke` with `stroke="none"` on the same `Pie` and keep a `stroke` the code already sets on its `Cell`s or sectors.',
  },
  {
    id: 'always-show',
    summary: 'the deprecated `alwaysShow` prop of the reference elements was removed',
    severity: 'breaking',
    kinds: ['removed', 'type', 'signature'],
    symbols: /^(?:ReferenceLine|ReferenceDot|ReferenceArea)(?:Props)?$/,
    message: /Property 'alwaysShow' does not exist/,
    guide:
      '`alwaysShow` was removed from `ReferenceLine`, `ReferenceDot` and `ReferenceArea`; its replacement has been `ifOverflow="extendDomain"` since 2.x (the 2.x declarations say so). A computed `alwaysShow` or an element that already sets `ifOverflow` needs a decision.',
    rewrite: (text, finding) => alwaysShowToIfOverflow(text, finding.usage),
  },
  {
    id: 'unused-props',
    summary:
      '`isFront` of the reference elements and `animateNewValues` of `Area` and `Funnel` were removed: they did nothing',
    severity: 'breaking',
    kinds: ['removed', 'type', 'signature'],
    symbols: /^(?:ReferenceLine|ReferenceDot|ReferenceArea|Area|Funnel)(?:Props)?$/,
    message: /Property '(?:isFront|animateNewValues)' does not exist/,
    guide:
      'The guide says `isFront` has done nothing since before 2.0 and that `animateNewValues` on `Area` and `Funnel` was unused. Remove the attribute; nothing replaces it.',
    rewrite: (text, finding) =>
      removeAttributes(text, finding.usage, {
        ReferenceLine: ['isFront'],
        ReferenceDot: ['isFront'],
        ReferenceArea: ['isFront'],
        Area: ['animateNewValues'],
        Funnel: ['animateNewValues'],
      }),
  },
  {
    id: 'cell',
    summary:
      '`Cell` is deprecated and will be removed in Recharts 4: per-item colors go in the `shape` or `content` prop of the chart item',
    severity: 'deprecated',
    kinds: ['deprecated'],
    symbols: /^Cell$/,
    guide:
      'The 3.x declarations mark `Cell` deprecated ("will be removed in Recharts 4.0") and point to https://recharts.github.io/en-US/guide/cell/: give the chart item a `shape` (or `content`) render function that picks the color from the data point it is given, instead of a `Cell` child per point. It still works in 3.x; migrate it when the colors are touched anyway.',
  },
  {
    id: 'pie-active-shape',
    summary:
      '`Pie` `activeShape` and `inactiveShape` are deprecated: one `shape` function draws every sector and is told which one is active',
    severity: 'deprecated',
    kinds: ['deprecated'],
    symbols: /(?:^|[#.])(?:activeShape|inactiveShape)$/,
    guide:
      'The 3.x declarations deprecate `Pie` `activeShape` and `inactiveShape` ("use the `shape` prop to create each sector; `isActive` designates the active shape"). Move the drawing of the active sector into `shape`, which is given the sector props and its `index`, keep the inactive drawing in the same function, and drop `activeIndex` (removed, see the `active-index` rule).',
  },
];

export const rechartsPack = definePack({
  meta: {
    package: 'recharts',
    from: '>=2 <3',
    to: '>=3 <4',
    sources: [
      {
        title: 'Recharts 3.0 migration guide',
        url: 'https://github.com/recharts/recharts/wiki/3.0-migration-guide',
      },
      {
        title: 'Recharts guide: activeIndex',
        url: 'https://recharts.github.io/en-US/guide/activeIndex',
      },
      {
        title: 'Recharts guide: migrate from Cell to the shape prop',
        url: 'https://recharts.github.io/en-US/guide/cell/',
      },
      { title: 'Recharts releases', url: 'https://github.com/recharts/recharts/releases' },
    ],
    maintainer: '@uptide-dev',
  },
  defaultTarget: '3.9.1',
  rules,
  behavior: [
    {
      id: 'accessibility-layer',
      summary:
        '`accessibilityLayer` is on by default: charts are keyboard-focusable and browsers paint a focus ring on click; pass `accessibilityLayer={false}` to keep the old behavior, and keyboard events are no longer passed to `onMouseMove`',
      reported: ['decision'],
    },
    {
      id: 'render-order-z-index',
      summary:
        'the stacking of `Tooltip`, `Legend` and the chart items follows JSX order now (SVG has no z-index): put the element that must be on top last, for example `Tooltip` below `Legend` in the JSX',
      reported: ['decision'],
    },
    {
      id: 'legend-order',
      summary:
        'the default order of the legend entries may differ and no order is promised: pin it explicitly when the order is part of the design',
      reported: ['decision'],
    },
    {
      id: 'axes-rendering',
      summary:
        '`XAxis` and `YAxis` draw their axis line even when there are no ticks, and multiple `YAxis` render alphabetically by `yAxisId`, not in JSX order',
      reported: ['decision'],
    },
    {
      id: 'cartesian-grid-axis-id',
      summary:
        '`CartesianGrid` now follows the axis named by its `xAxisId` and `yAxisId` (default ids): with axes that have another id the grid lines do not render until the grid names them',
      reported: ['decision'],
    },
    {
      id: 'area-null-values',
      summary:
        '`Area` with `connectNulls` treats `null` data points as 0, and `ErrorBar` ignores nullish values when it computes the Y domain: charts with gaps in their data draw differently',
      reported: ['decision'],
    },
    {
      id: 'scatter-tooltip-colors',
      summary:
        'the `Tooltip` of a `Scatter` chart now applies the series colors by default, and a `Label` wrapped in a custom component is found only when it sets `displayName = "Label"`',
      reported: ['decision'],
    },
    {
      id: 'customized-props',
      summary:
        '`Customized` no longer passes the chart state to the component it renders (its props were the internal state): read what the component needs from hooks or from its own data, or render the component directly, which 3.0 allows',
      reported: ['decision'],
    },
    {
      id: 'environment-requirements',
      summary:
        'Recharts 3 needs React 16.8 or newer, TypeScript 5 or newer with `target` es6 and Node.js 18 or newer; `recharts-scale` and `react-smooth` are no longer dependencies (`getNiceTickValues` is exported by `recharts`), and a package that imports them directly must depend on them itself',
      reported: ['decision'],
    },
  ],
  instructions:
    'Migrate only the reported site to Recharts 3, from the compiler error and the guide above. Keep what the chart shows and how it reacts to the pointer (tooltip, zoom, click, highlighted item) exactly as it is. Never cast a handler argument or a props type to `any`, add `// @ts-expect-error` or delete a chart option to make it compile. If the site needs a decision the guide leaves open (which element should stay on top, whether a legend order is part of the design), say so instead of choosing.',
});
