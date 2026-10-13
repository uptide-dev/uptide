# 0016: Agent SDK executor (`--agent sdk`)

Status: default for authenticated Anthropic fixes. `--agent patch` opts out; other providers
and callers supplying a fixer retain the patch executor. Without a key, rule-based fixes
remain available. `--no-llm` disables either executor. The SDK is an optional peer, never
bundled: without it installed, the default is the patch executor.

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

- **Remaining work.** After mechanical edits, a confirmed compiler site in a now error-free
  file is counted as mechanically resolved. Both executors skip it. A file with any remaining
  error stays eligible, as does a finding without a matching target diagnostic.
- **Unit of work.** One session covers the package's manual sites and all their rule knowledge,
  avoiding repeated system prompts, repository reads and checks between rules. Its editable
  files are the sites' files, placed helpers, and repository declarations linked to the
  compiler errors. A rejected session is reverted atomically.
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

  Both executors read the shared Stripe period knowledge. The patch executor additionally
  gets patch-scope and helper-import instructions; the SDK discovers import conventions.
- **Model effort.** Use the same model capability default as the patch executor (medium
  for Sonnet 5.5), rather than leaving the SDK to choose a separate default.
- **Budget.** The session receives the remaining `--max-cost` budget (`maxBudgetUsd`), and `maxTurns` follows from that share. The SDK enforces the budget after
  each turn, so a task can overshoot its share by one turn.
- **Summary.** The session ends with a JSON-schema `outputFormat`:
  `{changed, newFiles, decisions, assumptions, couldNotDo}`.
- **Edit rules, right after each session.** The task is rejected and reset if:
  - it edited an existing file outside the task;
  - it added `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`, `as any` or `as unknown as`.

  Newly created files absent from the structured `newFiles` list are removed before
  validation, type-checking, lint and tests. The report records them as `discardedFiles`.
  If the remaining edits depend on a discarded file, the gate rejects them. This lets the
  executor recover from an accidental scratch file without adding a delete tool.
  Otherwise its edits become one commit.
- **Gate, once per session.** All manual sites share one session and one gate. The session is rejected if any of these holds:
  - it introduced type errors, compared with the session's start by
    `newDiagnostics` with the session's line moves (`gitLineMoves`, shared with the rest of
    `fix`): an error on a line the batch kept is the old one, one on a line it edited is new;
  - lint fails on the files it changed (after formatting them) where the baseline did not;
  - a test related to its files fails that did not fail at the session's start.

  Only what the session can affect runs:
  - The type-check is `typeChecker()`. It keeps one TypeScript builder program per workspace
    across checks and re-checks a workspace only when a repository file its program reads
    changed, and then only the files that depend on the change. On a seven-workspace
    monorepo, a fresh check takes 7.1s, a re-check after a one-file edit 2.3s, and an
    unchanged one 41ms. The cache starts after installation and is released before final
    verification builds independent programs, avoiding two sets of retained programs.
  - The tests are those related to the task's files. The agent and gate reuse a result only
    for the same file selection and unchanged Git-visible source tree. A scoped run
    with no matching tests does not expand into the full suite; that runs in final verification.
    Scoped failures are not retried into a pass; the gate compares them with the task baseline. Until every site is migrated, an
    upgrade can break tests the pre-upgrade baseline passed, so a session answers only for
    what it changes, as with types. The same tests run at the session's start, by checking
    that commit's files out for the run, only when something fails at the end.

  The full selected suite runs once, in `settle`, and the final verdict still compares with
  the full pre-upgrade baseline. A root `pnpm -r run test` already covers workspace suites;
  it runs once with `--no-bail` to retain coverage and failure reporting. SDK checks do not
  retry failing suites into a pass. The session is accepted or reverted atomically; one rejected edit
  rejects its edits. A rejected task is reset to its start, in the clone only,
  and its sites stay manual with the agent's own words. A site counts as
  fixed when the compiler error it had at the start of the task is gone, wherever the edit
  was. A site without a compiler error counts as fixed when its file changed.
  `validateAssisted` is not applied: its rules are snippet-patch heuristics, for example "no new
  throws", which forbid failing loudly on a missing period.
- **Final verdict.** Unchanged, and the same for both agents: diagnostics against the
  pre-upgrade baseline through `gitLineMoves`.
- **Report.** `report.json` has `llm.agent: 'sdk'` and, per task, `llm.tasks[]`: turns,
  tokens, cost, wall time, tool calls by name, discarded files, gate verdict, rejection, and
  the summary.

## Dependency and terms

### Optional peer, the default only where installed (2026-10-12)

**Decision:** the SDK stays an optional peer of `uptide`, never a dependency. The default
uses it when it can be imported; otherwise `fix` runs the patch executor and says, in one
line of its output, what to install. `--agent sdk` without it fails the task and says what to
install. The Uptide GitHub Action installs the SDK itself. The SDK stays external in both tsup
builds, and the packaging test rejects inlined SDK code and any `dependencies` entry for it.

- **Size.** The SDK is 5.5 MB, but it pulls in the Claude Code binary for the user's platform
  through `optionalDependencies`: 240.7 MB on macOS arm64 and 257.1 MB on Linux x64. Its
  required peers add about 24 MB more (`@anthropic-ai/sdk`, `zod`, `@modelcontextprotocol/sdk`).
  As a dependency, every `npx uptide` would download about 270 MB against Uptide's 11 MB,
  including `--no-llm` runs, OpenAI and Gemini users, and anything importing
  `uptide/onboarding` or `uptide/report`. As an optional peer, only those who install it pay.
- **Terms.** This is our reading of the published conditions, not confirmation from Anthropic:
  - [Commercial Terms, A.1](https://www.anthropic.com/legal/commercial-terms) permits use of
    the services in products offered to end users. Those terms govern API-key use.
  - [Claude Code's product and authentication conditions](https://code.claude.com/docs/en/legal-and-compliance)
    allow running the published binary in products under the Commercial Terms. npm installs
    Anthropic's unmodified package; Uptide neither patches its binary nor changes its built-in
    authentication methods. Uptide uses the end user's API key, with usage billed directly
    to that user. It does not offer Claude account login, collect subscription credentials,
    resell usage, or claim Anthropic endorsement.
  - Neither grants a licence to ship the SDK's bytes inside Uptide's tarball. LICENSE.md is
    "All rights reserved", so bundling stays out.
- **To confirm with Anthropic (open; asked).** Each is a reading of the terms, not a
  statement in them:
  1. Does the publisher of a free CLI, whose users bring their own API key, need its own
     Commercial Terms agreement?
  2. Is an npm dependency "preinstalling" Claude Code in a product?
  3. The legal page says the built-in claude.ai login must not be removed or disabled, and that
     third parties must not offer claude.ai login. Is leaving the binary's login untouched,
     while Uptide documents only API keys, consistent with both?

The SDK's license and conditions still apply. What a session sends, and the switches Uptide
sets, are in [privacy](../privacy.md#agent-sdk-executor).

## Not done

- Non-Anthropic providers keep the patch agent. The flag refuses them.
- No resume or retry of a rejected session. One session per package.
- The GitHub Action does not take the flag.
