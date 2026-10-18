---
"uptide": patch
---

`fix` no longer stops with "baseline tests modified the working tree" when the test run only writes new untracked files, such as a junit `test-report.xml` that is not gitignored. Those files are recorded as test artifacts (`testArtifacts` in the report), kept out of every commit, the agent's diff and the pending-changes check, and removed before each later test run, `uptide verify` included. A change to a tracked file during baseline tests still refuses the run.
