---
"uptide": minor
---

`npx uptide fix` gets the Agent SDK executor. The package stays as small as before: `@anthropic-ai/claude-agent-sdk` is not installed with Uptide. An SDK installed next to Uptide is used as it is; otherwise the first `fix` that needs it installs the version Uptide is tested with into Uptide's cache (`~/.cache/uptide/agent-sdk/<version>`), says so in one line with its size, and later runs reuse it. When that install fails (offline, a proxy) or the SDK cannot run, `fix` runs the patch executor and says so on the first line of its output and at the top of the PR body, with the reason and how to get the SDK executor. `report.json` records `llm.executor` and, after a fallback, the reason in `llm.sdkMissing`. The privacy notice names the SDK only when the SDK will run, and the LLM line names the executor. `--agent sdk` without a usable SDK stops before any work instead of failing mid-run.
