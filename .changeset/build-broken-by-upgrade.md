---
"uptide": patch
---

A repository build that fails on the final head is no longer published as a ready PR. When it fails, `fix` builds the parent commit in the same clone to compare. If the parent fails too, the build line says "already failing before this upgrade" and nothing is blocked. If the parent passes, the upgrade broke the build: verification fails, and the PR opens only as a draft with "Build broken by this upgrade" at the top. If the parent can't be checked out, installed or built, verification still fails and the PR says "Build fails on this upgrade; the parent build could not be checked" with the reason, never that the parent passed. The GitHub Action opens these runs as draft PRs, the same way it opens agent-led runs. The head build also skips workspaces already built on that head, so a workspace whose output a consumer reads is no longer built twice.
