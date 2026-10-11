---
"uptide": patch
---

Verify the exported migration branch has the exact tree that passed verification. Refuse success and publication when export fails, preserve the complete clone, and require the recorded verified tree before pushing a stored run. Report changed-file counts from the committed diff.

Export fresh migrations to numbered branches when an existing branch has different content. Preserve identical packages' libc restrictions when older npm serializers omit them, without relaxing the resolution guard.
