---
title: uptide pr
description: Push a finished migration branch and open its draft pull request with the stored report; regenerate a description with pr-body.
---

# `uptide pr` and `uptide pr-body`

For someone with a verified branch from `fix` who wants it on GitHub. `uptide pr --help` and
`uptide pr-body --help` list the flags.

## `uptide pr`

```sh
uptide pr --branch uptide/stripe-23.0.0          # the plan, nothing pushed
uptide pr --branch uptide/stripe-23.0.0 --yes    # push and open a draft PR
```

`pr` loads the stored run for the branch (written by `fix` or `verify` under `.git/uptide/`),
checks the recorded verified tree hash against the branch tree (and the recorded commit), prints
which repository the pull request goes to, and with `--yes` pushes the branch and opens the
pull request with the stored description. On a fork the pull request goes to the fork itself,
never its parent unless `--repo` names it. New pull requests are drafts by default; `--draft`
remains accepted. Nothing is pushed without `--yes`; `fix --pr --yes` does the same at the end
of a migration.

A missing or mismatched verified tree refuses publication with exit 1 before any push. Runs
created before tree hashes were recorded need `uptide verify` first. An export failure keeps
the verified clone; restore that work before publishing instead of pushing the older local branch.

GitHub is reached through your own `gh` only when you pass `fix --pr` or run `pr` /
`pr-body`.

## Pull request descriptions

`fix` stores the run in `.git/uptide/<branch>/report.json`, with the verified commit, Uptide
version/commit, rule IDs, patches, agent reasoning and run metadata. Descriptions show a
computed risk, a five-row summary, changes grouped by rule, and actionable review items.
Risk is Low for verified rule-only edits, Medium for agent edits, sensitive paths or missing
tests, and High for unverified sites, behavior changes or remaining manual work. A generic
package's risk is never Low. Unchecked schema samples are called out separately; they do not
imply unresolved compiler sites.

Diffs, file lists, verification and run details are collapsed; the Action comment and the
terminal share the compact migration renderer. Builds embed the Uptide commit and whether its
source checkout had working-tree changes.

## `uptide pr-body`

To regenerate an existing description without another migration or any push:

```sh
uptide pr-body --pr 12 --preview           # review the complete proposal first
uptide pr-body --pr 12                     # update only the description
# For a retained eval run, add --cwd /path/to/target/repo --run /path/to/report.json.
```

The selected pull request must match the stored run's branch and verified commit.
`pnpm exec tsx scripts/reverify-run.ts <run.json> [output.json]` (in an Uptide checkout)
refreshes behavior and type verification on the recorded commit without installing or
changing source.
