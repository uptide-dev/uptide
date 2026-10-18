---
"uptide": minor
---

`npx uptide fix` gets the Agent SDK executor. `@anthropic-ai/claude-agent-sdk` is now an optional dependency instead of an optional peer, so npm, pnpm and yarn install it with Uptide, along with the Claude Code binary for the platform (about 310 MB more on disk). When it cannot load (`--omit=optional`, no binary for the platform), `fix` runs the patch executor and says so on the first line of its output and at the top of the PR body, with the reason and how to get the SDK executor. `report.json` records `llm.executor` and, after a fallback, the reason in `llm.sdkMissing`. The privacy notice names the SDK only when the SDK will run, and the LLM line names the executor. `--agent sdk` without a loadable SDK stops before any work instead of failing mid-run.
