---
'uptide': patch
---

`check` analyzes a package's companions at the versions its upgrade moves them to, even when
nothing imports them or they only carry types: `check react` in a Next app used to report
`react-dom` and `@types/react` on their own at their installed versions, while `react` moved
to 19. They are now members of `react`'s group, linked into the compile at 19, and the
Action's job summary shows each one moving with `react`.
