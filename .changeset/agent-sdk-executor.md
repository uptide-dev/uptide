---
'uptide': minor
---

Experimental, hidden: `uptide fix <package> --agent sdk` runs assisted fixes as Claude Agent SDK sessions in the temporary clone, one per pack rule over its files, gated at the end of each task. Anthropic only; needs `@anthropic-ai/claude-agent-sdk` installed (an optional peer, never bundled). The default agent is unchanged. See `docs/decisions/0016-agent-sdk-executor.md`.
