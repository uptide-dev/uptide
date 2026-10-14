---
title: uptide.yml
description: The settings file the Uptide workflow and the uptide CLI read, field by field, with the JSON Schema.
---

# `uptide.yml`

The settings for Uptide in one repository: which dependencies it looks at, when the workflow
runs, how many pull requests it keeps open, and how much it may spend on the LLM. It sits
at the repository root. [`uptide init`](commands/init.md) writes one with the defaults and a
comment on every field; the "Add Uptide" pull request of the GitHub App contains the same
file. `minReleaseAgeDays` has no default, so the file has that line, with its comment, only
when the settings it was written from set it (in the GitHub App's onboarding, for example).

```yaml
version: 1
packages:
  allow: []
  deny: []
schedule: '17 6 * * 1'
maxOpenPrs: 3
llm:
  provider: anthropic
maxCost: 1
executor: auto
# minReleaseAgeDays: 7   # optional; see Release age
# verify:
#   build: build-ci      # optional; see Required builds
```

Only `version` is required. Every other field has the default shown in the table.

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| `version` | `1` | (required) | Format of the file. Only 1 exists; a newer uptide says so when it reads a newer version. |
| `packages.allow` | list of globs | `[]` | Only these dependencies. Empty: every dependency. |
| `packages.deny` | list of globs | `[]` | Never these, even when `allow` matches them. |
| `schedule` | cron (UTC) or `manual` | `17 6 * * 1` | When the workflow runs. See [Schedule](#schedule). |
| `maxOpenPrs` | 1 to 50 | `3` | No new pull request is opened while this many Uptide pull requests are open. |
| `llm.provider` | `anthropic`, `openai`, `gemini` | `anthropic` | Who receives the code around call sites no rule fixes, with the repository's own API key. The Uptide Action takes `anthropic` only. |
| `maxCost` | USD, more than 0, at most 100 | `1` | LLM budget; the SDK may overshoot by one turn. |
| `executor` | `auto`, `patch`, `sdk` | `auto` | With `auto`, SDK for Anthropic when it is installed, patch otherwise. `patch` or `sdk` explicitly selects the executor. |
| `minReleaseAgeDays` | days, 0 to 365 | none | Uptide never targets a release younger than this, when the repository sets no release-age policy of its own. Days, unlike pnpm's minutes. See [Release age](#release-age). |
| `verify.build` | a package.json script name | none | The script a migration pack's required build runs. Unset: `build:ci`, then `build-ci`, then `build`. See [Required builds](#required-builds). |

There is no `draft` setting: Uptide pull requests are always drafts. A file that sets it is
rejected rather than ignored.

## Required builds

Some migration packs need the repository's own build to pass before a migration is published
(Next.js: `next.config.js` and the bundler wiring are outside the type-check). Uptide runs one
package.json script for it, per workspace (the workspace's, else the root's): `verify.build`
when it is set, else the first of `build:ci`, `build-ci` and `build` that exists.

A `build` that needs a database or secrets (`prisma db push`, migrations, a `DATABASE_URL`)
fails in Uptide's clone before the framework's build starts. Uptide says so in the pull request
and the report (`build needs DATABASE_URL; set verify.build`) instead of a bare "build failed".
Point `verify.build` at a script that builds without them:

```json
{
  "scripts": {
    "build": "prisma generate && prisma db push && next build",
    "build-ci": "prisma generate && next build"
  }
}
```

```yaml
verify:
  build: build-ci
```

A `verify.build` that names a script the repository does not have is reported as a missing
build, which keeps the migration from being published.

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

## Release age

Uptide never chooses a target version younger than the repository's own release-age policy,
in `list`, `check`, `fix`, `plan` and the Action. It reads, from the project root:

| Package manager | Setting | Unit | Exempt |
| --- | --- | --- | --- |
| npm | `min-release-age` in `.npmrc` (project, then `~/.npmrc`, then the global npmrc; `npm_config_min_release_age` above all) | days | nothing |
| pnpm | `minimumReleaseAge` in `pnpm-workspace.yaml` | minutes | `minimumReleaseAgeExclude`: names, globs (`@org/*`), `name@1.2.3 \|\| 1.2.4` |
| Yarn | `npmMinimalAgeGate` in `.yarnrc.yml` | a duration (`3d`, `1w`); a bare number is minutes | `npmPreapprovedPackages`: names, globs, descriptors |

Setting a value of 0 turns that package manager's gate off.

When the repository sets none of them, the default of the package manager version it pins
applies, labelled as such in the reason (`your policy is 1 day (pnpm 11 default)`):

| Pinned version | Default | Source |
| --- | --- | --- |
| pnpm 11 and 12 | `minimumReleaseAge` 1440 minutes, with `minimumReleaseAgeExclude` | pnpm 11.0.0 release notes ([pnpm#11158](https://github.com/pnpm/pnpm/pull/11158)), the settings reference |
| Yarn 4.15.0 and later 4.x | `npmMinimalAgeGate` `1d`, with `npmPreapprovedPackages` | [yarnpkg/berry#7135](https://github.com/yarnpkg/berry/pull/7135), released in 4.15.0 |

The version comes from `packageManager` (`pnpm@11.2.0`), from `devEngines.packageManager`
when its range stays inside one row above, or from Yarn's `yarnPath`
(`.yarn/releases/yarn-4.15.0.cjs`). Lockfiles do not tell: pnpm 9 to 12 all write
`lockfileVersion: '9.0'`, and every Yarn 4 writes the same `__metadata.version`. When the version is
unknown, or is one this table does not list, no default is assumed. pnpm's default is not
strict: pnpm can still install a younger release when nothing older satisfies the range.
Uptide still targets the release pnpm prefers.

When several are set, a version must satisfy all of them. `minReleaseAgeDays` in
`uptide.yml` applies when the repository sets none itself; a package manager's default does
not count as one, so both apply then. A policy the repository sets always wins.

When the newest release is too young, Uptide targets the newest one old enough, never a
prerelease in place of a stable release, and says so:

```
widget  4.6.7 is 2 days old; your policy is 7 days (min-release-age in .npmrc); targeting 4.6.5
```

When nothing newer than the installed version qualifies, the package is skipped with that
reason: under RELEASE AGE in `list`, `skipped` in `check`, and `status: skipped` in the
Action's `uptide.run/v1` report. `fix` refuses a target named on the command line that the
policy refuses, and names the newest release old enough. A version with no publish date in
the registry's metadata is allowed, as pnpm does.

Publish dates come from the registry's full package document. Uptide asks for it only when a
policy is set and the package changed inside the policy's window, once per package.

The policy also decides which version of Uptide `npx uptide@latest` runs in that repository:
npm resolves the newest Uptide old enough. To run the current one, install it globally or run
it from outside the repository (`npx uptide list --cwd path/to/repo`).

## Who reads it

- **The Uptide Action** (in the Uptide workflow) applies:
  - `packages`, through `uptide list`: only the dependencies it allows are checked or fixed.
  - `llm.provider`: `anthropic`, the one key the workflow passes. The Action does not run
    without that key ([CI](ci.md#the-anthropic-key-is-required)); any other provider stops the
    run with an error.
  - `maxCost`: the limit of each `fix` run.
  - `maxOpenPrs`: no new pull request while that many Uptide pull requests are open.
  - `executor`: `patch` for the patch agent; otherwise the Agent SDK.
  It does not read `schedule`: see below.
- **`uptide fix`** reads `llm.provider`, `maxCost` and `executor`.
- **`uptide list`**, **`uptide check`**, **`uptide fix`**, **`uptide plan`** and the Action
  read `minReleaseAgeDays` when the repository sets no release-age policy of its own.
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
