---
"uptide": minor
---

Sentry 10 → 11: report every `Sentry.init` whose data collection widens because `dataCollection` is unset, citing the migration guide, and give the agent the exact v10 baseline: the guide's block plus `frameContextLines: 7`. After a fix, a site counts as kept only when every category is at least that restrictive and the seven context lines are kept, so a partial edit such as a cookie deny list stays open in the PR instead of being reported as kept. The agent now keeps privacy settings at their most restrictive value, or leaves them as a decision, when no cited edit exists.
