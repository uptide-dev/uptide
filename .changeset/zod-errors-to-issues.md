---
'uptide': patch
---

The zod pack migrates `ZodError#errors` to `.issues` by rule: reads (`error.errors[0].message`, `error?.errors`) and destructuring (`const { errors } = error` becomes `const { issues: errors } = error`) where the type checker resolves the receiver to `ZodError`, and reads off an untyped catch binding of a zod parse. Writes are left to the agent.
