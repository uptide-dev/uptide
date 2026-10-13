---
'uptide': minor
---

`uptide fix <package>` with Anthropic selected runs assisted fixes as one Claude Agent SDK session in the temporary clone, covering the package's manual sites and their rule knowledge, gated once at the end of the session. It is the default when `@anthropic-ai/claude-agent-sdk`, an optional peer that is never bundled, is installed next to Uptide; without it, the patch executor runs and the output says what to install. Use `--agent patch` to opt out; other providers keep the patch executor. See `docs/decisions/0016-agent-sdk-executor.md`.

Stripe period helpers accept both endpoint payload shapes, and both executors share the same period knowledge.
