---
"uptide": patch
---

Report Stripe clients pinned to different API versions at the top of `check` and of the PR body, as a decision for the owner: every `new Stripe(...)` in TypeScript and JavaScript sources, scripts included, with the version it speaks after the upgrade (an unpinned client speaks the SDK default). The PR's decisions list, for each client behind the target, the changelog entries it would cross for the resources it calls. No pin is rewritten.
