import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createMorrowMcpServer } from "./server.js";

/**
 * `morrow-mcp` (GAP-18): stdio entry point for Claude Desktop, Claude Code, and any other
 * MCP client. Configuration comes from the same environment variables the CLI reads
 * (spec 21.2), so a working `morrow` profile is a working MCP server.
 *
 * stdout is the protocol channel: nothing but MCP frames may be written to it, which is
 * why every diagnostic below goes to stderr.
 */

const baseUrl = process.env.MORROW_BASE_URL ?? "http://localhost:3000/api/v1";
const apiKey = process.env.MORROW_API_KEY;
const workspaceId = process.env.MORROW_WORKSPACE;

if (!apiKey) {
  process.stderr.write(
    "MORROW_API_KEY is not set. Create a key in MorrowList and put it in the MCP client's env block.\n",
  );
  process.exit(3);
}

const server = createMorrowMcpServer({ baseUrl, apiKey, workspaceId });
await server.connect(new StdioServerTransport());
process.stderr.write(`morrowlist mcp server ready (${baseUrl})\n`);
