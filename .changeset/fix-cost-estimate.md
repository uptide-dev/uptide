---
"uptide": minor
---

`fix` estimates what the agent's sites will cost and prints the estimate before its first call. When the estimate is above the limit (`--max-cost`, default $1), it stops before spending anything and exits 2: `estimated $3.00 for 50 sites; limit $1.00. Run again with --max-cost 3.00`. Action and App runs never stop on the estimate: they work within `maxCost`, and the summary and the pull request name the sites left and the `maxCost` in `uptide.yml` that finishes them. When the agent stops at the limit, the summary and the pull request name the estimate and the limit that continues. The summary (`Phases`), the pull request's run details and `report.json` (`phases`) give wall time and agent spend per phase.
