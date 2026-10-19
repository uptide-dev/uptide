import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  listShape,
  looseSchema,
  neverCatchall,
  plainSchema,
  strictInput,
  strictSchema,
} from './schemas.js';

export function register(server: McpServer, anything: any): void {
  const done = () => ({ content: [] });
  server.registerTool('list', { title: 'List', inputSchema: listShape }, done); // site
  server.registerTool(
    'plain',
    {
      description: 'A plain object schema',
      inputSchema: plainSchema, // site
    },
    done,
  );
  server.registerTool('inline', { inputSchema: { q: z.string() } }, done); // site
  server.registerTool('strict', { inputSchema: strictSchema }, done);
  server.registerTool('helper', { inputSchema: strictInput(listShape) }, done);
  server.registerTool('strict-object', { inputSchema: z.strictObject({ a: z.string() }) }, done);
  server.registerTool('loose', { inputSchema: looseSchema }, done);
  server.registerTool('catchall', { inputSchema: neverCatchall }, done);
  server.registerTool('unknown', { inputSchema: anything }, done);
  server.registerTool('empty', { inputSchema: {} }, done);
  server.registerTool('none', { description: 'no input' }, done);
  server.tool('old', { q: z.string() }, done); // site
  server.tool('old-described', 'desc', { q: z.string() }, { readOnlyHint: true }, done); // site
  server.tool('old-strict', 'desc', strictSchema, done);
}

/** Not the MCP SDK's server: the same method name on another type is no site. */
const other = {
  registerTool(_name: string, _config: { inputSchema: unknown }): void {},
};
other.registerTool('x', { inputSchema: listShape });
