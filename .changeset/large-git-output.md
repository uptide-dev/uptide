---
"uptide": patch
---

Prevent `fix` from failing with `spawnSync git ENOBUFS` when Git output exceeds 1 MiB in large repositories. Raise the buffered output limit to 256 MiB for shared Git operations and source-version status checks.
