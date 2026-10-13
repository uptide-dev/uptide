---
'uptide': patch
---

Reports say what the upgrade broke and what the migration left. `uptide.run/v1` gains
`verification.typecheck.afterUpgrade`, the type errors right after the version bump and before
any fix, next to `before` and `after` (optional; absent in older reports). The job summary
prints `types 0 → 4 with the upgrade → 0 after Uptide`, and the pull request body and the
terminal say `the upgrade broke 4 · Uptide left 0`.
