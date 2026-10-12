---
'uptide': patch
---

Yarn 2 and 3 lockfiles: follow dependency references written without the `npm:` protocol, so a moved package's own subtree is recognized. `fix` no longer rejects a new major that swaps its dependencies (for example `cmdk` 0.2 → 1.0 replacing `@radix-ui/*` 1.0.0 with 1.1.x) as "changed resolutions outside the dependency subtree", and importer resolutions in these lockfiles are now compared too. Changes reached only from packages that did not move are still rejected. The report lists each allowed transitive change under the package that moved it.

A root `resolutions`, `overrides` or `pnpm.overrides` entry that pins a package the upgrade moves now stops the run before the baseline and the install, naming the entry, instead of failing after the install (on medusa: 33 s instead of 11 min). With Yarn 2+, a moved package whose range the plan rewrote is pinned to the exact planned version too (it resolved the newest match before).

Temporary clones are removed on exit, including after a failed or interrupted run. `--keep-temp` (or `--debug`, which also prints every phase) keeps one; `--keep` still works as before.
