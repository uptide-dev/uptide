---
"uptide": patch
---

Fold implicit-any errors (TS7006, TS7031, TS7019) inside an option the target removed into the pack finding on that option, as downstream evidence: the callbacks lost the types the option gave them, and the same edit resolves them. They no longer stand as separate breaking sites.
