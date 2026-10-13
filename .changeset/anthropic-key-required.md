---
'uptide': minor
---

The Uptide Action now requires the Anthropic API key. Without `anthropic-api-key` (or with it
empty), in any mode, it stops before doing anything: the job summary says to add the
repository secret `ANTHROPIC_API_KEY` (Settings → Secrets and variables → Actions), the run
report has no upgrades and an error starting with `LLM_KEY_MISSING`, and the job fails.
`uptide.run/v1` gains `llmKey` (`present` or `missing`; never the key). `uptide init` no longer
writes `llm.enabled`, and refuses an existing `uptide.yml` that sets it to `false`, which the
Action rejects. The CLI on your own machine still runs without a key.
