---
"uptide": minor
---

Add a candidate joi 17 to 18 migration pack. `new ValidationError(message, {}, original)`, which stops compiling for code written against joi 17.0–17.6, is rewritten to pass `[]`; the Node.js 20 requirement and the top-level domains joi 18 no longer accepts in `email()`, `domain()` and `uri()` are reported as decisions. Scored against two public repositories, one of them a negative control.
