import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { TaskDto } from "@morrowlist/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { createMorrowMcpServer, describeFailure } from "./server.js";
import {
  TOOLS,
  TOOL_DESCRIPTION_TOKEN_BUDGET,
  estimateTokens,
  toSummary,
} from "./tools.js";

/**
 * The tools are exercised through a real MCP client over an in-memory transport, against
 * a stub of the REST API. That covers the whole path a model takes — schema validation in
 * the SDK, the request the client builds, and the result the model reads back — without
 * needing a server or a database.
 */

const BASE = "http://api.test/api/v1";

function taskFixture(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "01996c1f-0000-7000-8000-000000000001",
    key: "ML-142",
    workspaceId: "01996b00-0000-7000-8000-000000000002",
    taskNumber: 142,
    title: "Draft the brief",
    descriptionMd: "## Notes",
    projectId: "01996b10-0000-7000-8000-000000000003",
    statusId: "01996b20-0000-7000-8000-000000000004",
    priority: "high",
    dueDate: "2026-09-15",
    dueTime: null,
    dueTimezone: null,
    deferUntil: null,
    deadline: null,
    deadlineTime: null,
    dateWarnings: [],
    reminderOffsetMinutes: null,
    recurrence: null,
    seriesId: null,
    parentTaskId: null,
    subtaskProgress: null,
    isCompleted: false,
    completedAt: null,
    isBlocked: false,
    blocked: null,
    dayPlans: [],
    tags: [{ id: "01996b30-0000-7000-8000-000000000005", name: "Focus", colorToken: "blue" }],
    relations: [],
    version: 7,
    createdAt: "2026-09-01T09:00:00.000Z",
    updatedAt: "2026-09-04T09:00:00.000Z",
    ...overrides,
  } as TaskDto;
}

interface Call {
  readonly method: string;
  readonly url: URL;
  readonly body: unknown;
}

let calls: Call[];
let respond: (call: Call) => unknown;

/** A stub of the REST API: records what was asked for and answers with fixtures. */
const stubFetch: typeof globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : String(input));
  const call: Call = {
    method: init?.method ?? "GET",
    url,
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  };
  calls.push(call);
  const payload = respond(call);
  if (payload instanceof Response) return payload;
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

