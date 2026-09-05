# MorrowList MCP server

`morrow-mcp` lets an AI assistant read and change your MorrowList tasks over the
[Model Context Protocol](https://modelcontextprotocol.io). It is a thin adapter over the
public REST API — the same one the web app and `morrow` use — so an assistant is subject
to exactly the same validation, authorization, activity recording, and concurrency checks
as you are. Every change it makes appears in the task's history, attributed to the API key
it used.

It runs on your machine, carries no model of its own, and does nothing between calls.
See `docs/adr/pending-mcp-server.md` for why the surface is deliberately small.

## Tools

| Tool            | What it does                                                         |
| --------------- | -------------------------------------------------------------------- |
| `list_tasks`    | Tasks, filtered by project, status, priority, completion, due window |
| `get_task`      | One task in full, including the version needed for a safe update     |
| `create_task`   | Add a task, to a project or the Inbox                                |
| `update_task`   | Change fields, optionally with `expectedVersion`                     |
| `move_task`     | Move between projects and statuses, and reorder                      |
| `complete_task` | Mark done; spawns the next occurrence of a repeating task            |
| `search`        | Full-text search with the `is:` / `due:` / `tag:` operator grammar   |

`list_tasks`, `get_task` and `search` are marked read-only, so a client can auto-approve
them and prompt only for the three that write.

## Setup

You need an API key. Create one in MorrowList, then note your base URL — it ends in
`/api/v1`.

### Claude Code

```bash
claude mcp add morrowlist \
  --env MORROW_BASE_URL=https://morrow.example.com/api/v1 \
  --env MORROW_API_KEY=your-key \
  -- npx -y @morrowlist/mcp
```

Or, from a checkout of this repository:

```bash
pnpm --filter @morrowlist/mcp build
claude mcp add morrowlist \
  --env MORROW_BASE_URL=http://localhost:3000/api/v1 \
  --env MORROW_API_KEY=your-key \
  -- node /absolute/path/to/apps/mcp/dist/index.js
```

### Claude Desktop

Add this to `claude_desktop_config.json` (macOS:
`~/Library/Application Support/Claude/claude_desktop_config.json`) and restart the app:

```json
{
  "mcpServers": {
    "morrowlist": {
      "command": "node",
      "args": ["/absolute/path/to/apps/mcp/dist/index.js"],
      "env": {
        "MORROW_BASE_URL": "https://morrow.example.com/api/v1",
        "MORROW_API_KEY": "your-key"
      }
    }
  }
}
```

## Configuration

| Variable           | Meaning                                                    |
| ------------------ | ---------------------------------------------------------- |
| `MORROW_BASE_URL`  | API base URL. Default `http://localhost:3000/api/v1`       |
| `MORROW_API_KEY`   | Required. The server exits with code 3 without one         |
| `MORROW_WORKSPACE` | Workspace id. Only needed if the key reaches more than one |

These are the same variables `morrow` reads (spec 21.2), so a working CLI profile is a
working MCP server.

## Notes

- **stdout is the protocol.** Diagnostics go to stderr; nothing else may be written to
  stdout, which is why this server logs nothing there.
- **Errors are results, not crashes.** A version conflict or a validation failure comes
  back as `CODE: message` so the assistant can read it and correct itself.
- **Keys are shown once.** If you lose one, revoke it and make another.
- **Scope the key.** An assistant that only needs to read should be given a read-only key;
  see the `agent` preset in `morrow usage`.
