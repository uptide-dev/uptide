---
'uptide': patch
---

`fix` reads pnpm lockfiles that install a package once per version of the upgraded one (`x@1(zod@3.25.76)` next to `x@1(zod@4.3.6)`) instead of failing with "Map keys must be unique". Variants that differ only by that version are compared as one entry; variants that differ in anything else are still checked one by one.
