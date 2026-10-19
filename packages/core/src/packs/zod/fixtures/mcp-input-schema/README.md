Fixture for the `zod/mcp-input-schema-additional-properties` behavior record (UPT-114), read by
`packs/flows-to-consumer.test.ts`. Not a `before.ts`/`after.ts` case: the record's trigger needs the
type checker, so the test copies `src/` and `tsconfig.json` to a temporary directory and installs
`zod3/` (or `zod4/`) as `node_modules/zod` and `sdk/` as `node_modules/@modelcontextprotocol/sdk`.
The stubs keep only what the trigger reads: `ZodObject`'s type arguments (`"strip"` and `"strict"` in
zod 3, `$strip` and `$strict` in zod 4), `_def` and `_zod`, and `McpServer#registerTool` and `#tool`.

A line ending in `// site` is one the record must report; every other line must not be.
