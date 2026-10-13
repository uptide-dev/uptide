---
'uptide': minor
---

The Uptide Action: `action.yml` at the root of this repository now runs Uptide in a repository's own GitHub Actions (`mode: list | check | fix`, `package`, `config`, `anthropic-api-key`, `app-url`). It builds the engine of its own pinned commit, migrates with `--agent sdk` by default, and opens draft pull requests with a short-lived installation token of the Uptide GitHub App, obtained for the job's OIDC token, so those pull requests run the repository's CI. Each run writes an `uptide.run/v1` report to the job summary and sends it to the Uptide app; a failed upload is a warning. It replaces the earlier Renovate/Dependabot pull-request checker that lived at the same path; workflows pinned to an earlier commit keep running that one.

New `uptide/report` export: the `uptide.run/v1` types, its JSON Schema (also `uptide/report/schema.json`), a validator and the summary renderer. The report holds no source code, diffs, snippets or environment values: paths, line numbers, symbol names and counts only.

`uptide init` and the "Add Uptide" pull request now write `permissions: contents: read, id-token: write`; the Action pushes with the Uptide GitHub App's token instead of `GITHUB_TOKEN`.
