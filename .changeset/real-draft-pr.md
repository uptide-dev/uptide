---
'uptide': patch
---

Fix `uptide pr --yes` opening a ready-for-review pull request when `--draft` is omitted. New pull requests now default to drafts, matching `fix --pr --yes` and the migration report's instructions.
