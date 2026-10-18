---
"uptide": patch
---

`check` folds a compile error into the breaking site it comes from when the compiler traces its value there (an `errors.map(e => e.message)` under a `result.error.errors` that zod 4 no longer types, and the narrowing that depended on it). The rule's line shows `+N downstream errors`, `--details` lists them under their site, and `--json` carries them as that finding's `downstream`. They are no longer separate breaking sites. `fix` still verifies against every error.
