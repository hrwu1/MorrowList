import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiClient, ApiClientError } from "@morrowlist/api-client";

import { TOOLS } from "./tools.js";

/**
 * The MorrowList MCP server (GAP-18).
 *
 * Stateless by design (`docs/adr/018-mcp-server.md`): one tool call in, one REST call
 * out, one result back. It holds no session, runs no background work, and calls no model.
 */

export const SERVER_NAME = "morrowlist";
export const SERVER_VERSION = "0.1.0";

export interface McpServerOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly workspaceId?: string | undefined;
  /** Injected by the tests; production uses the global. */
  readonly fetch?: typeof globalThis.fetch;
}

export function createMorrowMcpServer(options: McpServerOptions): McpServer {
  const client = new ApiClient({
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    workspaceId: options.workspaceId,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "MorrowList task management. Task keys look like ML-000142 and are stable; ids are uuids. Read with list_tasks or search before writing, and pass the version you read back as expectedVersion so a concurrent edit fails loudly.",
    },
  );

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      async (args: Record<string, unknown>) => callTool(client, tool, args),
    );
  }

  return server;
}

/**
 * Run one tool and shape the result. A failed API call is returned as an error result
 * rather than thrown, so the model can read the reason and correct itself — a version
 * conflict or a validation failure is information, not a crash.
 */
async function callTool(
  client: ApiClient,
  tool: (typeof TOOLS)[number],
  args: Record<string, unknown>,
) {
  try {
    const result = await tool.run(client, args as never);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: describeFailure(error) }],
    };
  }
}

export function describeFailure(error: unknown): string {
  if (error instanceof ApiClientError) {
    // The code is what an agent can branch on; the message is what it can act on.
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
