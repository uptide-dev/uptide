---
"uptide": minor
---

`fix` estimates what the agent's sites will cost before its first call and, without `--max-cost`, sets the limit to twice that estimate, from $1 up to $10. When the agent stops at the limit, the summary and the pull request name the estimate and the `--max-cost` that continues. The summary (`Phases`), the pull request's run details and `report.json` (`phases`) give wall time and agent spend per phase.
