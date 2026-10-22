---
"uptide": patch
---

`fix` and `check` in a checkout whose dependencies are not installed now stop before any analysis with `PACKAGE_NOT_INSTALLED` (exit 2), name the `package.json` that declares the package, say whether nothing is installed or only that package is missing, and give the frozen install for the lockfile (`npm ci`, `pnpm install --frozen-lockfile`, `yarn install --frozen-lockfile`, `yarn install --immutable`). Before, a `node_modules` in a directory above the project counted as the project's install, so a fresh clone under such a directory got past the check and `fix` failed with a misleading "has no upgrade". Uptide still installs nothing in your checkout. `check --json` now answers every refusal on stdout with `{"error": {"code", "message"}}`, as `fix --json` does. When the package is already at or past the target, `fix` says "<package> is already at <version> (target <target>)".
