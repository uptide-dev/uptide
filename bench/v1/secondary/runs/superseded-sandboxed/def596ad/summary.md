I upgraded zod to 4.6.7 and committed it on `bench-base` as 46408d6. The type-check and build pass. The repo has no lint script, so there was no lint to run. 20 tests fail and 353 are skipped, because the sandbox can't run the server or Postgres tests. Those need a run outside it before this is trusted.

**Code changes (5 lines in 4 files):**
- **`z.record` needs two arguments in v4.** This was the only thing that broke the build. I changed `z.record(z.unknown())` to `z.record(z.string(), z.unknown())` in the two artifact `metadata` fields, in the `/sync/push` `payload` schema, and in a comment in `config.ts`.
- **`z.string().uuid()` → `z.guid()`** for `compare_extractions` and `entity_relations`. In v4, `.uuid()` is stricter about which UUIDs it accepts, so some IDs that worked before would be rejected. `z.guid()` accepts the same 8-4-4-4-12 hex pattern v3 did, which matches what Postgres accepts.
- **`HandoffSchema.passthrough()` → `.loose()`.** This is the v4 name for the same behaviour; nothing changes.

**Tests:**
- 494 passed, 20 failed, 353 skipped.
- **The 20 failures** all come from test files that start the server with `npx tsx`. The sandbox blocks the socket tsx opens at startup (`listen EPERM ... tsx-502/*.pipe`); running tsx directly fails the same way, so this isn't a zod problem.
- **The 353 skipped** are the Postgres-gated tests; no database is reachable from here.
- **Manual check instead:** I started the built server (`node dist/server.js`) and called it over HTTP. All 32 tools list, and their input schemas look right (defaults, enums, record/object shapes). `store_handoff` and `list_handoffs` work. Bad input such as `limit: 0` or an invalid GUID is rejected with the new v4 error format. Prompts list correctly.

**Before merging, please:**
1. **Run `npm test` with Postgres** (e.g. in the devcontainer or CI). That's the only way to exercise the spawned-server, sync, task, note and artifact tests.
2. **Check the `/sync/push` 400 response.** It returns `parsed.error.issues` as is, and v4 changed what each issue looks like (messages like `"Too small: expected number to be >=1"`, new fields such as `origin` and `format`, some old ones removed). Any client that parses those issues, including the iOS client, should be checked. The same new wording appears in MCP input-validation error text, which models and clients see.
3. **Check tool schemas in your MCP clients.** The SDK now builds them from zod v4: `z.guid()` fields include a regex `pattern`, and integer fields show explicit min/max bounds. They're valid JSON Schema, but different from before.
4. **Other packages now use zod 4 too.** `@modelcontextprotocol/sdk`, `@hono/mcp` and `@anthropic-ai/sdk` all share the single 4.6.7 install, and all of them declare support for v4.
