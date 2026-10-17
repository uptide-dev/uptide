---
"uptide": patch
---

The zod pack reports `.refine(check, { message })`, the type names zod 4 marks deprecated (`ZodTypeAny`, `ZodIssue`, `ZodSchema`, `ZodErrorMap` and the others, including `import('zod').ZodTypeAny`) and `errorMap` options with `ctx.defaultError`, as deprecated findings.
