import { describe, expect, it } from "vitest";

import { ApiClient } from "./client.js";

const PROJECT_ID = "0198f0a0-0000-7000-8000-000000000000";
const STATUS_ID = "0198f0a0-0000-7000-8000-000000000001";
const TASK_ID = "0198f0a0-0000-7000-8000-000000000002";

function recordingClient(responseBody: unknown) {
  const requests: Request[] = [];
  const client = new ApiClient({
    baseUrl: "https://example.test/api/v1/",
    workspaceId: "0198f0a0-0000-7000-8000-000000000003",
    fetch: async (input, init) => {
      requests.push(new Request(input, init));
      return Response.json(responseBody);
    },
  });
  return { client, requests };
}

describe("project requests", () => {
  it("requests the bounded board projection with workspace context", async () => {
    const response = {
      data: { project: {}, statuses: [], tasks: [] },
      page: { hasMore: false, truncated: false },
    };
    const { client, requests } = recordingClient(response);

    await expect(client.getProjectBoard(PROJECT_ID, { limit: 125 })).resolves.toEqual(
      response,
    );

    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toBe(
      `https://example.test/api/v1/projects/${PROJECT_ID}/board?workspaceId=0198f0a0-0000-7000-8000-000000000003&limit=125`,
    );
  });

  it("unwraps a created project detail and sends the idempotency key", async () => {
    const detail = { project: { id: PROJECT_ID }, statuses: [] };
    const { client, requests } = recordingClient({ data: detail });

    await expect(
      client.createProject(
        { name: "Research launch" },
        { idempotencyKey: "create-project-1" },
      ),
    ).resolves.toEqual(detail);

    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.headers.get("idempotency-key")).toBe("create-project-1");
    await expect(requests[0]?.json()).resolves.toEqual({ name: "Research launch" });
  });
});

describe("activity requests", () => {
  it("requests a task's history by key with the paging query", async () => {
    const response = { data: [], page: { hasMore: false, nextCursor: null } };
    const { client, requests } = recordingClient(response);

    await expect(
      client.listTaskActivity("ML-12", { limit: 20, cursor: "abc.def" }),
    ).resolves.toEqual(response);

    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toBe(
      "https://example.test/api/v1/tasks/ML-12/activity?workspaceId=0198f0a0-0000-7000-8000-000000000003&limit=20&cursor=abc.def",
    );
  });

  it("requests a project's history", async () => {
    const { client, requests } = recordingClient({
      data: [],
      page: { hasMore: false, nextCursor: null },
    });

    await client.listProjectActivity(PROJECT_ID);

    expect(requests[0]?.url).toBe(
      `https://example.test/api/v1/projects/${PROJECT_ID}/activity?workspaceId=0198f0a0-0000-7000-8000-000000000003`,
    );
  });
});

describe("task movement requests", () => {
  it("moves with destination and server-ranking neighbours", async () => {
    const task = { id: TASK_ID, statusId: STATUS_ID };
    const warning = { code: "IN_PROGRESS_LIMIT_EXCEEDED", limit: 1, count: 2 };
    const { client, requests } = recordingClient({ data: task, warnings: [warning] });

    await expect(
      client.moveTask(
        TASK_ID,
        {
          projectId: PROJECT_ID,
          statusId: STATUS_ID,
          beforeTaskId: null,
          afterTaskId: null,
          expectedVersion: 3,
        },
        { idempotencyKey: "move-1" },
      ),
    ).resolves.toEqual({ task, warnings: [warning] });

    expect(requests[0]?.url).toContain(`/tasks/${TASK_ID}/move?workspaceId=`);
    expect(requests[0]?.headers.get("idempotency-key")).toBe("move-1");
    await expect(requests[0]?.json()).resolves.toMatchObject({
      projectId: PROJECT_ID,
      statusId: STATUS_ID,
      expectedVersion: 3,
    });
  });

  it("reorders within the current status", async () => {
    const task = { id: TASK_ID };
    const { client, requests } = recordingClient({ data: task });

    await client.reorderTask(TASK_ID, { afterTaskId: STATUS_ID });

    expect(requests[0]?.url).toContain(`/tasks/${TASK_ID}/reorder?workspaceId=`);
    await expect(requests[0]?.json()).resolves.toEqual({ afterTaskId: STATUS_ID });
  });
});

