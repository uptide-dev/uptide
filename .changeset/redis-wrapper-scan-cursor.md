---
'uptide': patch
---

The redis (node-redis) 4 to 5 and 5 to 6 pack is verified: 5 public upgrades, 20 real breaking sites, breaking precision 100% and recall 83%; its four rewrites no real site exercises (`keepAlive`, `quit`/`disconnect`, scan iterators, `unstableResp3`) run as assisted. It now reports numeric SCAN cursors in files that use the client through the repository's own module (`getRedisClient` from `../config/redis`, `redisClient` from `~/utils/redis.server`) without importing redis, including files the compile scope left out under the importer memory cap, and treats `scan(cursor)` after `let cursor = 0` as a numeric cursor. The resolver behind it, shared with the zod pack's form-error rule, moves to `check/importers.ts` as `packageImports`.
