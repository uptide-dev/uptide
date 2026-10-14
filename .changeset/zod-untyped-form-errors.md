---
"uptide": patch
---

zod: `check` now reports `ZodError#formErrors` and `#errors` read off an untyped catch binding of a zod `parse`/`parseAsync` (`catch (error: any) { return error.formErrors.fieldErrors }`), which zod 4 removed and the compiler cannot see. Files that only import a schema from the repository's own module (`@/lib/zod`) are covered too. `fix` rewrites `<err>.formErrors.fieldErrors` and `<err>.formErrors.formErrors` to `z.flattenError(<err>)`, importing `z` where it is missing; every other read goes to the agent.
