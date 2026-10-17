---
"uptide": patch
---

The Sentry packs now read JavaScript files that only require another Sentry package (`@sentry/core`, a sibling SDK of the same release), which the TypeScript compile scope skipped. `@sentry/browser` breaking recall on public ground truth goes from 50% to 82% with no false positives.
