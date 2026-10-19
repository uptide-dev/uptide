---
"uptide": patch
---

A build that fails the same way before and after the upgrade (same command, status and output) no longer fails verification. Builds are now compared to the baseline the same way tests are. The PR says `⚠️ build: failing at baseline, not checked`, and the verdict reads `no new errors`, not `verification passed`. A build that passed at baseline and fails after the upgrade still fails, and so does one that fails differently. Without a pack, a run like this still does not publish, because its build cannot verify the bump.
