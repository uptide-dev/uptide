---
"uptide": patch
---

`uptide fix` no longer upgrades a peer blocker across a major that no migration pack covers. Before, `redis` 5 → 6 next to `typeorm` 0.3 (which peers on redis ^5) moved typeorm to 1.1.0 and ended in an agent-led draft. Now the blocker keeps its version, with a peer override scoped to it in package.json: npm `overrides.<blocker>.<peer>`, pnpm `pnpm.peerDependencyRules.allowedVersions`, Yarn `resolutions["<blocker>/<peer>"]`. The lockfile scope check still covers the install. The PR body names the override, which release was not taken and why. In `report.json`, each `peerConflicts` entry now has `strategy` (`override`, `blocked` or `none`), `declined` and `override`. If verification fails with the override, the blocker is reported as a blocker and is still not upgraded. A blocker you name on the command line, or one whose major a pack covers, is upgraded as before.
