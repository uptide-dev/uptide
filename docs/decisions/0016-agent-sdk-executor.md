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
  (in-process, matched across line shifts), its resolved lint and its resolved tests. These go
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
- **Gate, at the end of each task.** The task is rejected if any of these holds:
  - it edited an existing file outside the task;
  - it created a file it did not declare;
  - it added `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`, `as any` or `as unknown as`;
  - it introduced type errors, compared with the start of the task by
    `newDiagnosticsAcrossShifts`;
  - lint fails on the edited files where the baseline did not;
  - a test fails that did not fail when the task started. Until every site is migrated, an
    upgrade can break tests the pre-upgrade baseline passed, so a task answers only for what
    it changes, as with types. The final verdict still compares with the pre-upgrade baseline.

  A rejected task is reset (`git reset --hard`, `git clean -fd`, in the clone only) and its
  sites stay manual with the agent's own words. An accepted task is one commit. A site counts as
  fixed when the compiler error it had at the start of the task is gone, wherever the edit
  was. A site without a compiler error counts as fixed when its file changed.
  `validateAssisted` is not applied: its rules are snippet-patch heuristics, for example "no new
  throws", which forbid failing loudly on a missing period.
- **Final verdict.** With `--agent sdk` it also matches diagnostics across line shifts. The
  patch path still compares by position.
- **Report.** `report.json` has `llm.agent: 'sdk'` and, per task, `llm.tasks[]`: turns,
  tokens, cost, wall time, tool calls by name, gate verdict, rejection, and the summary.

## Dependency and terms

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
The SDK collects usage feedback under Anthropic's data-usage policy; `docs/privacy.md` must
say so before this leaves experiment status.

## Not done

- Non-Anthropic providers keep the patch agent. The flag refuses them.
- No resume or retry of a rejected task. One session per task.
- The GitHub Action does not take the flag.
