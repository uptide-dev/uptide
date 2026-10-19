---
"uptide": patch
---

Run pinned npm through Corepack when local npm differs. When the pin is unavailable, allow local npm with a compatible v3 lockfile, record the fallback in the report, and reject frozen installs that rewrite the lockfile.
