---
"uptide": minor
---

Add `verify.build` to uptide.yml: the package.json script a migration pack's required build runs. Unset, Uptide runs `build:ci`, then `build-ci`, then `build`. When a build fails before the framework's build starts because it needs an environment variable or a database (`prisma db push` without `DATABASE_URL`), the pull request and the report say so ("build needs DATABASE_URL; set verify.build") instead of a bare "build failed". `uptide init` writes the setting as a comment.
