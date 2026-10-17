---
"uptide": patch
---

Suggested commands no longer print `uptide` when the launcher found is a project-local `node_modules/.bin` entry (as under `pnpm run`/`pnpm exec` or npm scripts); only a real global install does, otherwise `npx uptide`.
