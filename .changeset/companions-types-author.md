---
'uptide': patch
---

`check` analyzes what moves with a package at the versions its upgrade gives them: a companion
the repository never imports directly (`react-dom` in a Next.js app) or a types package
(`@types/react`) is linked into the lead's target program and reported as moving with it,
instead of at its installed version as if nothing moved it. `fix` reports the type errors
right after the version bump, before any edit: `the upgrade broke 4, Uptide left 0` in the
pull request and the terminal, `verification.typecheck.afterUpgrade` in `uptide.run/v1` and
the job summary. The Action commits as the GitHub App's bot account
(`<id>+<slug>[bot]@users.noreply.github.com`) when the Uptide app names the App.
