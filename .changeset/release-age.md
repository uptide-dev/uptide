---
'uptide': minor
---

`list`, `check`, `fix` and the Action never target a release younger than the repository's
release-age policy: npm `min-release-age` (`.npmrc`), pnpm `minimumReleaseAge` with
`minimumReleaseAgeExclude` (`pnpm-workspace.yaml`), or Yarn `npmMinimalAgeGate` with
`npmPreapprovedPackages` (`.yarnrc.yml`). When the newest release is too young, the newest one
old enough is the target and the output says why (`4.6.7 is 2 days old; your policy is 7 days
(min-release-age in .npmrc); targeting 4.6.5`); when none newer than the installed version
qualifies, the package is skipped with that reason, `status: skipped` in `uptide.run/v1`.
Companions and peers follow the same policy. `min-release-age` in `uptide.yml` (days) applies
to a repository with no policy of its own. See `docs/config.md#release-age`.
