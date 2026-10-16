---
"uptide": minor
---

The typescript 5 to 6 and express 4 to 5 packs are now verified, so `check`, `list` and `fix` use them by default. Both measure verified under the stricter gate on unchanged ground truth: typescript across 7 public repositories (1,399 real breaking sites, no breaking false positive; its `downlevel-iteration`, `import-assertions` and `module-keyword` rewrites stay assisted until a real site exercises them), express across 4 (86 real breaking sites, no breaking false positive).
