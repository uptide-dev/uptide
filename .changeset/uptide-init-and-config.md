---
'uptide': minor
---

New `uptide init`: writes `.github/workflows/uptide.yml` and `uptide.yml` for the repository, the same files the Uptide GitHub App proposes in its "Add Uptide" pull request. It detects the package manager, Node version and workspaces, pins every action to a commit, installs with lifecycle scripts off, and refuses with a reason (Bun, no lockfile, no package.json, a lockfile that disagrees with `packageManager`) instead of writing files that would not work. `--dry-run` prints the files and the pull request text. No commit, no push, no network.

New `uptide.yml` settings file (`version: 1`, JSON Schema in `schema/uptide.v1.json`): `packages.allow`/`deny`, `schedule`, `maxOpenPrs`, `llm.enabled`/`provider`, `maxCost` and `executor`. `list`, `check` and `fix` read it when present (or the file `--config` names), and flags override it; `fix` gains `--llm` to turn assisted fixes back on when the file turns them off. See `docs/config.md`.
