---
"uptide": patch
---

Allow pnpm peer-suffix and non-resolution lockfile metadata changes during upgrades. Continue checking each unrelated package and importer specifier/resolved version, with named diagnostics for importer changes. npm and Yarn scope checks are unchanged.
