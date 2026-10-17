---
'uptide': patch
---

The Sentry 10 to 11 pack no longer reports `beforeSendTransaction` or `ignoreTransactions` in a `Sentry.init` that sets `traceLifecycle`: the option keeps transactions, so they still work.
