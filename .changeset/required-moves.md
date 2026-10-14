---
'uptide': minor
---

`check` and `fix` plan what the target version requires: a package the target, or anything moving with it, declares as a peer or dependency at a range the installed copy rejects moves to the lowest release of its major that satisfies it (openai 7 moves zod 3.24.2 to 3.25.0), shown apart from release-group companions ("moved because openai 7.4.0 requires zod ^3.25 || ^4.0"). A move only a new major makes is never made: it is reported as a blocker with the exact range in `check`, the PR body and `pack test`. The npm install scope guard no longer lets a declared root dependency change because a moved package peers on it.
