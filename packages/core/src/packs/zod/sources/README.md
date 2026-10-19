Snapshots of the public pages the zod pack's behavior records (`../records.json`) quote, byte for
byte as read: `records.test.ts` checks each record's quote is in its snapshot and that the snapshot
matches the record's sha256. Update a record by reading the page again, replacing the snapshot and
its sha256, and checking the quote still holds.

- `zod-json-schema.mdx.txt`: zod's JSON Schema docs (https://zod.dev/json-schema) at
  colinhacks/zod `cc4cd4ee9c52fcaa10964e48cc144541e41a5ed9`, `packages/docs/content/json-schema.mdx`.
  MIT License, Copyright (c) 2025 Colin McDonnell.
- `mcp-sdk-1.30.1-zod-json-schema-compat.js.txt`: `dist/esm/server/zod-json-schema-compat.js` from
  the published `@modelcontextprotocol/sdk` 1.30.1 tarball (identical in 1.32.1; 1.23.0 is the first
  release with the zod 4 branch, 1.22.0 has no zod 4 support). MIT License, Copyright (c) 2024
  Anthropic, PBC.
