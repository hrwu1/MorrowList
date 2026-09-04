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
    const { client, requests } = recordingClient({ data: task });

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
    ).resolves.toEqual(task);

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
