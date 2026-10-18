---
"uptide": patch
---

`fix` on npm no longer loses a package the repo imports without declaring it when the ERESOLVE retry re-resolves the lockfile. If the retry drops such a package from the top of `node_modules`, it runs again keeping that package and the locked packages that require it at their old versions; if that conflicts, the first retry stands. Either way the summary and the PR body name the package under "Imported but not declared" and suggest adding it to package.json. `fix` never adds it for you.
