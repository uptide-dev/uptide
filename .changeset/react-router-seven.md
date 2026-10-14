---
'uptide': minor
---

Add a verified React Router 6 → 7 migration pack. It moves `react-router-dom` imports and `react-router-dom/server` to `react-router`, removes the v6 `future` prop and router options, uppercases lowercase `formMethod` comparisons (found by syntax where the compiler is blind), guides `json`, `defer` and the other removed exports, and reports the six v6 future flags that become defaults as decisions where the repository's router setup has not enabled them. React Router 7 → 8 is a separate upgrade.
