---
"uptide": patch
---

An SDK session's edits are no longer thrown away because of one flaky test. Before the gate rejects a session on test failures, it runs the failing test files once more, alone, with their runner and the same isolation as the full run. A file that passes then is recorded as flaky (`llm.tasks[].flaky` in `report.json`, and a line in the PR body's review list) and the edits stay. A file that fails twice still rejects them, and a failure that names no test file (a build, a timeout) is never rerun. Final verification keeps its full gate: it runs the flaky files again, and if one fails there, verification fails and the PR body says so. `fix` also stops starting verification feedback sessions when what is left of `--max-cost` is below the mean cost of the run's sessions so far, so it no longer starts a session it can't afford; the PR's feedback line says when this happened.
