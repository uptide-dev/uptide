---
"uptide": patch
---

Update conflicting root pins automatically when preparing draft PRs, including App/Action runs, and list the changes at the top of the PR under "Root pins changed: review". Add `updatePins: false` in `uptide.yml` to opt out. Local runs still require explicit `--update-pins` consent.
