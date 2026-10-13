---
'uptide': minor
---

`uptide/onboarding` loads where it broke: under plain Node ESM, Vitest and Turbopack, and in a browser bundle. It no longer inlines `yaml` (its CommonJS build called `require("process")` inside an ES module); `yaml` is now a dependency of the package. The entry is pure, with no file system and no Node globals: `loadUptideConfig` and `snapshotFromDisk` move to `uptide/onboarding/node` (breaking for code that imported them from `uptide/onboarding`). The command line is unchanged.
