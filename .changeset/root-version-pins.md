---
"uptide": patch
---

Add `fix --update-pins` to explicitly approve updates to conflicting root Yarn resolutions and npm/pnpm overrides for the target and its companions. Preserve unrelated pins, update root declarations and pnpm catalogs together, report pin changes, and reject ambiguous selectors before installation.
