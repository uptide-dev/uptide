---
title: uptide.yml
description: The settings file the Uptide workflow and the uptide CLI read, field by field, with the JSON Schema.
---

# `uptide.yml`

The settings for Uptide in one repository: which dependencies it looks at, when the workflow
runs, how many pull requests it keeps open, and whether it may send code to an LLM. It sits
at the repository root. [`uptide init`](commands/init.md) writes one with the defaults and a
comment on every field; the "Add Uptide" pull request of the GitHub App contains the same
file.

```yaml
version: 1
packages:
  allow: []
  deny: []
schedule: '17 6 * * 1'
maxOpenPrs: 3
llm:
  enabled: true
  provider: anthropic
maxCost: 1
executor: auto
```

Only `version` is required. Every other field has the default shown in the table.

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| `version` | `1` | (required) | Format of the file. Only 1 exists; a newer uptide says so when it reads a newer version. |
| `packages.allow` | list of globs | `[]` | Only these dependencies. Empty: every dependency. |
| `packages.deny` | list of globs | `[]` | Never these, even when `allow` matches them. |
| `schedule` | cron (UTC) or `manual` | `17 6 * * 1` | When the workflow runs. See [Schedule](#schedule). |
| `maxOpenPrs` | 1 to 50 | `3` | No new pull request is opened while this many Uptide pull requests are open. |
| `llm.enabled` | boolean | `true` | `false`: no code is sent to an LLM; only rule-based fixes are made. |
| `llm.provider` | `anthropic`, `openai`, `gemini` | `anthropic` | Who receives that code, with the repository's own API key. |
| `maxCost` | USD, more than 0, at most 100 | `1` | LLM budget; the SDK may overshoot by one turn. |
| `executor` | `auto`, `patch`, `sdk` | `auto` | With `auto`, SDK for Anthropic when it is installed, patch otherwise. `patch` or `sdk` explicitly selects the executor. |

There is no `draft` setting: Uptide pull requests are always drafts. A file that sets it is
rejected rather than ignored.

## Globs

`packages` takes npm package names with `*` and `?`: `zod`, `eslint-*`, `@types/*`,
`@radix-ui/*`. A `*` stays within one part of a scoped name (`@types/*` matches `@types/node`,
`*` alone does not match `@types/node`); `**` matches anything. `deny` wins over `allow`.

## Schedule

A five-field cron expression in UTC, as GitHub Actions reads it: numbers, `*`, ranges, steps,
lists, and month and weekday names. GitHub cannot read `uptide.yml` to schedule a workflow,
so the workflow file holds a copy of this line. After changing `schedule`, run
`npx uptide init --force` to write it into the workflow too.

`manual` turns scheduled runs off: the workflow has only the `workflow_dispatch` trigger, and
runs start from the Actions tab (Run workflow) or from Run now in the Uptide dashboard. Any other
text must be a valid cron expression.

```yaml
schedule: manual
```

The schedule `uptide init` and the App write is weekly, on Monday between 03:00 and 08:59
UTC, at a minute derived from the repository's `owner/name`: never minute 0 or 30, when
GitHub delays scheduled runs, and spread so that repositories do not all start together. The
same repository always gets the same schedule.

## Who reads it

- **The Uptide Action** (in the Uptide workflow) applies:
  - `packages`, through `uptide list`: only the dependencies it allows are checked or fixed.
  - `llm.enabled` and `llm.provider`: assisted fixes run when the LLM is on and the provider
    is `anthropic`, the one key the workflow passes.
  - `maxCost`: the limit of each `fix` run.
  - `maxOpenPrs`: no new pull request while that many Uptide pull requests are open.
  - `executor`: `patch` for the patch agent; otherwise the Agent SDK.
  It does not read `schedule`: see below.
- **`uptide fix`** reads `llm.enabled`, `llm.provider`, `maxCost` and `executor`.
- **`uptide check`** and **`uptide fix`** read `packages` and say when a dependency named on
  the command line is outside it; a named dependency is still checked. A group
  (`check --group`) loses the members outside `packages`.
- **`uptide list`** leaves out the dependencies outside `packages`.

`schedule` is read only when the workflow is written: `uptide init` and the GitHub App copy it
into the workflow's cron ([Schedule](#schedule) says how to update it).

The CLI uses the nearest `uptide.yml` from the working directory up to the Git root, or the
file `--config <path>` names. When it reads one it says so on stderr (`Settings: uptide.yml`).

## Flags win

A flag on the command line overrides the file, and the file overrides the defaults:

| Setting | Flag | Also |
| --- | --- | --- |
| `llm.enabled` | `--llm`, `--no-llm` | |
| `llm.provider` | `--provider` | `UPTIDE_PROVIDER` ranks above the file |
| `maxCost` | `--max-cost` | |
| `executor` | `--agent patch`, `--agent sdk` | |
| `packages` | naming a package | |

`uptide.config.json` (`provider`, `model`, `advisories`) is still read. If both files set a
provider and they differ, the run stops and says so.

## Errors

A file that is not valid stops the run before anything else happens, with every problem and
its line:

```
error: uptide.yml is not valid:
  line 2: maxOpenPrs must be a whole number, not text
  line 4: llm.provider must be one of anthropic, openai, gemini
Reference: docs/config.md
```

API keys never belong in this file. A setting named like a credential (`apiKey`, `token`,
`secret`), or a value shaped like one (`sk-...`, `ghp_...`), is rejected without the value
being printed. Keys go in the repository secret `ANTHROPIC_API_KEY`, or in an environment
variable locally.

## JSON Schema

The schema is [`schema/uptide.v1.json`](../schema/uptide.v1.json), draft 2020-12, published at
`https://raw.githubusercontent.com/uptide-dev/uptide/main/schema/uptide.v1.json`. The
generated file names it on its third line, so editors with the YAML language server complete
and check the fields. The CLI validates with the same schema
(`packages/core/src/onboarding/schema.ts`; a test keeps the published copy identical).
