// The overloads of @modelcontextprotocol/sdk 1.30.1's `McpServer` that take an input schema.
export type ToolCallback = (...args: any[]) => unknown;
export interface ToolAnnotations {
  readOnlyHint?: boolean;
}
export declare class McpServer {
  constructor(info: { name: string; version: string });
  registerTool(
    name: string,
    config: { title?: string; description?: string; inputSchema?: unknown; outputSchema?: unknown },
    cb: ToolCallback,
  ): unknown;
  tool(name: string, cb: ToolCallback): unknown;
  tool(name: string, paramsSchema: unknown, cb: ToolCallback): unknown;
  tool(name: string, description: string, paramsSchema: unknown, cb: ToolCallback): unknown;
  tool(
    name: string,
    description: string,
    paramsSchema: unknown,
    annotations: ToolAnnotations,
    cb: ToolCallback,
  ): unknown;
}
