---
"uptide": patch
---

Prepare missing workspace declarations for fix verification, and rebuild internal packages affected by upgraded dependencies even when build output exists. Use the configured verification build script and report each build. A build that cannot run or fails is reported, never thrown. Standalone checks run no repository scripts and count the files importing a workspace with missing output as not verified (`needs build of <workspace>`) while the rest still compiles.
