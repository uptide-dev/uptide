---
title: Concepts
description: What verified and generic mean, when a finding counts as breaking, how to read the coverage line, and what each exit code says.
---

# Concepts

For anyone reading a `check` report for the first time: the words on every row and what they
commit to.

## Tiers: verified and generic

Every direct dependency can be discovered and selected for analysis. What differs is how much
Uptide knows about it, and every row of `check`, the HTML report and the pull request says
which:

| Tier | Dependencies | What you get |
| --- | --- | --- |
| **Verified** | zod 3 → 4, stripe 14 and newer, ai 6 → 7 | A migration pack: rules written for that dependency, a guide for the agent, behavior checks (zod schemas compared on generated inputs; Stripe changelog filtered to what you call), and ground truth from public repositories the pack is scored against ([migration packs](packs.md)). `fix` migrates by rule first, by agent for the rest. |
| **Generic** | any other dependency | The same analysis without a pack. `fix` migrates with the agent alone, under the same verification plus the repository's build, and says so in the pull request. A major upgrade without a pack is never opened as a pull request. |

A pack is verified when its ground truth from at least two public repositories has no false
positive among breaking findings. A pack that has not met that bar yet is a candidate, and
the row says generic.

A generic `fix` needs a provider API key (there are no rules to fall back on; without a key
it says so and changes nothing), stops at `--max-cost` (default $1; an estimate above it stops before any agent call) and reports what it did
not complete. Its pull request opens with a note that no pack covers the package: every edit
was kept on the compiler's word and deserves a careful review. See [`uptide fix`](commands/fix.md).

## Breaking means confirmed

In both tiers a finding is called breaking only when something confirms it at the site, and
`check --details` names the evidence under each site:

- your code does not compile against the target at that site;
- the runtime probe loaded the target and the export is gone or changed;
- a `require()` of a package whose target is ESM-only;
- the import of a name the target no longer exports;
- a migration pack found it in the code (verified tier).

Everything else the declaration diff suggests is **possible impact**: the types changed where
your code uses them, nothing confirmed that it breaks. The row counts it apart
(`✗ 3 breaking, 17 possible`), the package says it in one line ("+17 possible impact in 4
files, not counted as breaking"), and `--details` and `--json` have every site. The first
screen never lists them: on a large repository they run to thousands. It is never counted
as breaking.

## The coverage line

Under every analyzed package, one line says how much of the code that uses it the compiler
judged, and with which compiler:

```
compiled 355 of 356 files in 5 workspaces with the repo's TypeScript 4.9.5; skipped: most files cannot resolve their imports at the installed version (1)
```

The compiler is the repository's own `node_modules/typescript` (the one its build runs, so
the errors and their lines are the ones `tsc` would print); only a repository that installs
none is judged by the bundled one, and the line says so (`with the bundled TypeScript
6.0.2`). The files are the ones that import the package and the ones importing those, per
workspace, each compiled under its own tsconfig; a skipped one says why (not in the
workspace tsconfig, a workspace whose baseline cannot resolve its imports, an invalid
tsconfig). When not every file was compiled, the verdict says `types partly verified:
compiled N of M files ...` instead of `compiled against <version>`: a clean result only
covers what was compiled.

## One root cause, one finding

A root cause that is a compiler option is one site. When the target drops the global `JSX`
namespace and the workspace's `"jsx": "preserve"` (or `"react"`) reads JSX element types
from it, every element in every file errors with one fix: `check` reports one finding at the
`jsx` line of the tsconfig that sets it (`"jsxImportSource": "react"` resolves it), with the
diagnostics as evidence, and `--details` shows a few of them. A repository parameter that
several call sites trip over (a hook typed `RefObject<HTMLElement>` once `useRef` returns
`RefObject<HTMLElement | null>`) is reported the same way: one finding at the parameter,
with the call sites as evidence. So is a member your own code declared in an augmentation
the target no longer reads (a custom matcher on the global `jest.Matchers` in a test setup
file, once `expect` stops reading that namespace): every `expect(...).toMatchImageSnapshot()`
that now fails is evidence of the one declaration, reported at the `declare global` block or
the augmented interface. The call sites may sit in other workspaces than the
parameter (a hook in `packages/editor` called from `apps/examples` and `packages/tldraw`):
a site alone in its workspace still folds into the one finding at the declaration once the
workspaces are merged, and `--details` prints `N call sites in M workspaces` under it. The
HTML report lists the call sites, with their workspaces, under the anchor; the JSON report
carries them as the finding's `downstream`, and `root` on each call-site finding names the
declaration it traces to. Common causes are grouped into one finding with a site
count; `--details` expands sites. For example, TypeScript 7 missing compiler API members form
one cause rather than dozens.

A compile error whose value comes from another breaking site is that site's consequence,
not a site of its own. When zod 4 drops `ZodError.errors`, `return { errors:
result.error.errors }` is the breaking site: one edit (`.issues`) fixes it. Every component
that calls that action and maps over the result (`errors.map(e => e.message)`, where `e` is
now implicitly `any`) errors too, and so does the narrowing that depended on it
(`savedAirport` possibly undefined). Those errors fold into the breaking site as
**downstream errors**. The rule:

- The new error's value is traced with the compiler, never by line distance: from the
  expression at the error, through the declaration and initializer of a variable or
  destructured binding, the receiver of a callback typed by an `any` value
  (`errors.map(e => …)`), the members of a returned object literal, and the call of a
  repository function. It folds only when the trace reaches the expression of another new
  error that is typed `any` at the target, such as `result.error.errors` (TS2339).
- A repository function's call is followed only when every returned expression whose type
  changed between the installed version and the target leads to such an expression. If one
  changed return cannot be traced, the trace stops.
- The root must be a breaking finding at that expression (a pack's or the declaration
  diff's, or an unattributed compile error). If it is a consequence itself, the error folds
  into that one's root. Errors whose trace reaches no reported root stay as they are.
- The default view adds the count to the rule's line (`61 sites, +58 downstream errors`).
  `--details` lists each folded error under its root, and `--json` carries them as the
  root finding's `downstream`.
- Folding changes what is reported, never what has to compile. `fix` still verifies against
  every diagnostic, so a fix that leaves a downstream error broken fails verification.

## Exit codes

For scripts and CI: **0** nothing breaking, **1** breaking changes found, **2** uptide could
not answer (bad arguments, unsupported repository, no network). When it cannot answer, it
says why and prints the exact command to run next.

One dependency failing (a registry error, an analysis that ran out of memory) does not empty
the report: the others are shown and the failed one is named with its reason. The exit code
is then 1 if anything breaking was found, else 2, because the question was not fully
answered. `list` exits 2 when discovery is incomplete, while retaining successful rows. `fix`
and `verify` exit 0 when the migration verifies and 1 when it does not; `plan` exits 0 with a
plan, or 2 when discovery is incomplete. `uptide <command> --help` prints the codes of each
command.
