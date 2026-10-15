# Migration packs: the public contract

A migration pack is everything Uptide knows about upgrading one dependency across one
breaking change. This page is the contract a pack meets, with the zod pack
(`packages/core/src/packs/zod/`) as the reference. Anyone can write a pack, and so can a
scheduled agent: `uptide pack new` scaffolds one and `uptide pack test` scores it. The
contract is checked in code (`packages/core/src/packs/contract.ts`), not only described here.

The step-by-step guide is in [CONTRIBUTING.md, "Write a pack"](../CONTRIBUTING.md#write-a-pack).
The next packages worth a pack are in [`packs/queue.json`](../packs/queue.json).

## What a pack is

A pack is a directory `packages/core/src/packs/<name>/`:

| File | What it holds |
| --- | --- |
| `index.ts` | the pack: metadata, rules, behavior notes, agent instructions |
| `fixtures/<case>/before.ts`, `after.ts` | code before and after the rules, with the sites marked |
| `fixtures/<case>/filename.txt` (optional) | logical workspace-relative filename for convention-sensitive rules; defaults to the fixture path |
| `<name>.test.ts` | runs the fixtures under `pnpm test` (scaffolded) |
| `ground-truth.json` | real public repositories at a pinned commit, with the findings expected there |
| `verification.json` | what `uptide pack test --write` measured; the status the CLI shows |

It is registered in `packages/core/src/packs/registry.ts`, which `uptide pack new` writes.

### Metadata

```ts
meta: {
  package: 'zod',
  from: '>=3 <4',     // installed versions it migrates from (semver range)
  to: '>=4 <5',       // target versions
  sources: [{ title: 'Zod 4 migration guide', url: 'https://zod.dev/v4/changelog' }],
  maintainer: 'uptide-dev',
},
```

`sources` are the changelog and migration guide every rule and note is taken from. A rule
that no source supports does not belong in a pack. `supports(from, to)` defaults to the two
ranges; a pack may narrow it (stripe also requires the target to be newer than what is
installed).

A pack may also name `companions`: packages that always move with the package, even when
their installed version already accepts the target.

```ts
companions: [{ name: 'ai-sdk-ollama', source: 'https://github.com/jagreehal/ai-sdk-ollama/blob/main/README.md' }],
```

**Companions come from official docs, never from ground truth alone.** `source` is the `https`
URL of the official migration guide or changelog that says the package moves with the
package: the leader's documentation or the companion's own, never the ground truth. A
ground-truth repository that moved a package shows what one repository did, not that the
package must move. `uptide pack test` fails a pack whose `companions` has an entry with no
`source`, one that is not an `https` URL, or one that names the pack's own package.

A release-group member published at the target's own version (`react-dom`) and `@types/*`
need no entry. A package that only peers on the package and whose installed range rejects the
target is left in place and listed under possible impact as a peer conflict; it is never
compiled at another version.

### Mechanical rules: detect and rewrite

```ts
{
  id: 'error-params',
  summary: 'required_error and invalid_type_error become one error callback',
  severity: 'breaking',                 // or 'deprecated'
  kinds: ['signature', 'type', 'required'],
  symbols: /string|number|.../,         // detect: the findings `check` reports that it claims
  guide: zodGuide.errors,               // what the agent is told at a site the rule cannot rewrite
  rewrite: (text, finding) => ...,      // the edit at one reported site, or { applied: false, reason }
}
```

- **Detect.** `check` already diffs the two versions' declarations and compiles the
  repository against the target. A rule claims the findings whose change kind and symbol
  path it matches (`kinds`, `symbols`), and, with `message`, what the compiler said there: a
  compiler-only finding's path is just its code (`TS2353`), the message names the property.
  The plan files every claimed site under the rule, whether or not it rewrites (`ruleOf`). For sites no type diff reports, a rule can add
  `detect(text, file)`, which returns sites found in the source of a file that uses the
  package; `check` lists them as the pack's own findings.
- **Rewrite.** `rewrite(text, finding, context)` edits the reported site and nothing else,
  or declines with a reason (`existing error/errorMap needs manual merging`). A rule without
  `rewrite` is assisted: the agent gets its `guide`, and a patch is kept only when the
  site's compiler error disappears and no new one appears.
- A rule never changes behavior silently. When behavior can differ, it is a behavior note
  (below), reported and left to a person.

`definePack` (in `contract.ts`) builds the runner's hooks from rules and notes alone, which
is what `uptide pack new` scaffolds. `replaceAtSite(text, finding, before, after)` is the
common rewrite: one identifier at the reported site. Zod and Stripe implement the same
interface by hand because they gather context no rule has (default messages, API versions).

### Fixtures

Every rule that rewrites or detects has fixtures, and every fixture case has a site it must
leave alone. A site is a line that ends in a marker comment:

```ts
export const name = z.string({ required_error: 'Name is required' }); // @uptide error-params at:z.string
export const merged = z.string({ required_error: 'x', errorMap: m }); // @uptide error-params keep at:z.string
export const contact = z.string().email(); // @uptide string-format at:.email( path:ZodString#email
```

- `keep`: the rule must leave this site alone (a rewrite must decline, `detect` must not find it).
- `at:<text>`: where on the line the site starts, as `check` would report it (default: the
  first non-blank column).
- `kind:<kind>`, `path:<path>`: the change `check` reports there, when the rule matches on
  them (default: the rule's first kind, and the `at:` text).
- `message:"..."`: the compiler's message there, for a rule that matches on `message`.

Each marked site of a rule with `rewrite` is rewritten, bottom-up, and the result must equal
`after.ts` byte for byte (the markers are comments, so they stay). A rule or note with
`detect` must find exactly the marked lines in `before.ts`, and nothing on any other line.
Fixtures are test data: biome and `tsc` skip them, and they are never reformatted.
`uptide pack test <package> --fixtures-only --update-fixtures` writes each `after.ts` from
what the rules produce, like a snapshot update: read the diff before committing it.

### Behavior notes: what the compiler cannot see

```ts
behavior: [
  {
    id: 'default-messages',
    summary: 'Zod 4 words its default error messages differently; code and tests matching the old text keep compiling',
    reported: ['decision', 'test-follow-up'],
  },
],
```

A behavior note is a change where the same code compiles and does something else. How a
site is reported is part of the contract (`reported`):

- `finding`: `check` lists the site as the pack's own finding (evidence `pack`), found by
  the note's `detect`; `fix` never edits it unasked. Example: a Stripe client created
  without `apiVersion`, whose API version the SDK bump changes at runtime.
- `decision`: the pull request lists it under "Decisions for you", with the files and lines.
- `test-follow-up`: an assertion is updated only after the migrated code made that test
  fail, and the test then has to pass (zod's reworded default messages).

For packs without a custom `decisions()` hook, the engine renders their `decision` notes.
An optional `applies(context)` scopes a note: return `false` to omit it, `true` to use its
summary, or a string naming what was found and where. Without `applies`, the summary is
shown. `context.inventory` contains `{ file, text }` for the pack's declared inventory,
snapshotted before edits, with repository-relative paths (including package.json and
configuration contents when declared). An explicit `decisions()` hook owns the section,
even when it returns an empty list. Decision notes are not repeated as generic run notes.

A note found by `detect` is scored by `pack test` like a rule.

### Agent instructions

`instructions` is what the agent is told at a site no rule rewrites, after the rule's own
`guide`. They come from the sources, say what must not change (values, messages, control
flow), and never ask for a cast or a suppressed diagnostic to make the compiler pass.
Runtime never downloads instructions: they are checked in, with the date they were taken.

## Ground truth

```json
{
  "package": "zod",
  "repos": [
    {
      "repo": "owner/name",
      "commit": "<full SHA of the commit before the upgrade>",
      "migration": "https://github.com/owner/name/commit/<the upgrade commit>",
      "directory": "web",
      "from": "3.25.76",
      "to": "4.6.5",
      "with": { "@scope/companion": "2.0.1" },
      "why": "what this repository exercises",
      "findings": [{ "file": "src/schema.ts", "line": 12, "rule": "error-params" }]
    }
  ]
}
```

Each entry is a public repository at the commit **before** it made the upgrade, and the
findings the pack must report there: repository-relative file, 1-based line, and the rule
or note id. `from` is the version the lockfile has at that commit, and `to` the version the
repository upgraded to.

Where the expected findings come from: two sources that are not Uptide.

1. **The compiler.** The repository's own TypeScript, run on every `tsconfig.json`, with the
   target version linked where the package is installed and without it. Every diagnostic
   new at the target is a site: errors, and deprecations (6385, 6387, what an editor strikes
   through). A repository on TypeScript 7, which has no JavaScript API, is compiled with the
   TypeScript of this checkout, and the draft says so. The target is linked with its own
   dependencies at the versions it declares, as an install would leave it, and
   `--also <package>@<version>` links the companions the upgrade commit moved with it (the
   versions in its lockfile): `ai` 7 next to `@ai-sdk/react` 3 is a mix no repository ships,
   and its errors are not the upgrade's.
2. **The upgrade commit.** The lines it changed or removed (`git diff -U0 <commit> <upgrade>`,
   the old side). One site per change: consecutive changed lines of the same change are one
   site, at the first line of code (a line that is plainly another rule's starts a new
   one); a run with a diagnostic inside it, or right after a diagnostic of the same rule, is
   that diagnostic's site. Comment-only lines and changes for another package are not sites.
   A pure insertion (no line at `<commit>`) is a site only when it adds to a call or object
   the upgrade otherwise left unchanged, such as an option added to a constructor:
   `new Redis(url, {` at line 138 that gains `protocol: 2` is a site at 138. The anchor is the
   start line of the innermost call (or `new`) whose parentheses hold the inserted lines,
   through any object and array literals, or of the object literal when no call takes it.
   An insertion between statements or into a function body is not a site, nor is one into a
   call the upgrade also changed: that call's changed lines are its site.

`pnpm packs:truth` drafts both for one repository:

```sh
pnpm packs:truth zod owner/name <commit> <upgrade-commit> --to 4.6.5 [--directory web]
pnpm packs:truth ai vercel/chatbot <commit> <upgrade-commit> --to 7.0.9 \
  --also @ai-sdk/react@4.0.10 --also @ai-sdk/provider@4.0.1
```

It prints the compiler's new diagnostics with each line's text, the changed and inserted
lines, and `anchors`: each insertion into an unchanged call or object, at the line the rule
above anchors it, with the lines inserted there. You read each one, drop what is not about the package, and give every kept site its
rule, from its code and text. A site the pack has no rule for is expected under `generic`.
The expected findings never come from Uptide's output: a site `check` reports that neither
source has is a false positive, and it stays one.

`directory` is the project inside the repository when it is not at the root; `from` is the
version its lockfile has at `commit`, and `pack test` says so when it is not.

`with` lists the packages the repository's own upgrade moved together with this one, at the
versions it chose (from its `package.json` at the upgrade commit). `pack test` prints what
`check` moves with the package there and fails when it would leave one of them behind, or
cannot move one consistently: a pack whose `fix` produces an install the real upgrade never
had is not verified. Versions may differ (check picks the release that agrees with `to`);
the names may not. A package the target requires counts as moved at the lowest release of its
major that satisfies it (batch-ai's zod 3.24.2 → 3.25.0, where its upgrade chose 4.4.3). One
`check` leaves and says why counts as explained, not left behind: a blocker or a stay that
only a new major makes (guardrails' `@openai/agents` 0.1 → 0.17), or a peer conflict
(netlify's `http-proxy-middleware` 2 on `@types/express ^4`). A package that does not depend
on the lead is the repository's choice (openhab's `body-parser` with express) and fails nothing.

`fixture` entries (`"fixture": "fixtures/repos/storefront"`) are repositories in this tree.
They are scored like the others and never count toward `verified`.

`uptide pack test` fetches each repository once: a shallow fetch of the pinned commit only,
dependencies installed from its lockfile (npm, pnpm, Yarn or bun) with lifecycle scripts
off, and nothing from the repository is ever
executed. They are kept in `~/.cache/uptide/ground-truth` (`UPTIDE_GROUND_TRUTH_CACHE`), so
`pack test --offline` runs without network after the first time. `pnpm packs:fetch` fills
the cache for every pack (and `--corpus` for the repositories in `fixtures/corpus.json`).

The cache is large: each entry is a checkout with its dependencies installed. Measured on
2026-10-14, per pack: ai 2.1 GB, lucide-react 3.6, next 1.4, react 4.3, @sentry/browser 0.7,
@sentry/nextjs 4.3, @sentry/react 1.4, stripe 2.1, vitest 2.1, zod 2.2. Every pack at once is
about 24 GB, more than the 14 GB of disk a standard GitHub-hosted Linux runner documents, and
it grows with each pack. Keep it bounded the same way locally and on a runner: score one pack
at a time and evict its repositories before the next (`rm -rf
"$UPTIDE_GROUND_TRUTH_CACHE/<owner>__<repo>@<commit>"`, one directory per `ground-truth.json`
entry), so the cache holds at most one pack's ground truth, under 5 GB today. Registry
tarballs, kept beside it in `~/.cache/uptide`, add about 1 GB.

## Scoring: `uptide pack test`

```sh
pnpm uptide pack test zod            # from source: no build needed
uptide pack test --json              # every pack, for CI
uptide pack test zod --fixtures-only # no repository
uptide pack test zod --write         # record the result in verification.json
```

Each pack runs in a process of its own. One that runs longer than `--pack-timeout`
(minutes, default 20) is stopped with everything it started, and is reported as failed with
the pack's name and the last thing it logged; the other packs still run. The fetch of a
repository, every install, and every registry request have their own deadlines too.

For each ground-truth repository it runs `check` with the pack (the same code path users
get), takes the sites of the plan for the package, and compares them with the expected
findings:

- **per rule**: a site counts for a rule when file, line and rule all match;
- **overall**: at the line level, every severity;
- **behavior notes**: at the line level, the sites of the pack's behavior notes, whatever
  their severity;
- **breaking**: at the line level, breaking findings only.

An expected site has the severity of the rule or note it is expected under: a rule's
`severity`; a note's `severity`, or breaking when the note reports findings without one (as
`check` reports them); `behavior` for a note `check` never reports as a finding (`decision`,
`test-follow-up`); breaking for `generic`. A predicted site has the severity `check` reported.
A missed site counts against breaking recall only when its severity is breaking: a missed
`deprecated` note ("needs a look") or a decision is not a missed break.

It prints precision and recall for each, `n/a` where there was nothing to measure (nothing
predicted, or nothing expected), every false positive as `repo  file:line  rule (severity)`,
every false negative the same way with the severity it was expected at, and sites found under
another rule. A `generic` expected site (one no rule covered when the truth was written)
counts for whichever rule claims it now. It exits non-zero on any false positive among
breaking findings, any fixture failure, or a `verification.json` that claims more than it
measured: recorded `verified`, measured `candidate`. A record that claims less on purpose
(recorded `candidate`, measured `verified`) passes with `recorded candidate by choice;
measures verified`; one whose numbers merely differ passes with a note (`--write` records it).

## Verified or candidate

A pack is **verified** only with ground truth from at least two public repositories, no
false positive among its breaking findings there (precision 100%), at least one breaking
finding predicted, and at least five expected breaking sites across the public repositories
(fixture repositories never count). An upgrade the compiler cannot see, where every
expected site is a behavior note's (ioredis 6: new runtime defaults), is judged on its notes
instead, whatever their severity: at least five expected note sites, one found, and no false positive on a note or a
mechanical rule. `pack test` prints the gate's class, the site counts and every reason a
pack is a candidate.

A rule with a `rewrite` that no public repository's ground truth exercises (no true
positive) is **unexercised**: `pack test` lists it and records it in `verification.json`
(`unexercised`), because nothing real confirms its rewrite yet. `check` and `fix` read the record:
its sites are assisted (the agent, with the rule's guide), never rewritten. Detection is
unaffected, and so is the pack's status. A pack whose `transform` edits for a rule that has no
`rewrite` of its own (Stripe's pin) lists that rule in `mechanical`, so the gate counts it too.

A pack may ask for fewer real breaking sites with `meta.minBreakingSites`, only for a major whose
guide lists fewer breaking changes, and only with the reason written under
`## Breaking-site minimum` in its RESEARCH.md; `pack test` fails a pack that sets it without one.

Anything else is a **candidate**:

- it ships in the tree, and `pack test` scores it;
- by default, `check`, `list` and `fix` treat the dependency as generic: no `verified` label, the
  generic tier's evidence rule, the agent alone in `fix`.
- local `check --allow-candidate` and `fix --allow-candidate` opt in only to registered packs
  with an explicit candidate record. Reports and the PR body preview say **candidate pack,
  not verified**. The Action, `--pr` and `--yes` reject this flag; stored candidate runs
  cannot be published. Never edit `verification.json` just to smoke-test a pack.

The CLI reads the status from `verification.json`, which `pack test --write` writes and
which records the digest of the ground-truth file it was measured against, with precision,
recall and the counts behind them for breaking findings and for behavior-note sites
(`behavior`, absent from records written before it), the gate's class, the real breaking and
behavior-note site counts, and the unexercised rules. CI runs
`pack test` for every pack on every pull request that touches packs and fails when the
record claims verified where the evidence measures candidate, so the label cannot outlive
what supports it.

## The registry, the queue, CI

- `packages/core/src/packs/registry.ts` is generated: `pack new` renders it again with the
  new entry. Every pack in it is scored by CI; only verified ones are used by default.
- `packs/queue.json` ranks the next packages worth a pack (`pnpm packs:queue`) by direct use
  × log2(1 + breaking changes). Direct use is how many sample repositories
  (`fixtures/corpus.json` and the pinned public applications in
  `scripts/packs-queue-sample.ts`) declare the package in a package.json. Breaking changes are
  the distinct ones in the diff `check` runs between the major most of them are behind on and
  the latest: a change repeated across many exports counts once, each removed or renamed
  export once. Where the official migration guide lists more breaking changes than the types
  show (CSS, configuration, runtime behavior), the guide's count is used and the entry says
  "type diff understates"; each guide's link, counted sections and items are recorded in the
  script. Weekly downloads break ties. Packages that upgrade together are one entry named
  after their hub. Out: fewer than three sample repositories using it or behind on it, fewer
  than 10 breaking changes, an official codemod that covers the whole upgrade, and the packs
  that exist. A package no diff measures enters only when its guide lists API changes,
  marked "not measured". A partial codemod is named and counts 0.9.
- The **Packs** workflow (`.github/workflows/packs.yml`) runs `uptide pack test --json` for
  every pack with the ground-truth cache restored, on pull requests that touch packs.

## The `uptide pack` command

Packs are written in an uptide checkout; the steps are in
[CONTRIBUTING.md, "Write a pack"](../CONTRIBUTING.md#write-a-pack). `pnpm uptide` runs the
CLI from source.

```sh
pnpm uptide pack new ai --from ">=6 <7" --to ">=7 <8" --maintainer @you
pnpm uptide pack test ai                 # fixtures, then check on each ground-truth repository
pnpm uptide pack test --json             # every pack, for CI
pnpm uptide pack test ai --offline       # cached repositories only
pnpm uptide pack test ai --fixtures-only
pnpm uptide pack test ai --write         # record the measured status in verification.json
pnpm uptide pack test ai --fixtures-only --update-fixtures  # write after.ts from the rules
```

`pack test` prints precision and recall per rule, overall, for behavior-note sites and for
breaking findings, and every false positive and false negative as
`repository  file:line  rule (severity)`. Exit codes: **0**
every pack passed, **1** a false positive among breaking findings, a failing fixture, or a
`verification.json` the run does not support, **2** it could not run (not in a checkout, bad
arguments).

The "Verified packs" table in the README is generated from each pack's `verification.json`
and ground truth by `pnpm docs:packs`; CI fails when it is stale. Its precision and recall are
the breaking ones, `n/a` when nothing breaking was predicted or expected.

### Config files and transactional edits

`inventory` declares workspace-relative glob patterns independent of imports, for
example `next.config.{js,mjs,ts,cjs}`, `{middleware,src/middleware}.{ts,js}`,
`package.json`, and `{app,src/app}/**/default.{ts,tsx,js,jsx}`. The engine supplies
matching files to runtime detection, including when the package has no imported
usages. It excludes symlinks, dependency stores, git metadata and generated Next
output. Rules must restrict detection to the relevant filenames and syntax.

A rewrite may return `edits` alongside the existing `text`. Each edit is a `write`
or `create` with `file` and `text`, a `delete` with `file`, or a `rename` with `file`
and `to`. The primary text edit and additional edits form one transaction. The
engine validates every path and destination before writing, then checks types and
related tests. Failure restores all original files and removes created files.
Renames retain the old path on the finding; `editedFiles` records affected paths.
Formatting and linting use surviving paths. Publication still requires final
verification of the entire migration.

### Required builds

Declare `requiresBuild: true` when the upgrade changes contracts only the consumer's
build can check. Fix runs each affected workspace's build script (falling back to the
root script) after migration, using the same credential-filtered environment as tests.
A missing, failed, or timed-out build blocks publication; its result appears in the
PR's **Verified by** row. Reverification reruns the required build. Existing packs
without this declaration retain their current behavior. Next 16 requires this gate
because custom webpack configuration can fail with the default Turbopack build.

### Release groups

Use `releaseGroup` for packages published in lockstep with the pack's lead. Like
`companions`, each entry has `name` and an official HTTPS `source`. Unlike ordinary
companions, installed release-group members move even when they have no dependency
edge or their installed peer range already accepts the target. Check, fix preflight,
and pack verification use the same planner; list reports the group with `movesWith`.
Members must be visible in the lead's workspace.

The planner selects the lead's exact target version when published. If that version
is absent, it selects the newest stable release whose published dependency/peer
ranges explicitly accept the lead target. Without that evidence, or when the exact
release rejects the lead, planning reports a conflict rather than leaving the member
behind.

A declared release group also bounds the lead's scope: an installed package of the same scope
that is not in the group (`@sentry/vite-plugin` 5.x next to `@sentry/react` 10.x) is not a
member and stays where it is. Without a pack, a package of the lead's scope moves only when
something relates it to the group (a pin, a peer, a release at the lead's target version);
one that nothing relates stays at its version. Either way `check`, the pull request and
`pack test` name it (`@sentry/vite-plugin stays at 5.4.0 (…)`), and it never makes the plan
fail: only a member the group needs and no release agrees with is a conflict.

For Next, the declared members are `eslint-config-next`, `@next/eslint-plugin-next`,
`@next/bundle-analyzer`, `@next/mdx`, and `@next/third-parties`; declare only installed
members of this release family, not independently versioned React packages.

### Alternate leads

Some packages are mostly installed through another one that re-exports them: most React
Router 6 applications declare `react-router-dom`, which depends on `react-router` at its own
exact version. `alternateLeads` names such packages, each with an official HTTPS `source`
(`pack test` validates them like companions):

```ts
releaseGroup: [{ name: 'react-router-dom', source }],
alternateLeads: [{ name: 'react-router-dom', source }],
```

- Asked for by an alternate's name, `check` and `fix` use the pack and report under its lead
  (`uptide check react-router-dom` is `uptide check react-router`); a `--target` named after
  the alternate is the lead's.
- In a workspace that declares the alternate and not the lead, the lead is analyzed at the
  version installed through the alternate (hoisted, or beside the alternate in a pnpm store)
  and reported as undeclared, `via` the alternate, with a note that `fix` declares it.
- `fix` then declares the lead next to the alternate, at the target, in the same manifest
  section and range style (`^6.30.1` gives `^7.18.4`), before the upgrade; the alternate moves
  as the release group says. A catalog, alias or workspace reference to the alternate is
  refused with what to write by hand. Removing the alternate is left to a later upgrade that
  requires it, once nothing imports it.
- Only packages asked for by name are re-attributed; a pack of the alternate's own name wins
  over one that names it as an alternate.
