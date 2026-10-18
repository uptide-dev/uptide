---
"uptide": patch
---

`uptide fix` rebuilds consumed workspaces on the final head before the verdict and before each feedback decision. A build that failed right after the bump and passes once the edits land no longer starts a feedback round, adds an "Agent-led draft" reason or shows "Build failed" in the PR body.
