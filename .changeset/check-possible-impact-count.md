---
"uptide": patch
---

`check` no longer lists possible impact (type changes nothing confirmed as breaking) on its first screen: each package says it in one line, `+N possible impact in M files, not counted as breaking`, and `--details` and `--json` still have every site. A package whose types were partly verified no longer repeats its coverage line in the heading, and a monorepo's unbuilt workspace chains are one count on that line.
