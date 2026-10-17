---
"uptide": patch
---

Detect removed Zod error members on local results of schemas imported through repository modules, including awaited safeParseAsync calls, so their `.errors` reads can migrate to `.issues`.
