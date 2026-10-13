---
'uptide': minor
---

Uptide no longer opens a pull request for an upgrade it could not analyze. A major upgrade
that no verified pack covers is never published: `uptide fix --pr` refuses it before anything
changes, `uptide pr` refuses a stored run of one, and the Action reports it as `skipped` with
`analysis: "none"` and the reason `no pack yet` instead of migrating it. A minor or patch
without a pack is published only when the repository's own `build` script and tests pass
after the bump; `fix` now runs the build for runs without a pack and records it in
`verification.build`. Every PR description has a **Verified by** row naming what vouched for
it (the pack, the type-check, the build, the tests) and what did not run.
