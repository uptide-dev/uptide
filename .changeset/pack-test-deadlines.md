---
'uptide': patch
---

Nothing Uptide waits on can hang a run any more. Every registry request has a deadline that
covers its body, and a stalled one fails with `REGISTRY_TIMEOUT` (answered from the cache
when an expired entry exists). Local git commands have one too, and so does the shallow fetch
of a ground-truth repository. `uptide pack test` runs each pack in a process of its own: one
that runs longer than `--pack-timeout` (minutes, default 20) is stopped with everything it
started and fails with the pack's name, and the other packs still run.
