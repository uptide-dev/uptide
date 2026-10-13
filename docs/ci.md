---
title: The Uptide Action
description: Run Uptide on a schedule in your repository's own GitHub Actions; draft pull requests with verified migrations, and a run report.
---

# CI: the Uptide Action

For anyone who wants Uptide to run in their repository's own GitHub Actions: on a schedule,
and on demand from the Actions tab. `uptide init` (or the Uptide GitHub App's "Add Uptide"
pull request) writes the workflow; this page is what that workflow runs.

The Action is `action.yml` at the root of this repository, released with the CLI's version
tags. Pin it by the full commit SHA of a release tag, as the generated workflow does.

```yaml
permissions:
  contents: read
  id-token: write

steps:
  - uses: actions/checkout@<sha> # with persist-credentials: false
  - uses: actions/setup-node@<sha> # the repository's Node, with its package manager's cache
  - run: npm ci --ignore-scripts # the repository's frozen install
  - uses: uptide-dev/uptide@<sha> # vX.Y.Z
    with:
      config: uptide.yml
      mode: ${{ inputs.mode || 'fix' }}
      package: ${{ inputs.package }}
      anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Inputs

| Input | Default | What it is |
| --- | --- | --- |
| `config` | `uptide.yml` | The settings file, relative to the repository root ([uptide.yml](config.md)). Without the file, the defaults apply. |
| `mode` | `check` | `list`: what is behind. `check`: what each upgrade breaks, at which call sites. `fix`: verified migrations, opened as draft pull requests. |
| `package` | (empty) | One dependency. Empty: every dependency `uptide.yml` allows, most urgent first. |
| `anthropic-api-key` | (empty) | Required: pass `secrets.ANTHROPIC_API_KEY`. Empty: the run stops before doing anything and the job fails ([below](#the-anthropic-key-is-required)). |
| `app-url` | `https://uptide-app.vercel.app` | The Uptide app: it issues the push token and receives the run report. |

Output: `report`, the path of this run's report (JSON, `uptide.run/v1`).

## The Anthropic key is required

Uptide without the LLM gives worse answers, and no run is better than a poor one. So the
Action checks `anthropic-api-key` before anything else, in every mode. When it is missing or
empty, the run:

- does not build the engine, read `uptide.yml`, list, check or fix anything, or ask for a push
  token;
- writes a job summary that says what to add: in the repository, **Settings → Secrets and
  variables → Actions → New repository secret**, named `ANTHROPIC_API_KEY`, passed to the step
  as `anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}`;
- sends a run report with no upgrades, `"llmKey": "missing"` and an `error` that starts with
  the code `LLM_KEY_MISSING`;
- fails the job.

The key is never written anywhere: the report says only `present` or `missing`.

## What a run does

1. **Sets up the engine of the pinned commit.** It installs this repository's own
   dependencies from its frozen lockfile, with install scripts off, and runs the CLI from
   that commit's source: never a version fetched from npm. Its pnpm goes into the runner's
   temp directory, not on PATH, so your package manager and Node stay as your workflow set
   them up. Node 20 or newer is required.
2. **Discovers** what is behind (`uptide list`), narrowed by `packages` in `uptide.yml`.
3. **`check`**: analyzes the dependencies your code uses (at most 10 a run; the rest stay
   listed), or the one named.
   **`fix`**: migrates them one at a time (`uptide fix`, with `--agent sdk` unless
   `executor: patch`), verifies each with your compiler, lint and tests, and opens a draft
   pull request for each one that verifies (`uptide pr`). It stops at `maxOpenPrs` open
   Uptide pull requests, never opens a second one for a package, and stops calling the LLM
   at `maxCost` for the whole run.
4. **Reports**: writes the run report to the job summary, sets the `report` output, and
   sends it to the Uptide app. If sending fails, the job warns and goes on: the pull request
   is the product, the dashboard is secondary.

The job fails only when the run as a whole could not do its job: no Anthropic key, an
invalid `uptide.yml`, no push token in `fix` mode, or the engine not answering. A migration that does not verify is
a result, reported as `failed`, not a failed job.

## How it pushes

Pull requests opened with the workflow's `GITHUB_TOKEN` never run your CI. So the workflow
grants only `contents: read`, and `id-token: write` for this:

1. The Action asks GitHub for an OIDC token for this job, with audience `uptide`.
2. It sends that token to `{app-url}/api/action/token`. The Uptide app checks that GitHub
   signed it for this repository's workflow and answers with an installation token of the
   Uptide GitHub App, valid for at most an hour.
3. The token is masked in the log the moment it arrives. It is given to one process only,
   `uptide pr`, which runs `git push` and `gh pr create` and nothing of your repository: no
   install, build or test. `gh` reads it from a private config directory removed afterwards;
   `git` gets it as an HTTP header, never in `.git/config`, a URL or a command line.
4. The commits are the App's: authored and committed by its bot account,
   `<app slug>[bot]` with the address `<bot user id>+<app slug>[bot]@users.noreply.github.com`,
   so GitHub links them to the App. The slug is the `appSlug` the Uptide app adds to its answer,
   else `GET /app` when GitHub answers it for the installation token; the id is the bot user's
   (`GET /users/<app slug>[bot]`). When neither works, the commits keep
   `uptide[bot] <uptide@users.noreply.github.com>`, which links to no account, and the job log
   has a warning saying so.

