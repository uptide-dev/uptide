---
'uptide': patch
---

`fix` and `verify` run each workspace's tests once. When the repository's root `test` script only runs every workspace's own (`pnpm -r run test`, `npm test --workspaces`, `yarn workspaces foreach -A run test`, `turbo run test`), it is planned as those scripts instead of beside them: before, a selected workspace's tests ran twice, once from the root and once on their own. The same scripts run, and each is reported under its own workspace.
