# ADR (pending) — An MCP server is a thin adapter over the REST API

**Status:** Proposed (GAP-18). Number it when the plan lands.

**Date:** 2026-09-05

## Context

ADR-006 says MorrowList is _agent-ready, not agent-powered_: identity abstraction,
activity history, idempotency, concurrency checks, structured errors, and transactional
domain events are in scope; agent routing, execution sandboxes, task leases, model
providers, and autonomous state machines are not.

An MCP server sits exactly on the "ready" side of that line. It carries no model, holds no
session state, decides nothing, and executes nothing on its own: it is a transport adapter
that lets a model _the user already runs_ call the same public REST endpoints the web app
and the CLI call. It is the same kind of artefact as `apps/cli` (ADR-005), addressed to a
different client.

Building it needs one thing the repository does not have: the official TypeScript MCP SDK.
The escalation rules in `docs/contributing/agents.md` require a new dependency to be
escalated. This ADR records the decision instead, because the GAP-18 plan names the
dependency explicitly and the coordinator pre-approved it.

## Decision

1. Add `@modelcontextprotocol/sdk` (pinned to `1.30.0`) as a dependency of a new
   `apps/mcp` workspace package, and of nothing else. No other package may import it.
2. `apps/mcp` talks to MorrowList through `@morrowlist/api-client` over HTTP with an API
   key, exactly as `apps/cli` does. It gets the same dependency-boundary rule as the CLI:
   no `@morrowlist/database`, no `@morrowlist/application`, no Drizzle, no `pg`.
3. The tool surface is capped. Seven tools, no more, without a further decision:
   `list_tasks`, `get_task`, `create_task`, `update_task`, `move_task`, `complete_task`,
   `search`.
4. **Tool-description budget: 2,000 tokens** for the whole surface — every tool name,
   description, and input-schema description the server advertises, measured together. A
   test measures it and fails the build if it is exceeded. The budget exists because every
   token of tool description is charged on every single model turn in the client's context
   window, whether or not a tool is used.
5. The server stays stateless and non-autonomous: stdio transport, one request in, one
   REST call out, one result back. No polling, no background work, no queue, no model
   calls, no `sampling/*`. If a future change wants any of those, it needs a new ADR
   because it crosses the ADR-006 line.

## Consequences

- MorrowList becomes usable from Claude Desktop and Claude Code without giving either one
  database access or a second write path into the domain: an agent is subject to the same
  validation, authorization, activity recording, and concurrency checks as a person.
- The tool budget forces prose discipline. Descriptions are written for a model, not for a
  reference manual; the detail that does not fit belongs in `morrow usage` and the OpenAPI
  document, which an agent can read on demand.
- One more dependency to keep current. It is confined to `apps/mcp`, so a breaking SDK
  release cannot reach the domain, the application layer, or the web app.
- `apps/mcp` is not part of the deployed web service; it runs on the user's machine.

## Measured budget

`apps/mcp/src/tools.test.ts` connects a real MCP client over an in-memory transport,
serialises the actual `tools/list` payload, and measures it. As landed:

    MCP tool surface: 6,150 characters, ~1,758 tokens (budget 2,000)

The estimate charges 3.5 characters per token — the usual four-per-token rule of thumb,
tightened because JSON schema text is punctuation-heavy. No tokenizer is vendored: that
would be a second dependency for a number the budget only needs to within a few per cent,
and erring high is the safe direction.

The largest single saving was not prose. `z.uuid()` emits a 170-character regex into the
advertised schema, and repeating it once per id field cost about a quarter of the budget
to tell a model what a uuid looks like. Ids are described instead; the server still
validates them properly.
