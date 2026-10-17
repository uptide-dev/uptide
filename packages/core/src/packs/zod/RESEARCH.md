# zod pack: what the rules do not reach (UPT-92)

Misses left in the ground truth after the `refine-message`, `deprecated-names` and `error-map`
rules (breaking recall 65% → 76%, 17 misses):

- **Compiler errors with no zod API at the line (10).** `post-runs.ts:55,82` and
  `resume-run.ts:52,127` (PATH) pass a value to a function of the repository's own whose
  parameter type is inferred from a schema defined in another file; `mcp/sdk.ts:359`,
  `server.ts:311`, `sse.ts:239`, `stdio.ts:93` (band-sdk) pass a shape to the MCP SDK's
  `tool()`. The line names no zod symbol; the cause is a schema type elsewhere, and the
  diagnostic (TS2345, TS2322) is the only evidence. Attributing it needs the checker's type of
  the argument traced back to a zod type, which is the type diff's job, not a syntax rule's.
  `open-workflow.ts:149` is the same: `z.unknown()` is fine, the error is the declared type
  of the map it is assigned into, two lines up. Left as they are.
- **`name === "ZodArray"` (wire-step-plugins.ts).** Four lines the upgrade changed compare
  zod 3's `_def.typeName` strings. A rule for it found those and one more at line 90, a
  comparison the upgrade left alone, so it had a breaking false positive on this truth and
  was dropped rather than shipped as `deprecated`.
- `LessonForm.tsx:22` (`error.errors` on a binding the scan cannot type) and
  `validate-dashboard.ts:21` (a line the upgrade touched with no zod symbol) are `error-issues`
  and `generic` misses outside these rules.
- `prompt/index.ts:41` is a single-argument `z.record` (`record-key`); not investigated here.
