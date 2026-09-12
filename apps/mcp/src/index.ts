import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveClientEnvironment } from "@morrowlist/api-client";

import { createMorrowMcpServer } from "./server.js";

/**
 * `morrow-mcp` (GAP-18): stdio entry point for Claude Desktop, Claude Code, and any other
 * MCP client. Connection environment variables and defaults match the CLI (spec 21.2).
 * Stored CLI profiles are not read by this environment-configured entry point.
 *
 * stdout is the protocol channel: nothing but MCP frames may be written to it, which is
 * why every diagnostic below goes to stderr.
 */

const { baseUrl, apiKey, workspaceId } = resolveClientEnvironment(process.env);

if (!apiKey) {
  process.stderr.write(
    "MORROW_API_KEY is not set. Create a key in MorrowList and put it in the MCP client's env block.\n",
  );
  process.exit(3);
}

const server = createMorrowMcpServer({ baseUrl, apiKey, workspaceId });
await server.connect(new StdioServerTransport());
process.stderr.write(`morrowlist mcp server ready (${baseUrl})\n`);
