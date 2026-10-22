---
"uptide": patch
---

`fix` and `check` in a checkout whose dependencies are not installed now stop before any analysis with `NOT_INSTALLED` (exit 2, and `error.code` in `fix --json`), name the `package.json` that declares the package, say whether nothing is installed or only that package is missing, and give the frozen install for the lockfile (`npm ci`, `pnpm install --frozen-lockfile`, `yarn install --frozen-lockfile`, `yarn install --immutable`). Before, a `node_modules` in a directory above the project counted as the project's install, so a fresh clone under such a directory got past the check and `fix` failed with "has no upgrade to <version>". Uptide still installs nothing in your checkout.
