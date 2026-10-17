---
"uptide": patch
---

`check` and `fix` now measure how many of the files that use the upgraded package the repository actually type-checks (TypeScript, plus JavaScript under `checkJs` or `// @ts-check`). When that is under half, the summaries say `types cover N of M affected files` and no longer present a clean compile as proof: `fix` passes only when a test run or a build passed, and says the verdict rests on them.
