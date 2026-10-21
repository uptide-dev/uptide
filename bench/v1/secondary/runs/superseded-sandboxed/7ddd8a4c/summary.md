I upgraded zod from 3.25.76 to 4.6.7 and committed it on `bench-base` (`60d6239`). It type-checks and builds cleanly, but only part of the test suite could run here, so the database-backed and spawned-server tests still need a run in CI or the devcontainer.

**Code changes:**
- **`z.record` now needs an explicit key type.** Zod 4 won't compile `z.record(z.unknown())`, so I changed it to `z.record(z.string(), z.unknown())`. This affects artifact `metadata` in `store_artifact` and `update_artifact` (`src/tools/artifacts.ts`) and the sync push `payload` (`src/sync/routes.ts`). Behavior is the same, and I updated a comment in `src/config.ts` to match.
- **UUID checks:** in `src/tools/entity-tools.ts` I replaced `z.string().uuid()` with `z.guid()`. Zod 4's `uuid()` is stricter than before and checks the version digit; `guid()` accepts any 8-4-4-4-12 hex string, the same as zod 3 did. Our IDs come from Postgres and would pass either way. If you'd rather have strict checking, switch it back to `z.uuid()`.
- The MCP SDK, `@hono/mcp` and the Anthropic SDK all already support zod 4 and now share the single 4.6.7 install.

**Checks:**
- **Type-check and build:** both pass with no errors.
- **Lint:** the repo has no lint script or config, so there was nothing to run.
- **Tests:** 494 pass and 20 fail, and the same tests fail with the same results on the original zod 3 install. The failures come from the sandbox: `tsx` can't open its IPC socket, which breaks every test that starts the server, and Postgres isn't reachable here, so 353 tests are skipped. That includes `sync.test.ts`, `tasks.test.ts`, `notes.test.ts` and `export-import.test.ts`.
- **Manual check:** I started the built server and called it directly. Listing the tools works (32 tools, with valid input schemas including defaults and min/max). `store_handoff`, `list_handoffs` and `get_latest_handoff` work. Bad input is rejected with the expected `-32602` error. I also confirmed that unknown keys are still kept on handoffs and still rejected on sync push payloads, and that default values still apply.

**One thing you should know:** my first check accidentally went to a different process already listening on port 3188, not my build. It stored one test handoff (`active_context: {"x":1}`) in that process's data directory. If that's a dev server you care about, delete the handoff file timestamped `2026-10-20T23-41-42-998Z`. The check that counts was rerun on a free port against my build.

**What to review:**
1. **Error text changed.** Zod 4 words validation errors differently: for example `"Too small: expected number to be >=1"`, and codes like `invalid_format` and `unrecognized_keys`. MCP tool errors, the `issues` returned by `/sync/push` on an invalid request, and the per-operation error messages all change shape. Check whether the iOS client or any tests match on that text.
2. **Tool schema output.** The JSON schemas advertised to clients are now produced by zod 4. They looked correct, but the details differ slightly (for example, GUID fields now carry a `pattern`).
3. **Deprecated but working calls.** `.passthrough()` and `.strict()` still work in zod 4 but are marked deprecated. I left them alone to keep the change small; the newer equivalents are `z.looseObject` and `z.strictObject`.
