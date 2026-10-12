---
'uptide': patch
---

Find more of what an upgrade breaks. Named checks now also compile the files that directly import a package's importers when what they import depends on the package, within a 20% memory budget, so a test calling a wrapped tool's `execute` is reported. The `ai` pack flags `ToolLoopAgent`, `Agent` and `ToolLoopAgentSettings` type arguments, whose third position is now the runtime context, and finds renamed options inside spread objects, behind `as`/`satisfies`, and in an agent's `stream`/`generate` calls. Breaking recall: `ai` 36% → 82%, `zod` 71% → 74%, with no false positives.
