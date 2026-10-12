---
'uptide': patch
---

Fix jest test runs that never ran: with service tests left out, the planned command put the affected files after `--testPathIgnorePatterns`, which read them as patterns, so jest stopped with "--findRelatedTests requires file paths" before and after the change and the failure was marked pre-existing. Paths now come first. When the related-tests command fails without a failing test, the repository's `test` script runs instead (or, when that would reach services, the same runner over the workspace, unit tests only), after `pretest` when there is one.