describe("My Day and view requests", () => {
  it("adds to and removes from a day, unwrapping the task", async () => {
    const task = { id: TASK_ID, dayPlans: ["2026-09-03"] };
    const { client, requests } = recordingClient({ data: task });

    await expect(
      client.addTaskToDay(TASK_ID, { date: "2026-09-03" }, { idempotencyKey: "day-1" }),
    ).resolves.toEqual(task);
    await client.removeTaskFromDay(TASK_ID, "2026-09-03");

    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toContain(`/tasks/${TASK_ID}/today?workspaceId=`);
    expect(requests[0]?.headers.get("idempotency-key")).toBe("day-1");
    await expect(requests[0]?.json()).resolves.toEqual({ date: "2026-09-03" });
    expect(requests[1]?.method).toBe("DELETE");
    expect(requests[1]?.url).toContain(
      `/tasks/${TASK_ID}/today/2026-09-03?workspaceId=`,
    );
  });

  it("requests the Today and Upcoming projections", async () => {
    const { client, requests } = recordingClient({ data: {} });

    await client.getTodayView({ date: "2026-09-03" });
    await client.getUpcomingView({ horizon: "30" });

    expect(requests[0]?.url).toContain("/views/today?workspaceId=");
    expect(requests[0]?.url).toContain("date=2026-09-03");
    expect(requests[1]?.url).toContain("/views/upcoming?workspaceId=");
    expect(requests[1]?.url).toContain("horizon=30");
  });
});

describe("recurrence requests", () => {
  it("posts the expected version to the skip endpoint", async () => {
    const { client, requests } = recordingClient({ data: { id: TASK_ID } });

    await expect(client.skipOccurrence(TASK_ID, 3)).resolves.toEqual({ id: TASK_ID });

    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe(
      `https://example.test/api/v1/tasks/${TASK_ID}/skip?workspaceId=0198f0a0-0000-7000-8000-000000000003`,
    );
    await expect(requests[0]?.json()).resolves.toEqual({ expectedVersion: 3 });
  });
});

describe("subtask requests", () => {
  it("sets a parent and detaches it with the expected version", async () => {
    const task = { id: TASK_ID, parentTaskId: PROJECT_ID };
    const { client, requests } = recordingClient({ data: task });

    await expect(
      client.setTaskParent(TASK_ID, { parentTaskId: PROJECT_ID, expectedVersion: 2 }),
    ).resolves.toEqual(task);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toContain(`/tasks/${TASK_ID}/parent?workspaceId=`);
    await expect(requests[0]?.json()).resolves.toEqual({
      parentTaskId: PROJECT_ID,
      expectedVersion: 2,
    });

    await client.clearTaskParent(TASK_ID, 3);
    expect(requests[1]?.method).toBe("DELETE");
    expect(requests[1]?.url).toContain(`/tasks/${TASK_ID}/parent?workspaceId=`);
    expect(requests[1]?.url).toContain("expectedVersion=3");
  });
});

describe("relation and blocked requests", () => {
  it("relates, unrelates, flags, clears, and completes with acknowledgement", async () => {
    const task = { id: TASK_ID, relations: [] };
    const { client, requests } = recordingClient({ data: task });

    await expect(
      client.addTaskRelation(TASK_ID, { type: "blocks", targetTaskId: PROJECT_ID }),
    ).resolves.toEqual(task);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toContain(`/tasks/${TASK_ID}/relations?workspaceId=`);
    await expect(requests[0]?.json()).resolves.toEqual({
      type: "blocks",
      targetTaskId: PROJECT_ID,
    });

    await client.removeTaskRelation(TASK_ID, STATUS_ID);
    expect(requests[1]?.method).toBe("DELETE");
    expect(requests[1]?.url).toContain(`/tasks/${TASK_ID}/relations/${STATUS_ID}?`);

    await client.setTaskBlocked(TASK_ID, { reason: "vendor", expectedVersion: 2 });
    expect(requests[2]?.method).toBe("POST");
    expect(requests[2]?.url).toContain(`/tasks/${TASK_ID}/blocked?workspaceId=`);
    await expect(requests[2]?.json()).resolves.toEqual({
      reason: "vendor",
      expectedVersion: 2,
    });

    await client.clearTaskBlocked(TASK_ID, 3);
    expect(requests[3]?.method).toBe("DELETE");
    expect(requests[3]?.url).toContain(`/tasks/${TASK_ID}/blocked?workspaceId=`);
    expect(requests[3]?.url).toContain("expectedVersion=3");

    await client.completeTask(TASK_ID, {
      expectedVersion: 3,
      acknowledgeBlocked: true,
    });
    await expect(requests[4]?.json()).resolves.toEqual({
      expectedVersion: 3,
      acknowledgeBlocked: true,
    });
  });
});

describe("tag requests", () => {
  const TAG_ID = "0198f0a0-0000-7000-8000-000000000004";

  it("attaches a tag to a task and unwraps the task", async () => {
    const task = { id: TASK_ID, tags: [{ id: TAG_ID, name: "Focus" }] };
    const { client, requests } = recordingClient({ data: task });

    await expect(
      client.addTaskTag(TASK_ID, TAG_ID, { idempotencyKey: "tag-1" }),
    ).resolves.toEqual(task);

    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toContain(`/tasks/${TASK_ID}/tags/${TAG_ID}?workspaceId=`);
    expect(requests[0]?.headers.get("idempotency-key")).toBe("tag-1");
  });

  it("deletes a tag and resolves without a body", async () => {
    const requests: Request[] = [];
    const client = new ApiClient({
      baseUrl: "https://example.test/api/v1",
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(null, { status: 204 });
      },
    });

    await expect(client.deleteTag(TAG_ID)).resolves.toBeUndefined();
    expect(requests[0]?.method).toBe("DELETE");
    expect(requests[0]?.url).toBe(`https://example.test/api/v1/tags/${TAG_ID}`);
  });
});

