---
"uptide": minor
---

Add verified Sentry JavaScript SDK 10 to 11 migration packs for `@sentry/nextjs` and `@sentry/browser`, with the SDK's lockstep release group, a required build for Next.js, and inventory-scoped decisions for data collection, span streaming, sampling and platform minimums. Mechanical rules move `withSentryConfig` to `@sentry/nextjs/config` and the removed build options under `webpack`, remove `enableLogs`/`enableMetrics: true`, and rename exports, integration names and `httpIntegration` options; privacy, sampling, profiling and OpenTelemetry choices stay assisted and are reported for the owner. Fix `uptide pack new` dropping registry entries long enough to be wrapped.
