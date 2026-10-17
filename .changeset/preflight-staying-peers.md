---
"uptide": patch
---

Stop `fix` in preflight on npm when a package that moves, or a peer npm installs for it, rejects a package that stays installed: vitest 5 peers on vite, and vite 8 rejects the repository's esbuild 0.25. Before, npm refused the install after the clone. The row names the chain, and `--allow-peer` writes the override.