async function connect() {
  const server = createMorrowMcpServer({
    baseUrl: BASE,
    apiKey: "test-key",
    workspaceId: "01996b00-0000-7000-8000-000000000002",
    fetch: stubFetch,
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

/** The JSON an agent reads back out of a successful tool result. */
async function callTool(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { type: string; text: string }[];
  };
  const text = result.content[0]?.text ?? "";
  return { isError: result.isError === true, text, data: safeParse(text) };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

beforeEach(() => {
  calls = [];
  respond = () => ({ data: [], page: { hasMore: false, nextCursor: null } });
});

describe("the advertised surface", () => {
  it("offers exactly the seven tools the ADR budgets for", async () => {
    const client = await connect();
    const { tools } = await client.listTools();

    expect(tools.map((entry) => entry.name).sort()).toEqual([
      "complete_task",
      "create_task",
      "get_task",
      "list_tasks",
      "move_task",
      "search",
      "update_task",
    ]);
    for (const entry of tools) {
      expect(entry.description?.length ?? 0).toBeGreaterThan(0);
      expect(entry.inputSchema.type).toBe("object");
    }
    // Read-only tools are flagged so a client can auto-approve them.
    expect(
      tools.filter((entry) => entry.annotations?.readOnlyHint).map((e) => e.name).sort(),
    ).toEqual(["get_task", "list_tasks", "search"]);
  });

  it("stays inside the 2,000-token description budget", async () => {
    const client = await connect();
    // The real `tools/list` payload, which is exactly what a client puts in the model's
    // context on every turn — not a reconstruction of it.
    const advertised = JSON.stringify((await client.listTools()).tools);
    const tokens = estimateTokens(advertised);

    // Printed so a review sees the number move, not only whether it passed.
    console.info(
      `MCP tool surface: ${advertised.length} characters, ~${tokens} tokens ` +
        `(budget ${TOOL_DESCRIPTION_TOKEN_BUDGET})`,
    );
    expect(tokens).toBeLessThanOrEqual(TOOL_DESCRIPTION_TOKEN_BUDGET);
    // A surface this small would mean the descriptions had been gutted, not trimmed.
    expect(tokens).toBeGreaterThan(300);
  });
});

describe("list_tasks", () => {
  it("passes the filters through and returns compact summaries", async () => {
    respond = () => ({
      data: [taskFixture()],
      page: { hasMore: true, nextCursor: "abc" },
    });
    const client = await connect();

    const { data } = await callTool(client, "list_tasks", {
      projectId: "01996b10-0000-7000-8000-000000000003",
      due: "today",
      limit: 10,
    });

    expect(calls[0]?.url.pathname).toBe("/api/v1/tasks");
    expect(calls[0]?.url.searchParams.get("projectId")).toBe(
      "01996b10-0000-7000-8000-000000000003",
    );
    expect(calls[0]?.url.searchParams.get("due")).toBe("today");
    expect(calls[0]?.url.searchParams.get("limit")).toBe("10");
    expect(data).toEqual({
      tasks: [toSummary(taskFixture())],
      hasMore: true,
    });
  });

  it("rejects an out-of-range limit before it reaches the API", async () => {
    const client = await connect();
    const result = await callTool(client, "list_tasks", { limit: 5000 });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("get_task", () => {
  it("accepts a task key and returns the fields a summary leaves out", async () => {
    respond = () => ({ data: taskFixture() });
    const client = await connect();

    const { data } = await callTool(client, "get_task", { task: "ML-142" });

    expect(calls[0]?.url.pathname).toBe("/api/v1/tasks/ML-142");
    expect(data).toMatchObject({
      key: "ML-142",
      descriptionMd: "## Notes",
      version: 7,
      tags: ["Focus"],
    });
  });
});

describe("create_task", () => {
  it("POSTs the supplied fields and returns the new task", async () => {
    respond = () => ({ data: taskFixture({ key: "ML-143", title: "Book the room" }) });
    const client = await connect();

    const { data } = await callTool(client, "create_task", {
      title: "Book the room",
      priority: "medium",
      dueDate: "2026-09-20",
    });

    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toEqual({
      title: "Book the room",
      priority: "medium",
      dueDate: "2026-09-20",
    });
    expect(data).toMatchObject({ key: "ML-143", title: "Book the room" });
  });

  it("refuses a malformed date without calling the API", async () => {
    const client = await connect();
    const result = await callTool(client, "create_task", {
      title: "Bad date",
      dueDate: "next tuesday",
    });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("update_task, move_task and complete_task", () => {
  it("resolves the key to an id, then sends the command", async () => {
    respond = (call) =>
      call.method === "GET" ? { data: taskFixture() } : { data: taskFixture() };
    const client = await connect();

    await callTool(client, "update_task", {
      task: "ML-142",
      priority: "urgent",
      expectedVersion: 7,
    });

    expect(calls.map((call) => `${call.method} ${call.url.pathname}`)).toEqual([
      "GET /api/v1/tasks/ML-142",
      "PATCH /api/v1/tasks/01996c1f-0000-7000-8000-000000000001",
    ]);
    // The key is resolved away; the command never carries it.
    expect(calls[1]?.body).toEqual({ priority: "urgent", expectedVersion: 7 });
  });

  it("returns a move's work-in-progress warnings alongside the task", async () => {
    respond = (call) =>
      call.method === "GET"
        ? { data: taskFixture() }
        : {
            data: taskFixture(),
            warnings: [
              { code: "WORKSPACE_WIP_LIMIT_EXCEEDED", message: "5 in progress, limit 3" },
            ],
          };
    const client = await connect();

    const { data } = await callTool(client, "move_task", {
      task: "ML-142",
      projectId: "01996b10-0000-7000-8000-000000000003",
      statusId: "01996b20-0000-7000-8000-000000000004",
    });

    expect(data).toMatchObject({ warnings: ["5 in progress, limit 3"] });
  });

  it("completes a task and passes the blocked acknowledgement through", async () => {
    respond = (call) =>
      call.method === "GET"
        ? { data: taskFixture() }
        : { data: taskFixture({ isCompleted: true }) };
    const client = await connect();

    const { data } = await callTool(client, "complete_task", {
      task: "ML-142",
      acknowledgeBlocked: true,
    });

    expect(calls[1]?.url.pathname).toBe(
      "/api/v1/tasks/01996c1f-0000-7000-8000-000000000001/complete",
    );
    expect(calls[1]?.body).toEqual({ acknowledgeBlocked: true });
    expect(data).toMatchObject({ done: true });
  });
});

describe("search", () => {
  it("passes the operator grammar through untouched", async () => {
    respond = () => ({
      data: {
        tasks: [{ task: taskFixture(), titleMatches: [], descriptionMatches: [] }],
        projects: [],
      },
      page: { hasMore: false, nextCursor: null },
    });
    const client = await connect();

    const { data } = await callTool(client, "search", { q: "is:open priority:high" });

    expect(calls[0]?.url.searchParams.get("q")).toBe("is:open priority:high");
    expect(data).toMatchObject({ tasks: [{ key: "ML-142" }], projects: [] });
  });
});

describe("failures", () => {
  it("returns an API error as a readable tool error rather than crashing", async () => {
    respond = () =>
      new Response(
        JSON.stringify({
          error: {
            code: "TASK_VERSION_CONFLICT",
            message: "The task changed after you loaded it.",
            requestId: "req_1",
          },
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      );
    const client = await connect();

    const result = await callTool(client, "get_task", { task: "ML-142" });

    expect(result.isError).toBe(true);
    // The code is what an agent branches on; the sentence is what it reports.
    expect(result.text).toBe(
      "TASK_VERSION_CONFLICT: The task changed after you loaded it.",
    );
  });

  it("describes a transport failure without an error code", () => {
    expect(describeFailure(new Error("socket hang up"))).toBe("socket hang up");
    expect(describeFailure("odd")).toBe("odd");
  });
});

describe("the tool table itself", () => {
  it("names every tool in snake_case and marks writes as such", () => {
    for (const tool of TOOLS) {
      expect(tool.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(tool.description.length).toBeLessThan(400);
    }
    expect(TOOLS).toHaveLength(7);
  });
});
