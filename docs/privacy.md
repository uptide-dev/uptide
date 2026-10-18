---
title: Privacy
description: What Uptide runs locally, what leaves your machine and when, what it loads from your repository, and where the full isolation model is.
---

# Privacy

For anyone deciding whether to run Uptide on their code: what runs where, and what leaves
the machine. The isolation model and how to report a problem are in
[SECURITY.md](../SECURITY.md).

## The statement

This is the text `uptide --help` prints, word for word:

Analysis runs locally. Code goes to Anthropic only for assisted fixes in `uptide fix`, and
only with your own API key from ANTHROPIC_API_KEY. `fix` runs them with the Claude Agent
SDK, which sends the finding, enclosing code, compiler-linked repository declarations and
compiler error, and can also send files throughout the temporary clone and output from
type-checks, lint and tests. No account.
`check` and `verify` load the `typescript` package your repository installs (resolved from its
node_modules) to compile with, and never run your repository's scripts or other code outside
`fix`'s verification step.
Anonymous telemetry is off by default and asks for consent in an interactive terminal.
Set UPTIDE_TELEMETRY=0 to disable it. No IP, code, paths or repo names are collected.
Other network use: your npm registry for package metadata and tarballs, and once for the
Agent SDK on the first `fix` (asked first in an interactive terminal), npm's advisory
endpoint from `list` (public package names and installed versions; `--no-advisories` turns
it off), PostHog EU only
after telemetry opt-in, and GitHub when you pass `fix --pr` or run `pr` / `pr-body`.

## Command by command

There is no Uptide server. With telemetry off (the default):

| | Where it runs | What leaves your machine |
| --- | --- | --- |
| `list`, `plan` | locally | package names/versions requested from your npm registry, and `list` sends public packages' names and installed versions to npm's advisory endpoint; metadata only, no source code |
| `check` | locally | nothing of yours; it downloads package tarballs from your npm registry. No LLM call. It loads your installed `typescript` package to compile with, and runs no script or other code of yours. |
| `fix`, rules and verification | locally, in a temporary clone | nothing of yours |
| `fix`, assisted fixes | Anthropic's API, with **your** `ANTHROPIC_API_KEY`, through the Claude Agent SDK | findings, enclosing code, compiler-linked declarations and errors, files read throughout the clone and output from its checks |
| `fix`, first run | your npm registry | nothing of yours; it downloads the Agent SDK once into Uptide's cache, asking first in an interactive terminal |
| `pr`, `fix --pr` | GitHub, through your own `gh` | the branch and the pull request, when you say so |

`fix` needs `ANTHROPIC_API_KEY` and the Agent SDK. Without either it stops before any clone, with
exit 2, and nothing leaves your machine.

## What runs from your repository

`check` runs none of your scripts or code. The one package it loads from your
`node_modules` is the `typescript` your repository installs, to compile with; the bundled
compiler stands in only when there is none. `fix` and `verify` work in a temporary clone,
install with lifecycle scripts disabled and git hooks off, and run your type-check, tests,
formatter and linter there: that verification step is the one place your code is executed,
and it is the point of the command. Tests that need a database, cache or queue do not run
unless you pass `--with-services --yes`, after Uptide prints what they would connect to.
Child processes for install and tests do not receive your LLM API key or GitHub token.

## Assisted fixes and telemetry

Assisted fixes go to Anthropic through the Agent SDK (below); Anthropic's data policy applies
([models](models.md)). Anonymous telemetry is opt-in, stored in PostHog Cloud EU with a
90-day retention policy, and contains no IP, code, paths, repository names or user names
([`uptide telemetry`](commands/telemetry.md); every field in [telemetry internals](telemetry.md)).

## Agent SDK executor

`fix` runs only with the Claude Agent SDK: `@anthropic-ai/claude-agent-sdk` installed next to
Uptide, or downloaded once by the first `fix` into Uptide's cache (about 300 MB; in an
interactive terminal it asks first, with `--yes` or without a terminal it says so and
downloads). It runs Anthropic's Claude Code binary on your machine
([decision record](decisions/0016-agent-sdk-executor.md)). npm installs Anthropic's unmodified
package: Uptide neither bundles nor modifies it. If it cannot be downloaded or loaded, `fix`
stops with exit 2 before any clone, and nothing is sent. That install contacts only your npm
registry. Its use is governed by
[Anthropic's terms](https://code.claude.com/docs/en/legal-and-compliance), not Uptide's
license.

What leaves your machine:

- **Model calls**, to Anthropic's API with your `ANTHROPIC_API_KEY`. A session can read any file in the temporary clone, including
  dependency declarations in `node_modules`. It sends what it reads, and the output of
  Uptide's type-check, lint and tests, as part of its conversation. Under Anthropic's
  Commercial Terms this is
  [not used for training and kept 30 days](https://code.claude.com/docs/en/data-usage).
- **Nothing else, by default.** Uptide starts each session with
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, which turns off Claude Code's usage metrics,
  error reports, feedback surveys and auto-updates. It also sets
  `DISABLE_FEEDBACK_COMMAND=1` and `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1`,
  the two items that variable does not cover
  ([data usage](https://code.claude.com/docs/en/data-usage),
  [environment variables](https://code.claude.com/docs/en/env-vars)), and
  `CLAUDE_AGENT_SDK_CLIENT_APP=uptide`, which names Uptide as the calling app in the SDK's
  requests to Anthropic.
  - The session has no web tool, so Claude Code's WebFetch domain check never runs.
  - `persistSession: false`: no transcript is written under `~/.claude/projects/`.
  - `settingSources: []`: your Claude Code settings, hooks and `CLAUDE.md` files are not automatically loaded.
- **The session's environment** holds `PATH`, `HOME`, the key and the switches above, and
  nothing else of yours. The tests the session asks for run through Uptide, without your
  keys or tokens, as in every `fix`.

The model calls are the feature of `fix` and cannot be turned off: `check`, `list` and
`plan` make none. The SDK's
README mentions collecting "usage data (such as code acceptance or rejections)" as feedback.
The data-usage page lists no such collection beyond the items above. If you need certainty,
ask Anthropic.

## Registry access

Registry settings use environment overrides, project and user `.npmrc` files, scoped
registries and host/path-scoped credentials. Credentials and registry responses are never
written to the discovery cache. Only packages served by the public npm registry are named to
npm's advisory endpoint; `--no-advisories` or `"advisories": false` in `uptide.config.json`
turns that request off ([`uptide list`](commands/list.md#registry-access-and-advisories)).

With a release-age policy ([docs/config.md](config.md#release-age)), Uptide also asks your
registry for the full package document, which carries publish dates, for a package that
changed inside the policy's window: the same registry and credentials, one request per
package, nothing sent beyond the package name.
