---
'uptide': minor
---

`list`, `check`, `fix`, `plan` and the Action never target a release younger than the
repository's release-age policy: npm `min-release-age` (`.npmrc`), pnpm `minimumReleaseAge`
with `minimumReleaseAgeExclude` (`pnpm-workspace.yaml`), or Yarn `npmMinimalAgeGate` with
`npmPreapprovedPackages` (`.yarnrc.yml`). When none is set, the default of the pinned package
manager version applies (pnpm 11 and 12, Yarn 4.15 and later: one day), labelled as such.
When the newest release is too young, the newest one old enough is the target and the output
says why (`4.6.7 is 2 days old; your policy is 7 days (min-release-age in .npmrc); targeting
4.6.5`). When nothing newer than the installed version qualifies, the package is skipped with
that reason, shown as `status: skipped` in `uptide.run/v1` and in the HTML list report.
Companions and peers follow the same policy. `minReleaseAgeDays` in `uptide.yml` applies when
the repository sets no policy itself. See `docs/config.md#release-age`.
