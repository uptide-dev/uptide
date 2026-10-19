---
"uptide": patch
---

Let the agent add a property the upgraded types made required to a test fixture: only to the object the compiler's TS2739, TS2740 or TS2741 error points at, and only with a literal value. Every other test input change is still rejected. Each such property is listed under "Tests changed: review" in the PR body and in report.json (file, line, property and the value the agent chose). Name a test that asserts a dependency default the upgrade changed (Sentry's `dataCollection` and `attachStacktrace`) under "Decisions for you", instead of leaving it to fail unexplained.
