---
'uptide': patch
---

Add a candidate ioredis 5 to 6 migration pack: client constructions that inherit the RESP3, reconnect and keep-alive defaults ioredis 6 changed, compiler-blind sites (`mode === 'subscriber'`, commands in a `connect` listener with the offline queue off, AUTH recognized by command name), dependents that bundle ioredis 5, instrumentation that stops patching ioredis 6, and Node 20. It is scored against five public upgrades and stays a candidate: none of them has a breaking site to verify it with.
