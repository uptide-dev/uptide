---
"uptide": patch
---

`pack test --write` records how many breaking sites a breaking-severity finding landed on (`breakingFound`), and the pack tables in the README and the compatibility matrix show it as "Breaking found as breaking" beside recall, which also counts the sites a pack reports only as deprecations. Packs recorded before it show `—`.
