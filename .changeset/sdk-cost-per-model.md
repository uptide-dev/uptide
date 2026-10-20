---
"uptide": patch
---

`fix` computes the agent's cost itself, per model and token class, from Uptide's price table: `report.json` and `--json` list each model's uncached input, cache read, 5-minute and 1-hour cache write and output tokens, the rate applied to each and the cost, so the total can be redone by hand. The Agent SDK's own figure is kept apart as `sdkReportedCostUsd`; `--max-cost` counts the higher of the two, a gap above 5% is printed as a warning, and a model missing from the table uses the SDK's figure, marked unverified. `llm.inputTokens` now counts uncached input only.
