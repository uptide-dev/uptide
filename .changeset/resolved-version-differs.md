---
"uptide": patch
---

`uptide fix` no longer stops when the package manager resolves a different version than the target. Yarn classic ignored the pin for a direct dependency and resolved a range such as `^7.0.105` to its newest match (7.0.146). Now the lockfile resolves exactly the target with npm, pnpm, Yarn classic and Yarn Berry, and the manifest keeps its range. If the package manager still resolves another version, the run continues only when that version is in the same major, inside the manifest range and covered by the pack. The PR body, the terminal summary and `report.json` (`resolvedVersion`, `lockfile.resolved`) then name both versions. Otherwise the run stops with an error that names the target, the resolved version and the reason.
