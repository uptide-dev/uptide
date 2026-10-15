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

Closing a pull request does not delete its branch, so the branch may already be on GitHub.
When it is:

- at the verified commit already: nothing is pushed;
- with an open pull request and only Uptide's commits beyond the base (the Uptide App's
  bot, or the legacy `uptide[bot]`): the branch is replaced with the verified commit
  (`--force-with-lease`, against what was just read) and that pull request's description is
  updated, instead of opening a second one;
- with no open pull request and only Uptide's commits: the branch is replaced the same way
  and a new pull request is opened;
- with any commit by someone else, or commits that cannot be read: it is never overwritten.
  The verified commit goes to the next free `<branch>-2`, `-3`, … (by the same rules) and
  the pull request description says so at the top.

A commit made with your own git identity counts as someone else's, even on a branch Uptide
created. When publication fails in the Action, the job summary and run report name the
reason (for example, "the branch on GitHub changed while it was being published").

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

Diffs, file lists, verification and run details are collapsed; the terminal shows the same
migration in the compact renderer. Builds embed the Uptide commit and whether its
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

Descriptions use a 60,000-character budget for every pack. The summary table, representative
“What changed” diffs, “Decisions for you” and “Worth a look” stay; verification output takes
space before additional file/attempt history, changelog lists and transitive changes. Omission
notices name the trimmed material and point to the retained `report.json`. Actions job summaries
also show verification results. The unabridged migration report retains the full text.

Stripe descriptions keep every change with concrete code evidence visible above “What changed”,
without a cap. Other changes to resources you use have no code evidence: they are collapsed,
grouped by resource and capped at five per resource and twenty overall, with breaking entries
first. One line counts what is shown and omitted and points to the full list in `report.json`.
A Stripe changelog link names the recorded API version range. If required evidence alone exceeds the budget, rendering refuses rather
than silently removing a decision or representative diff; narrow the migration before publishing.
