---
"uptide": patch
---

The PR body titles each group of sites by what changed instead of an internal key: a pack rule's group by the pack's one-line summary of the rule (`report.json` keeps them as `ruleSummaries`), and sites no rule covers, keyed by the path of the declaration that changed (`e.query`), by what the compiler said there or by what changed ("`e.query` was removed in express 5.3.0").
