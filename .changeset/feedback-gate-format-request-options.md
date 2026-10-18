---
"uptide": patch
---

`fix` no longer rejects a verification-feedback patch for test failures the parent commit already had. When the test script builds first and the build failed on the error being fixed, the round's start had no test results to compare with, so a correct patch was reverted every round. `check` and `fix` now also analyze files that reach a package's wrapper through a barrel (`import { getStripeClient } from '../stripe'` with `export * from './client'`). Edited files are formatted with oxfmt and dprint as well as biome and prettier, from the workspace that holds them, with its own configuration, else the root's. The stripe pack adds `request-options`: request options passed in the params slot (`subscriptions.cancel(id, { idempotencyKey })`), which SDK 22 rejects, move to the third argument. It runs assisted until a ground-truth repository exercises it.
