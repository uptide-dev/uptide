---
"uptide": patch
---

A companion that would move a new major is planned only when the upgraded package asks for it: its own manifest at the target pins the companion, the companion's manifest declares the upgraded package, or the upgraded package's pack names it. When a third package asks for it (`@guardian/libs` 33 pinning `@guardian/ophan-tracker-js` 3.1.0 during a typescript upgrade), Uptide no longer moves it. The PR lists it under "Blocked" with the declaring package, the manifest field and the range. Release pairs still move with their lead: `react-dom` with `react`, `@ai-sdk/*` with `ai`, `@sentry/profiling-node` with `@sentry/node`.
