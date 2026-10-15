---
"uptide": patch
---

Respect repository tsconfig file selection, recursive project references, and workspace project options when checking dependency upgrades. Compiler diagnostics outside every TypeScript project no longer produce breaking findings; pack rules and build-configuration findings retain their own scope. Repositories without a tsconfig retain importer-based compilation, with that fallback stated in the report.

Anchor missing members supplied by dependency augmentations at their setup import, retaining affected calls as evidence instead of counting each call as a separate breaking edit.
