---
"uptide": patch
---

`uptide pack test` scores each expected site at the severity of the rule or behavior note it belongs to, so a missed note that only needs a look, or a decision, no longer counts as a missed break. Behavior-note sites get their own precision and recall in the output and in `verification.json` (`behavior`, with the counts behind each rate), false negatives show their severity, and a rate with nothing to measure prints `n/a` instead of 100%, in `pack test` and in the README's packs table.
