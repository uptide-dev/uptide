---
"uptide": patch
---

`fix zod` rewrites `z.string().uuid()` to `z.guid()` by rule without `--include-deprecated`: zod 4's `uuid()` also checks the RFC version and variant, so ids zod 3 accepted stop validating, and `check` now counts the site as breaking. `fix` no longer reports false pre-existing type errors on a TypeScript 7 repository whose `lib` names a library newer than its `target` (`lib: ["ES2023"]` under `ES2022`).
