---
'uptide': patch
---

redis pack: report numeric SCAN cursors in files that use the client through the repository's own module (`getRedisClient` from `../config/redis`, `redisClient` from `~/utils/redis.server`) without importing redis, including files the compile scope left out under the importer memory cap; and treat `scan(cursor)` after `let cursor = 0` as a numeric cursor. The resolver behind it, shared with the zod pack's form-error rule, moves to `check/importers.ts` as `packageImports`.
