---
"uptide": patch
---

Move only packages released with the upgraded one. A pack's declared release group now bounds the lead's npm scope, and without one a same-scope package moves only when a pin, a peer or a release at the target relates it to the group. Packages of the scope that are versioned on their own (`@sentry/vite-plugin` 5.x, `@sentry/cli`, the old `@sentry/utils` 8.x) are reported as "stays at X" in `check`, the pull request and `pack test` instead of making `fix` refuse the whole upgrade. Registers the verified `@sentry/react` 10 to 11 pack.
