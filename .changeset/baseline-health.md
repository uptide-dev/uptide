---
'uptide': patch
---

`fix` measures the repository before the upgrade and says first when it is unhealthy: "this repository does not type-check before the upgrade (205 errors, 129 from missing modules: …); verification can only compare, not prove". On such a baseline, a run that adds no error reads `no new errors` instead of `verification passed`, and a failing run says how many type errors the upgrade introduced and how many were already there. The gate is unchanged. `check` prints the pre-existing type errors under each compiled package, and the stored report carries `verification.baselineHealth` (type errors, failing test runs, missing modules grouped by path alias or package).
