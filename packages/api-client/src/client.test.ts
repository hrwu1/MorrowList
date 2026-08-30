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
