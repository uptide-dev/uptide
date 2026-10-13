# 0016: Experimental Agent SDK executor (`--agent sdk`)

Status: experiment, behind a hidden flag. The patch agent stays the default for every provider.

## Why

Same model, worse harness. The patch agent (`src/fix/assisted.ts`) sees a snippet of one site,
has no tools, answers once per attempt, follows a guide that can mandate code spellings, and is
judged by a gate that compares diagnostics by position, so a fix that adds lines above an old
error looks like it created one. A plain Claude Code session with the same model and a one-line
prompt migrated a Stripe upgrade faster than the patch agent did, at a similar cost. The repo was
boxyhq/saas-starter-kit.

## What it does

`uptide fix <pkg> --agent sdk` (Anthropic only) replaces `assist()` with `assistWithSdk()`
(`src/fix/sdk-agent.ts`). Everything before it (check, install, mechanical rules, shared
helpers) and after it (follow-ups, `settle`, final verification, tree hash, export) is
unchanged.

- **Unit of work.** There is one task per pack rule, not one per site. It covers every file
  that rule's manual sites are in, the files of helpers the run placed, and the repository
  declarations the compiler links to a site's error. React 19's `RefObject<T | null>` errors,
  for example, are fixed in the prop type they name, which lives in another file.
- **Executor.** Each task is one Agent SDK `query()` with `cwd` set to the temporary clone. The
  SDK's base tool set is restricted to `Read`, `Grep`, `Glob`, `Edit` and `Write`. Three
  in-process MCP tools, `check_types`, `run_lint` and `run_tests`, run Uptide's own type-check
  (in-process, matched across line moves), its resolved lint and its resolved tests. These go
  through `command()`, which strips secrets from the environment.
  - There is no shell at all. That is stronger than a shell restricted to an allowlist: no
    installs, git or network from the agent's own commands. The repository's tests still run as
    they do in `settle`.
  - The session sets `permissionMode: 'dontAsk'`, `settingSources: []` (nothing in the clone or
    in `~/.claude` configures it) and `persistSession: false`. Its environment holds only `PATH`,
    `HOME`, the key, and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`.
  - A `PreToolUse` hook (`guard()`) refuses three things: reads outside the clone, `.git` and
    symlink escapes; edits to files that are not the task's; and new files in `node_modules`.
- **Context, not orders.** The prompt gives the agent:
  - the sites, each with its compiler error, change and reason;
  - the rule's summary and knowledge;
  - the pack's changelog sections and source links;
  - the pack's decisions for that rule;
  - the helpers already placed;
  - detected conventions (tsconfig `module`, `moduleResolution`, `paths` and
    `allowImportingTsExtensions`, plus how the task's files spell relative imports).

  It does not get `pack.guide()`, which carries mandated spellings.
- **Budget.** Each task gets an equal share of what is left of `--max-cost`
  (`maxBudgetUsd`), and `maxTurns` follows from that share. The SDK enforces the budget after
  each turn, so a task can overshoot its share by one turn.
- **Summary.** The session ends with a JSON-schema `outputFormat`:
  `{changed, newFiles, decisions, assumptions, couldNotDo}`.
- **Edit rules, right after each session.** The task is rejected and reset if:
  - it edited an existing file outside the task;
  - it created a file it did not declare;
  - it added `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`, `as any` or `as unknown as`.

  Otherwise its edits become one commit.
- **Types and lint, once per batch.** A rule with several sites is its own batch; all
  single-site rules share one (`batches()`), so a zod or React upgrade's many one-line
  changes pay for one check, not one each. The batch is rejected if either holds:
  - it introduced type errors, compared with the batch's start by `newDiagnostics` with the
    batch's line moves (`gitLineMoves`, shared with the rest of `fix`): an error on a line
    the batch kept is the old one, one on a line it edited is new;
  - lint fails on the files it changed (after formatting them) where the baseline did not.

  The type-check is `typeChecker()`. It keeps one TypeScript builder program per workspace
  across checks, and re-checks a workspace only when a repository file its program reads
  changed, and then only the files that depend on the change. On a seven-workspace
  monorepo, a fresh check takes 7.1s, a re-check after a one-file edit 2.3s, and an
  unchanged one 41ms. A rejected batch of several tasks is retried one task at a time from
  its start, cherry-picking each task's commit and gating it alone, so one bad task does not
  take the others with it.
- **Tests, once, after every batch.** These are the tests related to everything the agent
  changed (`TestOptions.related`): the workspaces that own a changed file and their direct
  dependents, never the root's aggregate script unless the root owns a file, and a `test`
  script that is just the runner in its related-tests mode. The workspaces run side by side.
  - Until every site is migrated, an upgrade can break tests the pre-upgrade baseline passed,
    so the agent answers only for what it changes, as with types. The same tests run at the
    start (that commit's files checked out for the run) only when one fails at the end.
  - If one fails, the batches are replayed from the start in order, and a batch whose related
    tests fail where they passed before it is dropped.
  - Tests are the slow judge on a monorepo whose core package everything depends on: there,
    "related" is nearly the whole suite. Run per task, they cost more than the sessions.

  The agent's own `run_tests` covers the workspaces that own its files, without dependents.
  The full selected suite runs once more, in `settle`, and the final verdict still compares
  with the pre-upgrade baseline. A rejected task is reset to its start, in the clone only,
  and its sites stay manual with the agent's own words. A site counts as
  fixed when the compiler error it had at the start of the task is gone, wherever the edit
  was. A site without a compiler error counts as fixed when its file changed.
  `validateAssisted` is not applied: its rules are snippet-patch heuristics, for example "no new
  throws", which forbid failing loudly on a missing period.
- **Final verdict.** Unchanged, and the same for both agents: diagnostics against the
  pre-upgrade baseline through `gitLineMoves`.
- **Report.** `report.json` has `llm.agent: 'sdk'` and, per task, `llm.tasks[]`: turns,
  tokens, cost, wall time, tool calls by name, gate verdict, rejection, and the summary.

## Dependency and terms

### Optional peer, not a dependency (finding, 2026-10)

The terms allow a normal `dependencies` entry. The install size rules it out.

- **Terms.** Nothing in them forbids depending on the package so that npm installs Anthropic's
  published, unmodified bytes on the user's machine. That is depending, not redistributing.
  - The [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) puts its use
    under the [Commercial Terms](https://www.anthropic.com/legal/commercial-terms), "including
    when you use it to power products and services". Section A.1 of those terms allows exactly
    that.
  - The [legal page](https://code.claude.com/docs/en/legal-and-compliance) allows "preinstalling
    or running Claude Code in your products or services" under conditions this design keeps
    (below).
  - Neither grants a licence to ship the SDK's bytes inside Uptide's tarball. LICENSE.md is
    "All rights reserved", so bundling stays out.
- **Size.** The SDK is 5.5 MB, but it pulls in the Claude Code binary for the user's platform
  through `optionalDependencies`: 240.7 MB on macOS arm64 and 257.1 MB on Linux x64. Its
  required peers add about 24 MB more (`@anthropic-ai/sdk`, `zod`, `@modelcontextprotocol/sdk`).
  As a dependency, every `npx uptide` would download about 270 MB, against Uptide's 11 MB
  today, including for users who never pass `--agent sdk`. As an optional peer, only those who
  use the flag install it.
- **To confirm with Anthropic before a default ships.** Each is a reading of the terms, not a
  statement in them:
  1. Does the publisher of a free CLI, whose users bring their own API key, need its own
     Commercial Terms agreement?
  2. Is an npm dependency "preinstalling" Claude Code in a product?
  3. The legal page says the built-in claude.ai login must not be removed or disabled, and that
     third parties must not offer claude.ai login. Is leaving the binary's login untouched,
     while Uptide documents only API keys, consistent with both?

### What the package is and how Uptide uses it

`@anthropic-ai/claude-agent-sdk` is not open source: "© Anthropic PBC. All rights reserved",
and use is under Anthropic's Commercial Terms. It runs Claude Code's native binary, shipped as
per-platform optional dependencies. Uptide is Apache-2.0 and ships one bundle with every
dependency inlined, so the SDK is:

- **never bundled.** It is `external` in both tsup configs, and `package.test.ts` fails the
  build if it is inlined. It once came in through core's own `dist`, where the notices check
  could not see it.
- **an optional peer dependency of `uptide`.** It is loaded with a dynamic `import()` only when
  `--agent sdk` runs. Without it, the run fails with a message that says what to install.
  Uptide does not redistribute it.

The legal page (code.claude.com/docs/en/legal-and-compliance) allows a product that runs
Claude Code under three conditions, and this design keeps all three:

- the binary runs unmodified;
- each end user authenticates with their own API key. Uptide reads `ANTHROPIC_API_KEY` and
  never offers claude.ai login, which third-party products may not;
- Uptide does not pay for, resell or sit between the user and their Claude usage.

It also must not use the Anthropic or Claude Code names or logos as Uptide's own branding.
What a session sends, and the switches Uptide sets, are in
[privacy](../privacy.md#experimental-fix---agent-sdk).

## Not done

- Non-Anthropic providers keep the patch agent. The flag refuses them.
- No resume or retry of a rejected task. One session per task.
- The GitHub Action does not take the flag.
