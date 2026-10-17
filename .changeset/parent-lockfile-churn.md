---
"uptide": patch
---

`fix` no longer refuses on lockfile changes the upgrade didn't cause. When the install guard finds resolutions outside the upgrade's subtree, it runs the same install at the parent commit and judges the upgrade against that lockfile. Churn the parent install already produces is listed as "Lockfile churn the parent commit already has" and never blocks; changes only the upgrade makes are still refused, or listed for review in agent-led runs.
