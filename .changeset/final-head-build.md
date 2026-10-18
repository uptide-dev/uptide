---
"uptide": patch
---

`uptide fix` judges consumed workspace builds on the final head, not on the tree right after the bump. A build that failed after the bump and passes once the edits land no longer starts a feedback round, adds an "Agent-led draft" reason or shows "Build failed" in the PR body. The builds run again only when the tree changed since their last result, and not at all when the verification build already built those workspaces. The fix report's `buildRuns` gives the number of builds the run executed and their wall time.
