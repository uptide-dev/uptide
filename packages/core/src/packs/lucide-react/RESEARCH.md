# lucide-react 0.x → 1.x: evidence and verification limits

Read date for every source below: **2026-10-14**. Scope: any 0.x release (0.15.1 to 0.577.0)
to any 1.x release, pinned at **1.56.0** (published 2026-10-13, the latest at the read date).
lucide-react has no hand-written changelog; the map below is built from lucide's own guides,
release notes, icon metadata and published declarations, not from memory.

## Source ledger

- Migration guides at tag 1.56.0 (`440a1e1dfb1e712505308da46bead3c28b1f1398`):
  [Lucide for React: migration from v0](https://github.com/lucide-icons/lucide/blob/1.56.0/docs/guide/react/migration.md),
  [Lucide Version 1](https://github.com/lucide-icons/lucide/blob/1.56.0/docs/guide/version-1.md),
  [brand logos statement](https://github.com/lucide-icons/lucide/blob/1.56.0/BRAND_LOGOS_STATEMENT.md).
- Release notes: [1.0.0](https://github.com/lucide-icons/lucide/releases/tag/1.0.0) ("published
  unintentionally", corrected by 1.0.1), [1.0.1](https://github.com/lucide-icons/lucide/releases/tag/1.0.1)
  (What's new in Version 1), [1.9.0](https://github.com/lucide-icons/lucide/releases/tag/1.9.0)
  (#4285 "use .mjs for ESM bundles"), [0.489.0](https://github.com/lucide-icons/lucide/releases/tag/0.489.0)
  (#2158 "added aria-hidden fallback for decorative icons"),
  [0.352.0](https://github.com/lucide-icons/lucide/releases/tag/0.352.0) (does not list its renames).
- Icon metadata (`icons/*.json`) at tags 0.351.0, 0.352.0, 0.577.0 (`0ea8780434e2b4527dc860b18ff94883d080b59c`)
  and 1.56.0: aliases, `deprecated`, `deprecationReason`, `toBeRemovedInVersion`.
- Source at 1.56.0: `packages/lucide-react/src/{Icon.ts,types.ts,context.ts}`,
  `packages/shared/src/build/{buildLucideIconNode.ts,types.ts}`,
  `.github/workflows/release.yml` (packages published at one version).
- Published packages (npm registry, scripts never run, nothing executed): the declarations
  `dist/lucide-react.d.ts`, `dynamic.d.ts`, `dynamicIconImports.d.ts` and the `dist/` layout of
  lucide-react 0.577.0, 1.0.0, 1.0.1, 1.8.0, 1.9.0 and 1.56.0; the exported names of 326 0.x
  releases (every second release from 0.15.1, the first with declarations, plus every release
  around a removal: 0.16.18–0.16.20, 0.17.12–0.17.14, 0.104.1–0.105.0, 0.347.0–0.352.0); and
  `dist/esm/Icon.js` of 0.460.0–0.500.0 (bisected to 0.489.0 for `aria-hidden`).
  No codemod exists for this upgrade; none was run.

## The exact export map

Exported names of each sampled 0.x release minus those of 1.56.0. Every icon is exported three
ways (`Github`, `GithubIcon`, `LucideGithub`); the counts below are per form.

| 0.x names | Last in | 1.x | Evidence |
| --- | --- | --- | --- |
| Chrome, Chromium, Codepen, Codesandbox, Dribbble, Facebook, Figma, Framer, Github, Gitlab, Instagram, Linkedin, Pocket, RailSymbol, Slack, Trello, Twitch, Twitter, Youtube (57 exports) | 1.0.0 | **removed, no replacement** | 0.577.0 marks each `@deprecated … will be removed in v1.0` (`deprecationReason: icon.brand`); 1.0.1 removes them. The React guide lists 14 of them; the declarations show 19 (Chrome is an alias of Chromium; Trello, Twitch, Twitter, Youtube are not in the guide's list). |
| SquareGantt, GanttSquare (+ forms) | 0.351.0 | SquareChartGantt | `gantt-chart-square.json` at 0.351.0 has aliases `gantt-square`, `square-gantt`; at 0.352.0 the icon is `square-gantt-chart.json` with only `gantt-chart-square`; 1.56.0 exports SquareChartGantt (SquareGanttChart and GanttChartSquare stay aliases). Glyph identical across the rename. |
| SquareKanbanDashed (+ forms) | 0.351.0 | SquareDashedKanban | `kanban-square-dashed.json` (alias `square-kanban-dashed`) becomes `square-dashed-kanban.json` (alias `kanban-square-dashed`) at 0.352.0. Glyph identical. |
| MousePointerSquare (+ forms) | 0.351.0 | SquareMousePointer | `mouse-pointer-square.json` is moved to `square-mouse-pointer.json` at 0.352.0 with the same contributors, tags and alias (`inspect`); the old name is not kept. Glyph identical. Not to be confused with MousePointerSquareDashed, which survives as an alias of SquareDashedMousePointer. |
| AlignHorizonalDistributeCenter/End/Start | 0.17.12 | AlignHorizontal… | Misspelling fixed in 0.17.13; the modules are identical apart from the name. Only the bare form existed. |
| createReactComponent | 0.104.1 | createLucideIcon, not drop-in | 0.105.0 replaced it; the node is typed and the result is a forwardRef component. |
| JerseyPound | 0.16.18 | removed, no replacement | Removed in 0.16.19; PoundSterling is a different glyph. |

Nothing else is removed. In particular the 265 aliases that 0.577.0's metadata marks
`toBeRemovedInVersion: v1.0` (Home, AlertTriangle, …) are **all still exported by 1.56.0**: the
metadata planned their removal, the release did not do it, and no rename is needed for them.
The `default` and `dynamicIconImports` exports that 0.260.0 alone had on the main entry are a
packaging accident of one release and are not mapped.

## Classified changes

**M** = mechanical rule (rewrite), **A** = assisted rule (guide for the agent), **B** = behavior
note, **N** = not compiler-visible and no action.

| Change | Class and treatment | Source |
| --- | --- | --- |
| 19 brand icons removed (57 exports, and their kebab keys in `dynamicIconImports`/`DynamicIcon`) | A `brand-icons-removed`: the compiler sees named imports (TS2305/TS2724), members (TS2339), keys (TS7053) and names (TS2322). The guide offers official SVG, a brand package, or a generic icon; the choice goes to decisions. Never guessed. | guide, brand statement, declarations |
| Renamed 0.x names (SquareGantt, GanttSquare, SquareKanbanDashed, MousePointerSquare, AlignHorizonal*) | M `renamed-icons`: on an import or re-export line, the specifier takes the 1.x name and keeps the old one as local/exported name (`SquareChartGantt as SquareGantt`); members of a lucide namespace or `icons` (`Icons.SquareGantt`, `icons['SquareGantt']`) are renamed in place. Declines when the same line also has an icon without replacement, and for anything not bound to lucide. | metadata 0.351.0/0.352.0, declarations |
| createReactComponent, JerseyPound | A `legacy-exports` | declarations 0.104.1/0.105.0, 0.16.18/0.16.19 |
| Removed icons reached by name through a cast, a deep import of the icon file, or data (`{ icon: 'github' }`) | B `untyped-icon-names` (finding, breaking): syntactic, binding-aware; typed lookups are left to the compiler | declarations; React crashes on an undefined element type |
| `absoluteStrokeWidth` deprecated for `nonScalingStroke` (1.x) | A `absolute-stroke-width` (deprecated, detect): not reported by the type diff (a JSX prop); not a rename, since one scales `stroke-width` by 24/size and the other sets `vector-effect`. The choice goes to decisions. | `shared/src/build/buildLucideIconNode.ts`, `types.ts` at 1.56.0 |
| `IconNode` deprecated: `LucideIconNode[]`, element now `[tag, attrs]` or `[tag, attrs, children]` with SVG attribute types | A `icon-node-type` (deprecated); a stricter element type is a compiler error the generic tier reports | `types.ts` at 1.56.0 |
| UMD build removed (1.0.1); ESM files `.js` → `.mjs` (1.9.0); `defaultAttributes` module gone from `dist/esm` | B `deep-imports` (finding + decision, `requiresBuild`): `lucide-react/dist/...` specifiers and Next `modularizeImports` strings. Extensionless paths still resolve where the bundler tries `.mjs`; alias files (`home.mjs`) still exist | release notes, tarball layout |
| `aria-hidden="true"` by default on icons without an accessible name (0.489.0) | B `aria-hidden-default` (decision + test follow-up), only when the installed version is below 0.489.0, naming test files that query by role or snapshot | release notes 0.489.0, `Icon.js` of 0.488.0/0.489.0 |
| `LucideProvider` and `useLucideContext` added; `Icon` reads the context and carries `'use client'` | N: additive; icons in Server Components render as client components with the same props | `Icon.ts`, `context.ts` at 1.56.0 |
| `createLucideIcon(icon: LucideIconData)` overload, `Icon` accepts `icon` | N: additive; the `(name, node)` signature is unchanged | declarations |
| `@types/react` becomes an optional peer | N | manifest 1.56.0 |
| `LucideProps`, `LucideIcon`, `DynamicIcon`, `IconName`, `iconNames`, `dynamicIconImports` | N: same shapes; `IconName` loses the brand keys (covered above) | `dynamic.d.ts` 0.577.0 vs 1.56.0 |
| `lucide-vue-next` renamed `@lucide/vue`, Angular package | N: other packages | version-1.md |

## Release group

Declared `releaseGroup`: `lucide`, `lucide-static`, `lucide-react-native`, `lucide-preact`,
`lucide-solid`. `release.yml` at 1.56.0 sets one version for its matrix (lucide, lucide-react,
lucide-react-native, lucide-preact, lucide-solid, @lucide/*) and for lucide-static, and the
registry has each of them at 1.56.0. Not declared: `lucide-vue-next`, `lucide-svelte`,
`lucide-angular` (renamed packages whose last release is 1.0.0/1.0.1), `@lucide/lab` (own
versioning), and the `@lucide/*` framework packages (not installed next to lucide-react).
lucide-react has no peer on another lucide package.

`requiresBuild: true`: deep imports are typed by local shims or not at all, so a path 1.x no
longer ships (`.js`, `dist/umd`, a brand icon file) compiles and fails in the bundler.

## Independent ground truth

Three public, single-package Next.js applications with npm lockfiles. Each parent was fetched
shallow at its pinned commit and installed from its own lockfile with lifecycle scripts off;
nothing from a repository was built, tested or run, and nothing was pushed, commented or opened
on any of them. Expectations were drafted with `pnpm packs:truth` (each repository's own
TypeScript 5.9.3, the target linked as an install would) and the merged upgrade diff, then
reviewed by hand before the first score. They were not changed after scoring.

| Repository | Parent | Merged upgrade | Versions | Expected |
| --- | --- | --- | --- | --- |
| [tradeblocks-org/tradeblocks](https://github.com/tradeblocks-org/tradeblocks/pull/530) | `918c0dadccacec7e0533ea1a208f252562ac711f` | `df0669aa473bd825ca47a3e7d1e9a6df875313b2` | 0.577.0 → 1.52.0 | `Github` import (TS2305) and its two JSX uses, replaced by @tabler/icons-react |
| [spizeck/SFPCA](https://github.com/spizeck/SFPCA/commit/e0e06ada6ed4e4b6d501b7882d74f9622dedc678) | `7f5b9dcb8985260e7b9ab345be971b392bd129a5` | `e0e06ada6ed4e4b6d501b7882d74f9622dedc678` | 0.563.0 → 1.47.0 | `Facebook`/`Instagram`/`Twitter` imports in two files (TS2305) and their six JSX uses, replaced by local Simple Icons components |
| [cubicsteak/keep](https://github.com/cubicsteak/keep/commit/cc8fb5147d1f28fc46d5a8239b1bb648975df546) | `9380d10ea22b66e4559779d7cc3afb4f209cf198` | `cc8fb5147d1f28fc46d5a8239b1bb648975df546` | 0.483.0 → 1.47.0 | none: negative control, 45 files import lucide-react, no new diagnostic, no source change |

Sites follow docs/packs.md: one per change, so a JSX use the upgrade rewrote apart from the
import is its own site. SFPCA's renames of `Trash2`, `HelpCircle`, `CheckCircle`, `XCircle` and
`Loader2` are **not** sites: 1.47.0 still exports each of them (aliases of Trash,
CircleQuestionMark, CircleCheckBig, CircleX, LoaderCircle), undeprecated, and its compiler
reports nothing there; the repository chose to rename them.

### Screened out

Found by searching merged upgrade commits read-only (blobless clones, `git log`/`show` only):

- [elie222/inbox-zero](https://github.com/elie222/inbox-zero/pull/2180) (0.577.0 → 1.7.0,
  replaces `ChromeIcon`, `SlackIcon`): the app is `apps/web` in a pnpm workspace with only a
  root lockfile, which the ground-truth installer refuses (`UNSUPPORTED_PACKAGE_MANAGER`).
- [mfts/papermark](https://github.com/mfts/papermark/pull/2132) (0.577.0 → 1.7.0, replaces
  `Youtube`): its lockfile is out of sync at the parent (`npm ci` refuses), and the unfrozen
  install needs `cdn.sheetjs.com`, which this environment's network policy denies.
- coders-clan/wishscene, botho-project/botho: workspace subdirectories with a root lockfile.
- Hardonian/ReadyLayer: the upgrade commit is a bare bump that broke the build; the fix is a
  later commit mixed with unrelated changes.
- lobehub/lobe-chat: no lockfile. mtrifilo/matttrifilo.com (bun): usable, not needed.
- Twelve further merged upgrades were pure version bumps (manifest and lockfile only); one of
  them is the negative control above.

## Measured pack test

`pnpm uptide pack test lucide-react --write`: **verified**, 3 public repositories.

| Rule / scoring group | Precision | Recall | TP | FP | FN |
| --- | ---: | ---: | ---: | ---: | ---: |
| brand-icons-removed | 100% | 100% | 11 | 0 | 0 |
| Overall sites | 100% | 100% | 11 | 0 | 0 |
| Breaking sites | 100% | 100% | 11 | 0 | 0 |

The first score, before `brand-icons-removed` had its `detect`, was 3 TP, 0 FP, 8 FN (27%
recall): `check` reports the uses of a removed import only as information, and the compiler
stops at the import. The rule now finds every use of a brand icon imported from lucide-react by
the import's symbol (a shadowing parameter of the same name is not one), which is where the
component is undefined at runtime. The ground truth was not changed.

Not measured by public ground truth: `renamed-icons` (its names were dropped in 0.352.0 and
earlier; no public 0.x → 1.x upgrade from before 0.352.0 was found), `legacy-exports`,
`absolute-stroke-width`, `icon-node-type`, `untyped-icon-names`, `deep-imports` and the
`aria-hidden-default` decision. Fixtures (6 cases, 33 sites, each with sites to leave alone)
and unit tests cover them; the negative control shows none of them fires on 45 ordinary
lucide files.

## What the engine cannot express

- **Uses of a removed import.** `check` reports them at information level, so `fix` never
  selects them; the pack's own `detect` is what makes them sites. The rename at an import
  therefore aliases (`SquareChartGantt as SquareGantt`) instead of renaming every use: those
  uses are not reported sites and must not be edited.
- **Deep imports by target version.** A `detect` has no target version, so a `.js` deep import
  (broken only from 1.9.0) cannot be breaking for 1.9+ and silent for 1.0–1.8: it is a
  `deprecated` finding with a decision, and `requiresBuild` is the gate.
- **Workspace apps with a root lockfile** cannot be ground truth (inbox-zero above).
- **`absoluteStrokeWidth`** is not in the type diff (a JSX attribute's deprecation), so it is
  detected syntactically on lucide components only; a wrapper that forwards it is not found.

