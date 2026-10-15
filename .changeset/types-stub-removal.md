---
'uptide': minor
---

`check` and `fix` remove a deprecated `@types` stub instead of upgrading to it. When the release the upgrade would move `@types/<pkg>` to is deprecated on npm, and `<pkg>`'s target declares its own types (`types`, `typings` or a `types` export), the plan removes it: "Removed: @types/ioredis, ioredis 5 ships its own types", in `check` and in the PR body. `check` now diffs such a package against its own target types instead of failing on a stub with no declarations, and `fix` removes the entry in the same install, with the install scope guard allowing exactly that removal.
