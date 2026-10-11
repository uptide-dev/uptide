---
"uptide": patch
---

Preserve workspace ranges that already accept upgrade targets, including companions, and report them as already compatible. Widen rejecting peer ranges without removing alternatives and give widening instructions for unsupported ranges. Fix the workspace-root command hint to retain the target and use positional package syntax without npx.

Verify that installed target and companion versions exactly match the plan, including when ranges already accept the target. Preserve exact Yarn Berry resolutions without narrowing manifests and correct Yarn 3's build-suppression flag.

Limit Yarn Berry descriptor pinning to unchanged compatible npm ranges and aliases, avoiding self-resolutions when an exact dependency is upgraded.
