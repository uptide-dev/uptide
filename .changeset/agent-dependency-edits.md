---
"uptide": patch
---

The agent can no longer change dependencies outside the upgrade. An agent edit that changes or removes an existing dependency in any `package.json`, or touches `overrides`, `resolutions` or the `pnpm` field, is refused and reverted. Uptide sends the refusal back to the agent in the next feedback round, naming the package, and records it in `report.json` (`outOfScopeDependencyEdits`). That includes the upgraded package and its planned companions, whose versions the engine wrote: only a rewrite to the same value is allowed. The agent may still add a new dependency: it is kept, recorded (`agentAddedDependencies`) and listed under "Added by the agent" in the PR body. Lockfiles, `.npmrc`, `.yarnrc(.yml)`, `.pnpmfile.cjs`, `pnpm-workspace.yaml` and new `package.json` files are read-only for the agent.
