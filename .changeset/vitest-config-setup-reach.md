---
"uptide": patch
---

The vitest pack now reads `vite.config.*` and `vitest.config.*` files and jest-dom setup files that never import `vitest` (a config that takes `defineConfig` from a shared file, a setup file that only does `import '@testing-library/jest-dom/vitest'`), so it reports their bare-directory coverage patterns and jest-dom registrations.
