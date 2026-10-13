---
'uptide': patch
---

When Uptide refuses to publish a migration that did not verify, it words the reason as the
run's verdict does: `1 type error introduced by the upgrade, 2 pre-existing` instead of
`1 new type error`, and a test run that was already failing before the upgrade is named as
such instead of as a failure of the migration.