`fix` therefore needs the Uptide GitHub App installed on the repository. `list` and `check`
do not; without the app, only the run report is not sent.

## What leaves the runner

- **The run report**, to the Uptide app (`{app-url}/api/action/results`, with a fresh OIDC
  token as bearer).
- **Code around the call sites no rule fixes**, to Anthropic, with your own API key, in `fix`
  mode only.

Nothing else. The Anthropic key is given to the migration process alone; installs, builds
and tests run with every variable whose name says token, secret, key or password removed.

## The run report

`uptide.run/v1`, owned by the engine and published as `uptide/report` (types, a validator, the
summary renderer) and `uptide/report/schema.json` (JSON Schema). Like `uptide/onboarding`,
`uptide/report` is pure: no file system and no Node globals, so it imports under plain Node
ESM and bundles for a browser (`pnpm smoke:onboarding` checks both from the packed tarball).
One row per dependency. A
real `fix` run on the [storefront fixture](../fixtures/repos/storefront) without an API key
(rule-based only, from before the key was required, so it has no `llmKey`; `breaking` cut to
3 of 28 here):

```json
{
  "schema": "uptide.run/v1",
  "engineVersion": "0.8.0",
  "repo": {
    "id": 123456789,
    "owner": "acme",
    "name": "storefront"
  },
  "sha": "817261a23a8f53760bdf8e81687c52f05f74ce5f",
  "runId": 11223344557,
  "runAttempt": 1,
  "mode": "fix",
  "startedAt": "2026-10-13T01:12:40.529Z",
  "finishedAt": "2026-10-13T01:13:37.234Z",
  "upgrades": [
    {
      "package": "zod",
      "from": "3.25.76",
      "to": "4.6.7",
      "kind": "major",
      "status": "failed",
      "analysis": "pack",
      "breaking": [
        {
          "symbol": "TS2345",
          "file": "packages/api/src/queue/consumer.ts",
          "line": 19,
          "change": "type"
        },
        {
          "symbol": "ZodType",
          "file": "packages/api/src/queue/consumer.ts",
          "line": 12,
          "change": "signature"
        },
        {
          "symbol": "TS2724",
          "file": "packages/api/src/queue/consumer.ts",
          "line": 2,
          "change": "type"
        }
      ],
      "verification": {
        "typecheck": {
          "before": 1,
          "afterUpgrade": 29,
          "after": 5
        },
        "baselineHealth": {
          "typeErrors": 1,
          "failingTests": 0,
          "missingModules": {
            "local": 0,
            "packages": 0
          }
        },
        "lint": {
          "before": 0,
          "after": 0
        },
        "tests": {
          "passed": 0,
          "failed": 2
        }
      },
      "pr": null,
      "costUsd": 0,
      "durationMs": 55114,
      "error": "verification failed: 4 new type error(s), tests failed in packages/api, tests failed in packages/shared, 4 site(s) left for manual work"
    }
  ]
}
```

A `symbol` is the canonical path of the dependency's symbol (`ZodType`,
`Stripe.Customer#email`), or `TS<code>` for a compiler error the upgrade causes that no
symbol explains. `status` is `up_to_date`, `available` (behind, not migrated this run), `fixed` (verified,
pull request open), `failed` (did not verify, or could not be published; `error` says why) or
`skipped` (a pull request is already open, or `maxCost` was reached). `verification` counts
type errors and failing lint tools before and after, and test runs (one per workspace or
scope); it is null when no migration ran. `typecheck.afterUpgrade` is the count right after
the version bump, before any fix: next to `before` and `after` it says what the upgrade broke
and what the migration left (the job summary prints `types 0 → 4 with the upgrade → 0 after
Uptide`). It is optional, absent in reports written before it. `verification.baselineHealth`
is the repository before the upgrade, in counts only: type errors, failing test runs, and the
missing-module errors among those type errors, under the repository's own paths (`local`:
relative imports and path aliases) and in `packages`. Which modules or aliases are missing
stays in the fix report; the run report never names them. Also optional.

`analysis` says what an empty `breaking` means. `pack`: a migration pack analyzed the upgrade,
so none breaks. `none`: no pack covers it yet, so none was confirmed, which is no answer (the
job summary says "not analyzed: no pack yet" instead of 0). Absent: the upgrade was not
analyzed this run. A companion that moves with another package's upgrade (`react-dom` and
`@types/react` with `react`) carries the versions that upgrade gives it and `movesWith`, the
package it moves with; it is analyzed as part of that package. Both fields are optional:
readers of reports written before them see neither.

`llmKey` is `present` or `missing`: whether the run had an Anthropic key. It is never the key or
any part of it. The Action always sets it; reports written before it have none. A run with
`missing` has no upgrades and an `error` starting with `LLM_KEY_MISSING`.

The report never holds source code, diffs, snippets, compiler messages, commands, output or
environment values: package names, versions, repository-relative paths, line numbers,
symbol names, counts, and sentences Uptide writes itself. Every string field has a pattern
that admits one bounded line without code punctuation, every object is closed, and the
Action checks the report against the schema, and for anything shaped like a credential,
before it is written or sent.

## Trying it

`act` and similar runners issue no OIDC token, so `fix` cannot publish there. To see what a
run reports, use `mode: check` in a workflow, or run the engine the same way locally:

```sh
pnpm uptide check zod --cwd path/to/repo --json
```
