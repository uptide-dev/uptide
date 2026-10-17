---
"uptide": patch
---

The zod pack reports names zod 3 exported from its root and zod 4 exports only from `zod/v3` (`SafeParseReturnType`, `ZodTypeDef`, `ZodEffects`, the `Zod*Def` interfaces), which the surface diff counted as unchanged, and `fix` now rewrites `z.string().uuid()` to `z.guid()` instead of `z.uuid()`, so ids that zod 3 accepted still validate.