describe("workspace requests", () => {
  it("updates the in-progress limit and unwraps the workspace", async () => {
    const workspace = { id: PROJECT_ID, inProgressLimit: 3 };
    const { client, requests } = recordingClient({ data: workspace });

    await expect(
      client.updateWorkspace(PROJECT_ID, { inProgressLimit: 3 }),
    ).resolves.toEqual(workspace);

    expect(requests[0]?.method).toBe("PATCH");
    expect(requests[0]?.url).toBe(
      `https://example.test/api/v1/workspaces/${PROJECT_ID}`,
    );
    await expect(requests[0]?.json()).resolves.toEqual({ inProgressLimit: 3 });
  });
});

describe("search and saved view requests", () => {
  it("sends the search query with its filters and workspace", async () => {
    const response = {
      data: { tasks: [], projects: [] },
      page: { nextCursor: null, hasMore: false },
    };
    const { client, requests } = recordingClient(response);

    await expect(client.search({ q: "budget due:overdue", limit: 8 })).resolves.toEqual(
      response,
    );

    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toBe(
      "https://example.test/api/v1/search?workspaceId=0198f0a0-0000-7000-8000-000000000003&q=budget+due%3Aoverdue&limit=8",
    );
  });

  it("unwraps a created saved view and reorders by neighbour", async () => {
    const view = { id: TASK_ID, name: "Overdue" };
    const { client, requests } = recordingClient({ data: view });

    await expect(
      client.createSavedView({
        name: "Overdue",
        filters: { due: "overdue" },
        layout: "list",
      }),
    ).resolves.toEqual(view);
    await client.reorderSavedView(TASK_ID, { afterViewId: PROJECT_ID });

    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe(
      "https://example.test/api/v1/views/saved?workspaceId=0198f0a0-0000-7000-8000-000000000003",
    );
    expect(requests[1]?.url).toBe(
      `https://example.test/api/v1/views/saved/${TASK_ID}/reorder?workspaceId=0198f0a0-0000-7000-8000-000000000003`,
    );
    await expect(requests[1]?.json()).resolves.toEqual({ afterViewId: PROJECT_ID });
  });
});

describe("calendar requests", () => {
  it("passes inclusive ranges and exposes one-time feed creation and revocation", async () => {
    const { client, requests } = recordingClient({
      data: {
        url: "https://tasks.example/feed.ics",
        createdAt: "2026-09-07T12:00:00Z",
      },
    });
    await client.getCalendarView({ from: "2026-09-01", to: "2026-09-30" });
    expect(requests[0]!.url).toContain("from=2026-09-01&to=2026-09-30");
    expect((await client.createCalendarFeed()).url).toBe(
      "https://tasks.example/feed.ics",
    );
    expect(requests[1]!.method).toBe("POST");
    await client.revokeCalendarFeed();
    expect(requests[2]!.method).toBe("DELETE");
  });
});

describe("capture address requests", () => {
  it("keeps selected workspace on both address read and rotation", async () => {
    const data = {
      enabled: true,
      address: "secret@inbox.example.com",
      createdAt: null,
    };
    const { client, requests } = recordingClient({ data });
    expect(await client.getInboundAddress({ workspaceId: PROJECT_ID })).toEqual(data);
    await client.rotateInboundAddress({ workspaceId: PROJECT_ID });
    expect(requests[0]?.url).toBe(
      `https://example.test/api/v1/capture/address?workspaceId=${PROJECT_ID}`,
    );
    expect(requests[1]?.url).toBe(
      `https://example.test/api/v1/capture/address/rotate?workspaceId=${PROJECT_ID}`,
    );
    expect(requests[1]?.method).toBe("POST");
  });
});

describe("rule requests", () => {
  it("uses workspace-scoped CRUD, preview and log endpoints", async () => {
    const { client, requests } = recordingClient({ data: { id: TASK_ID } });
    const definition = {
      name: "Plan today",
      trigger: { type: "due.today" as const },
      actions: [{ type: "add_to_day" as const }],
      conditions: [],
      enabled: true,
    };
    await expect(client.createRule(definition)).resolves.toEqual({ id: TASK_ID });
    await client.updateRule(TASK_ID, { enabled: false });
    await client.testRule(TASK_ID, PROJECT_ID);
    await client.listRuleRuns(TASK_ID);
    expect(requests.map((request) => request.method)).toEqual([
      "POST",
      "PATCH",
      "POST",
      "GET",
    ]);
    expect(
      requests.every((request) => new URL(request.url).searchParams.has("workspaceId")),
    ).toBe(true);
    expect(new URL(requests[2]!.url).pathname).toBe(`/api/v1/rules/${TASK_ID}/test`);
    expect(await requests[2]!.json()).toEqual({ taskId: PROJECT_ID });
  });
});
