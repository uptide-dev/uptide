---
'uptide': minor
---

Add a verified React Router 6 → 7 migration pack, which also runs for applications that declare only `react-router-dom`. It moves `react-router-dom` imports to `react-router`. It reports, with a guide for the agent, the rest of the upgrade: the removed `future` prop and router option, `react-router-dom/server`, lowercase `formMethod` comparisons and `json`/`defer` calls (found by syntax where the compiler is blind), the other removed exports, and `generatePath` calls that pass `null` for a required parameter. The six v6 future flags that become defaults are reported as decisions where the repository's router setup has not enabled them. React Router 7 → 8 is a separate upgrade.
