---
"uptide": patch
---

`uptide pack test` now prints the precision of every rule with a rewrite, breaking or not, and warns when one is below 80%. It is a warning only: no pack's status and no rule's run mode changes. The compatibility matrix lists each rewrite's precision.
