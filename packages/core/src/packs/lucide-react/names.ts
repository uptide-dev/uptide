/**
 * The exact export map of lucide-react 0.x → 1.x, taken from lucide's own published
 * declarations and icon metadata (RESEARCH.md has the provenance of every entry). Every icon is
 * exported three ways: `Github`, `GithubIcon` and `LucideGithub`.
 */

/** The three exported forms of one icon name. */
export function forms(name: string): string[] {
  return [name, `${name}Icon`, `Lucide${name}`];
}

/**
 * Brand icons removed in 1.0.1 (the lucide-react 1.0.0 tarball still shipped them; its release
 * notes call it unintentional). Kebab names are the `DynamicIcon`/`dynamicIconImports` keys and
 * the `dist/esm/icons/<name>` files. No replacement exists in lucide.
 */
export const BRAND_ICONS: Readonly<Record<string, string>> = {
  Chrome: 'chrome',
  Chromium: 'chromium',
  Codepen: 'codepen',
  Codesandbox: 'codesandbox',
  Dribbble: 'dribbble',
  Facebook: 'facebook',
  Figma: 'figma',
  Framer: 'framer',
  Github: 'github',
  Gitlab: 'gitlab',
  Instagram: 'instagram',
  Linkedin: 'linkedin',
  Pocket: 'pocket',
  RailSymbol: 'rail-symbol',
  Slack: 'slack',
  Trello: 'trello',
  Twitch: 'twitch',
  Twitter: 'twitter',
  Youtube: 'youtube',
};

/**
 * Names removed during 0.x whose icon still exists under another name in every 1.x release, with
 * the same glyph at the release that dropped the old name. The target is the 1.x canonical name.
 * `forms` applies to both sides: `SquareGanttIcon` is `SquareChartGanttIcon`.
 */
export const RENAMED_ICONS: Readonly<Record<string, string>> = {
  // Dropped in 0.352.0 (aliases of GanttChartSquare, renamed SquareGanttChart, now SquareChartGantt).
  SquareGantt: 'SquareChartGantt',
  GanttSquare: 'SquareChartGantt',
  // Dropped in 0.352.0 (alias of KanbanSquareDashed, renamed SquareDashedKanban).
  SquareKanbanDashed: 'SquareDashedKanban',
  // Renamed in 0.352.0 without keeping the old name (icons/mouse-pointer-square.json moved).
  MousePointerSquare: 'SquareMousePointer',
  // Misspelled names fixed in 0.17.13; only the bare form existed then.
  AlignHorizonalDistributeCenter: 'AlignHorizontalDistributeCenter',
  AlignHorizonalDistributeEnd: 'AlignHorizontalDistributeEnd',
  AlignHorizonalDistributeStart: 'AlignHorizontalDistributeStart',
};

/** Every old exported name with its 1.x replacement, all three forms. */
// shared-state: not TS-dependent
export const RENAMES: ReadonlyMap<string, string> = new Map(
  Object.entries(RENAMED_ICONS).flatMap(([from, to]) => {
    const old = forms(from);
    const now = forms(to);
    return old.map((name, i) => [name, now[i] as string] as const);
  }),
);

/** Kebab names of the renamed icons (dynamicIconImports keys and dist files before 0.352.0). */
export const RENAMED_KEBAB: Readonly<Record<string, string>> = {
  'square-gantt': 'square-chart-gantt',
  'gantt-square': 'square-chart-gantt',
  'square-kanban-dashed': 'square-dashed-kanban',
  'mouse-pointer-square': 'square-mouse-pointer',
};

/** Exports removed in 0.16.19 (JerseyPound) and 0.105.0 (createReactComponent) with no drop-in: an assisted rule, never a rename. */
export const LEGACY_EXPORTS: readonly string[] = ['createReactComponent', 'JerseyPound'];

export const BRAND_NAMES: readonly string[] = Object.keys(BRAND_ICONS).flatMap(forms);

function alternation(names: readonly string[]): string {
  return [...names].sort((a, b) => b.length - a.length).join('|');
}

/** A compiler message that names one of `names` as a quoted identifier or string. */
export function quoted(names: readonly string[]): RegExp {
  return new RegExp(`['"](?:${alternation(names)})['"]`);
}

/** A finding path that is one of `names`, bare or as a member (`icons.Github`, `default#github`). */
export function pathOf(names: readonly string[]): RegExp {
  return new RegExp(
    `^(?:TS(?:2305|2339|2322|2345|2614|2694|2724|7053)|LucideIcon|(?:[\\w$]+[.#])?(?:${alternation(names)}))$`,
  );
}
