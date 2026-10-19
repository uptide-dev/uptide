---
"uptide": patch
---

Let the agent add a property the upgraded types made required to a test fixture, when the compiler reported it missing (TS2739, TS2740, TS2741) and the value is a literal; every other test input change is still rejected. Name a test that asserts a dependency default the upgrade changed (Sentry's `dataCollection` and `attachStacktrace`) under "Decisions for you", instead of leaving it to fail unexplained.
