---
"uptide": patch
---

`fix` no longer runs out of memory type-checking monorepos whose root tsconfig includes every package: each workspace's program holds only the files that workspace owns, and the baseline check releases one workspace's program before building the next. When the analysis thread does run out of memory, `fix` says the repository is too large for analysis instead of crashing, and its temporary clone is removed on every exit path, a crashed or out-of-memory analysis thread included.
