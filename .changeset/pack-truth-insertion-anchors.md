---
"uptide": patch
---

Ground truth can name a site for an upgrade that only adds lines inside an existing call, such as an option added to a constructor: the site is the call's start line, so a pack finding there scores as a true positive instead of a false positive. `pnpm packs:truth` drafts these anchors from insert-only hunks for review, and docs/packs.md and CONTRIBUTING describe the rule.
