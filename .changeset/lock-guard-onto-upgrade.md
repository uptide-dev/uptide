---
"uptide": patch
---

The lockfile check no longer stops an upgrade when the package manager moves an unchanged package's dependency onto the copy the upgrade installs. Upgrading express 4 to 5, pnpm can move another package's `qs` or `iconv-lite` onto the newer copy express 5 brings: the old copy leaves the lockfile, and every package depending on it read as "same version, different resolution", so the run fell back to an agent-led draft. Such a move is now in scope when it stays in the same major (the same minor below 1.0) and never goes back, and the copy it left goes with it when nothing else needs it; the PR body and the terminal list each one as lockfile housekeeping ("onto the upgrade's copy"). A move to a release the upgrade did not bring, a downgrade, a major apart, or a change to what the repository declares itself is still refused. The same applies to npm (a nested copy dropped for the hoisted one) and Yarn Berry (a descriptor that now resolves to the upgrade's copy).
