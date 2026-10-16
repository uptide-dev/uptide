---
"uptide": patch
---

Fix standard-library resolution in TypeScript 7 repositories using the bundled compiler, avoiding invented baseline errors such as missing Object.hasOwn. Compare the parent baseline with the repository's tsc directly without running package scripts, identify that checker in report notes, and report mismatches as an Uptide setup problem.
