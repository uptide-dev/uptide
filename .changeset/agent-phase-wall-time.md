---
"uptide": patch
---

`uptide fix` spends less wall time on test runs and dependency copies:

- The agent's own `run_tests` check runs only its runner's related tests when the `test` script builds first and then runs a script that is just the runner (`pnpm run build && pnpm run test:unit`). The gate after the agent's edits and the final verification run exactly what they ran before.
- The upgrade's install moves the installed `node_modules` out of its temporary worktree instead of copying it.
- Each phase of the fix report lists the repository's commands it ran (installs, generators, builds, type-checks, tests, lint, format) with their count and summed wall time. An agent-led run's clean install has its own phase.
