---
"uptide": patch
---

`fix` no longer fails on npm repositories whose lockfile carries optional platform packages such as sharp's `@emnapi/*`. npm 11.6 drops them on the first lock-only install and writes a lockfile its own `npm ci` rejects; `fix` now runs the lock-only install twice, at the upgrade and at the parent commit alike, so the lockfile it validates is one `npm ci` accepts.
