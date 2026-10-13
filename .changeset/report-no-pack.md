---
'uptide': patch
---

Reports no longer show a breaking count of 0 for a package without a migration pack: the
terminal, the HTML report and the Action's job summary say `not analyzed: no pack yet`
instead, and `uptide.run/v1` gains `analysis` (`pack` or `none`, absent when nothing was
analyzed). A companion that `check` reports at its installed version (`react-dom` or
`@types/react` with `react`) shows the versions it moves to and `moves with react`, carried as
`movesWith`, instead of `up to date`; no upgrade kind is printed when nothing moves. The job
summary lists breaking sites per package by path and line, and has no breaking-sites section
when there are none. The generated workflow runs on `ubuntu-24.04` instead of `ubuntu-latest`.
