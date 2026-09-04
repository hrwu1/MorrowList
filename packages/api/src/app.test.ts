import {
  ActivityService,
  FlowService,
  NotificationService,
  ProjectService,
  SavedViewService,
  SearchService,
  TagService,
  TaskService,
  ViewService,
  WorkflowService,
  WorkspaceService,
  bootstrapUser,
} from "@morrowlist/application";
import type { AuthPort, AuthenticatedUser } from "@morrowlist/auth";
import { fixedClock, uuidv7 } from "@morrowlist/domain";
import { silentLogger } from "@morrowlist/observability";
import {
  createInMemoryUnitOfWork,
  createRecordingEmailSender,
  emptyData,
  type InMemoryUnitOfWork,
} from "@morrowlist/testkit";
import { beforeEach, describe, expect, it } from "vitest";

import { createApiApp } from "./app.js";
import type { ApiDependencies } from "./context.js";

/**
 * Route-level tests over the real Hono app: middleware, validation, error envelope, and
 * status mapping are all exercised. The application layer runs against in-memory ports.
 */

const NOW = new Date("2026-08-29T09:00:00.000Z");

let unitOfWork: InMemoryUnitOfWork;
let app: ReturnType<typeof createApiApp>;
let deps: ApiDependencies;
let currentUser: AuthenticatedUser | null;
let healthy: boolean;

function request(path: string, init?: RequestInit) {
  return app.request(`http://localhost${path}`, init);
}

function jsonRequest(path: string, method: string, body?: unknown) {
  return request(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(async () => {
  unitOfWork = createInMemoryUnitOfWork(emptyData());
  healthy = true;

  const userId = uuidv7();
  await bootstrapUser(
    { unitOfWork, clock: fixedClock(NOW) },
    {
      userId,
      email: "alex@example.com",
      displayName: "Alex",
      timezone: "Europe/Berlin",
      taskKeyPrefix: "ML",
    },
  );
  currentUser = { id: userId, email: "alex@example.com", name: "Alex" };

  const auth: AuthPort = {
    resolveUser: async () => currentUser,
    handleRequest: async () => new Response("not used", { status: 404 }),
  };

  deps = {
    auth,
    unitOfWork,
    workspaceService: new WorkspaceService({ unitOfWork, clock: fixedClock(NOW) }),
    projectService: new ProjectService({ unitOfWork, clock: fixedClock(NOW) }),
    workflowService: new WorkflowService({ unitOfWork, clock: fixedClock(NOW) }),
    taskService: new TaskService({
      unitOfWork,
      clock: fixedClock(NOW),
      cursorSecret: "test-secret",
    }),
    activityService: new ActivityService({ unitOfWork, cursorSecret: "test-secret" }),
    flowService: new FlowService({ unitOfWork, clock: fixedClock(NOW) }),
    viewService: new ViewService({ unitOfWork, clock: fixedClock(NOW) }),
    tagService: new TagService({ unitOfWork, clock: fixedClock(NOW) }),
    searchService: new SearchService({
      unitOfWork,
      clock: fixedClock(NOW),
      cursorSecret: "test-secret",
    }),
    savedViewService: new SavedViewService({ unitOfWork, clock: fixedClock(NOW) }),
    notificationService: new NotificationService({
      unitOfWork,
      clock: fixedClock(NOW),
      cursorSecret: "test-secret",
      emailSender: createRecordingEmailSender(),
      userDirectory: { findById: async () => currentUser },
      appUrl: "http://localhost:3000",
    }),
    logger: silentLogger,
    checkHealth: async () =>
      healthy
        ? { ok: true, latencyMs: 1 }
        : { ok: false, latencyMs: 1, error: "connection refused" },
  };
  app = createApiApp(deps);
});

describe("probes", () => {
  it("reports liveness without touching the database", async () => {
    healthy = false;
    const response = await request("/api/v1/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("reports readiness failure as 503", async () => {
    healthy = false;
    const response = await request("/api/v1/ready");

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "unavailable",
      checks: { database: { ok: false } },
    });
  });

  it("does not require authentication", async () => {
    currentUser = null;

    expect((await request("/api/v1/health")).status).toBe(200);
  });
});

describe("request identity", () => {
  it("returns a generated request ID", async () => {
    const response = await request("/api/v1/health");

    expect(response.headers.get("x-request-id")).toMatch(/^req_/);
  });

  it("echoes a safe client-supplied request ID", async () => {
    const response = await request("/api/v1/health", {
      headers: { "x-request-id": "trace-abcdef123456" },
    });

    expect(response.headers.get("x-request-id")).toBe("trace-abcdef123456");
  });

  it("replaces an unsafe client-supplied request ID", async () => {
    const response = await request("/api/v1/health", {
      headers: { "x-request-id": "a" },
    });

    expect(response.headers.get("x-request-id")).toMatch(/^req_/);
  });
});

describe("authentication", () => {
  it("rejects an unauthenticated request with the error envelope", async () => {
    currentUser = null;
    const response = await request("/api/v1/tasks");

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({
      error: { code: "AUTH_REQUIRED", message: "Sign in to continue." },
    });
    expect(body.error.requestId).toMatch(/^req_/);
  });

  it("returns the caller and their workspace from /me", async () => {
    const response = await request("/api/v1/me");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.user).toMatchObject({
      email: "alex@example.com",
      name: "Alex",
    });
    expect(body.data.workspaces).toHaveLength(1);
    expect(body.data.workspaces[0].role).toBe("owner");
    expect(body.data.workspaces[0]).toMatchObject({
      inProgressLimit: null,
      inProgressCount: 0,
    });
    expect(body.data.defaultWorkspaceId).toBe(body.data.workspaces[0].id);
  });
});

describe("workspace settings and the in-progress limit", () => {
  async function startTaskIn(projectName: string) {
    const created = await (
      await jsonRequest("/api/v1/projects", "POST", { name: projectName })
    ).json();
    const projectId = created.data.project.id as string;
    const byCategory = (category: string) =>
      created.data.statuses.find(
        (status: { category: string }) => status.category === category,
      ).id as string;
    const task = await (
      await jsonRequest("/api/v1/tasks", "POST", {
        title: `${projectName} work`,
        projectId,
        statusId: byCategory("ready"),
      })
    ).json();
    return (await jsonRequest(`/api/v1/tasks/${task.data.id}/move`, "POST", {
      projectId,
      statusId: byCategory("in_progress"),
    })) as Response;
  }

  it("sets the limit, counts started work in /me, and warns without blocking", async () => {
    const me = await (await request("/api/v1/me")).json();
    const workspaceId = me.data.defaultWorkspaceId as string;

    const updated = await jsonRequest(`/api/v1/workspaces/${workspaceId}`, "PATCH", {
      inProgressLimit: 1,
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      data: { id: workspaceId, inProgressLimit: 1, version: 2 },
    });

    const first = await (await startTaskIn("Alpha")).json();
    expect(first.warnings).toEqual([]);
    const second = await startTaskIn("Beta");
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body.data.isCompleted).toBe(false);
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]).toMatchObject({
      code: "IN_PROGRESS_LIMIT_EXCEEDED",
      limit: 1,
      count: 2,
    });
    expect(body.warnings[0].tasks.map((task: { title: string }) => task.title)).toEqual(
      ["Alpha work", "Beta work"],
    );

    const after = await (await request("/api/v1/me")).json();
    expect(after.data.workspaces[0]).toMatchObject({
      inProgressLimit: 1,
      inProgressCount: 2,
    });
  });

  it("validates the limit and hides another workspace", async () => {
    const me = await (await request("/api/v1/me")).json();
    const workspaceId = me.data.defaultWorkspaceId as string;

    expect(
      (await jsonRequest(`/api/v1/workspaces/${workspaceId}`, "PATCH", {})).status,
    ).toBe(422);
    expect(
      (
        await jsonRequest(`/api/v1/workspaces/${workspaceId}`, "PATCH", {
          inProgressLimit: 0,
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await jsonRequest(`/api/v1/workspaces/${uuidv7()}`, "PATCH", {
          inProgressLimit: 2,
        })
      ).status,
    ).toBe(404);
  });
});

describe("task endpoints", () => {
  it("creates a task from a title alone and returns 201", async () => {
    const response = await jsonRequest("/api/v1/tasks", "POST", {
      title: "Prepare research presentation",
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data).toMatchObject({
      key: "ML-1",
      title: "Prepare research presentation",
      projectId: null,
      statusId: null,
      version: 1,
      isCompleted: false,
    });
  });

  it("lists created tasks", async () => {
    await jsonRequest("/api/v1/tasks", "POST", { title: "First" });
    await jsonRequest("/api/v1/tasks", "POST", { title: "Second" });

    const response = await request("/api/v1/tasks");
    const body = await response.json();

    expect(body.data.map((t: { title: string }) => t.title)).toEqual([
      "First",
      "Second",
    ]);
    expect(body.page).toEqual({ nextCursor: null, hasMore: false });
  });

  it("fetches a task by its workspace key", async () => {
    await jsonRequest("/api/v1/tasks", "POST", { title: "Findable" });

    const response = await request("/api/v1/tasks/ML-1");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { title: "Findable" },
    });
  });

  it("completes and reopens a task", async () => {
    const created = await (
      await jsonRequest("/api/v1/tasks", "POST", {
        title: "Call the bank",
      })
    ).json();

    const completed = await (
      await jsonRequest(`/api/v1/tasks/${created.data.id}/complete`, "POST")
    ).json();
    expect(completed.data.isCompleted).toBe(true);

    const reopened = await (
      await jsonRequest(`/api/v1/tasks/${created.data.id}/reopen`, "POST")
    ).json();
    expect(reopened.data.isCompleted).toBe(false);
  });

  it("creates a repeating task, spawns the next occurrence on completion, and skips", async () => {
    const created = await (
      await jsonRequest("/api/v1/tasks", "POST", {
        title: "Water plants",
        dueDate: "2026-08-29",
        recurrence: { freq: "weekly", weekdays: ["sat"] },
      })
    ).json();
    expect(created.data.recurrence).toMatchObject({
      freq: "weekly",
      weekdays: ["sat"],
    });
    expect(created.data.seriesId).toBe(created.data.id);

    const skipped = await (
      await jsonRequest(`/api/v1/tasks/${created.data.id}/skip`, "POST", {
        expectedVersion: 1,
      })
    ).json();
    expect(skipped.data).toMatchObject({
      id: created.data.id,
      dueDate: "2026-09-05",
      version: 2,
    });

    await jsonRequest(`/api/v1/tasks/${created.data.id}/complete`, "POST");
    const series = await (
      await request(`/api/v1/tasks?seriesId=${created.data.id}&sort=dueDate`)
    ).json();
    expect(
      series.data.map((t: { key: string; dueDate: string }) => [t.key, t.dueDate]),
    ).toEqual([
      ["ML-1", "2026-09-05"],
      ["ML-2", "2026-09-12"],
    ]);

    // Completed: nothing to skip. Both rejections are validation failures.
    const invalid = await jsonRequest(`/api/v1/tasks/${created.data.id}/skip`, "POST");
    expect(invalid.status).toBe(422);
    const badRule = await jsonRequest(`/api/v1/tasks/${created.data.id}`, "PATCH", {
      recurrence: { freq: "monthly" },
    });
    expect(badRule.status).toBe(422);
  });

  it("soft deletes and restores a task", async () => {
    const created = await (
      await jsonRequest("/api/v1/tasks", "POST", {
        title: "Mistake",
      })
    ).json();

    const deleted = await jsonRequest(`/api/v1/tasks/${created.data.id}`, "DELETE");
    expect(deleted.status).toBe(200);

    const afterDelete = await (await request("/api/v1/tasks")).json();
    expect(afterDelete.data).toHaveLength(0);

    // Trash is reachable as its own list rather than as an option on the normal one.
    const trash = await (await request("/api/v1/tasks?deleted=true")).json();
    expect(trash.data.map((t: { title: string }) => t.title)).toEqual(["Mistake"]);

    await jsonRequest(`/api/v1/tasks/${created.data.id}/restore`, "POST");
    const afterRestore = await (await request("/api/v1/tasks")).json();
    expect(afterRestore.data).toHaveLength(1);
    const emptyTrash = await (await request("/api/v1/tasks?deleted=true")).json();
    expect(emptyTrash.data).toHaveLength(0);
  });

  it("attaches and detaches a parent, reporting progress and nesting errors", async () => {
    const parent = await (
      await jsonRequest("/api/v1/tasks", "POST", { title: "Parent" })
    ).json();
    const child = await (
      await jsonRequest("/api/v1/tasks", "POST", { title: "Child" })
    ).json();

    const attached = await jsonRequest(
      `/api/v1/tasks/${child.data.id}/parent`,
      "POST",
      {
        parentTaskId: parent.data.id,
      },
    );
    expect(attached.status).toBe(200);
    await expect(attached.json()).resolves.toMatchObject({
      data: { parentTaskId: parent.data.id, version: 2 },
    });

    const listed = await (await request("/api/v1/tasks")).json();
    expect(
      listed.data.find((t: { id: string }) => t.id === parent.data.id).subtaskProgress,
    ).toEqual({ completed: 0, total: 1 });
    const children = await (
      await request(`/api/v1/tasks?parentTaskId=${parent.data.id}`)
    ).json();
    expect(children.data.map((t: { id: string }) => t.id)).toEqual([child.data.id]);

    const cycle = await jsonRequest(`/api/v1/tasks/${parent.data.id}/parent`, "POST", {
      parentTaskId: child.data.id,
    });
    expect(cycle.status).toBe(422);
    await expect(cycle.json()).resolves.toMatchObject({
      error: { code: "TASK_RELATION_CYCLE" },
    });

    const detached = await jsonRequest(
      `/api/v1/tasks/${child.data.id}/parent?expectedVersion=2`,
      "DELETE",
    );
    expect(detached.status).toBe(200);
    await expect(detached.json()).resolves.toMatchObject({
      data: { parentTaskId: null, version: 3, subtaskProgress: null },
    });
  });

  it("relates tasks, reports blocked state, and gates completion", async () => {
    const source = await (
      await jsonRequest("/api/v1/tasks", "POST", { title: "Collect sources" })
    ).json();
    const target = await (
      await jsonRequest("/api/v1/tasks", "POST", { title: "Make slides" })
    ).json();

    const added = await jsonRequest(
      `/api/v1/tasks/${source.data.id}/relations`,
      "POST",
      {
        type: "blocks",
        targetTaskId: target.data.id,
      },
    );
    expect(added.status).toBe(201);
    const addedBody = await added.json();
    expect(addedBody.data.relations[0]).toMatchObject({
      type: "blocks",
      task: { key: "ML-2", title: "Make slides" },
    });

    const blocked = await (await request(`/api/v1/tasks?isBlocked=true`)).json();
    expect(blocked.data.map((t: { key: string }) => t.key)).toEqual(["ML-2"]);

    const refused = await jsonRequest(
      `/api/v1/tasks/${target.data.id}/complete`,
      "POST",
    );
    expect(refused.status).toBe(409);
    await expect(refused.json()).resolves.toMatchObject({
      error: { code: "TASK_BLOCKED" },
    });
    const completed = await jsonRequest(
      `/api/v1/tasks/${target.data.id}/complete`,
      "POST",
      { acknowledgeBlocked: true },
    );
    expect(completed.status).toBe(200);

    const cycle = await jsonRequest(
      `/api/v1/tasks/${target.data.id}/relations`,
      "POST",
      {
        type: "blocks",
        targetTaskId: source.data.id,
      },
    );
    expect(cycle.status).toBe(422);
    await expect(cycle.json()).resolves.toMatchObject({
      error: { code: "TASK_RELATION_CYCLE" },
    });

    const removed = await jsonRequest(
      `/api/v1/tasks/${target.data.id}/relations/${addedBody.data.relations[0].id}`,
      "DELETE",
    );
    expect(removed.status).toBe(200);
    await expect(removed.json()).resolves.toMatchObject({ data: { relations: [] } });
    const missing = await jsonRequest(
      `/api/v1/tasks/${target.data.id}/relations/${addedBody.data.relations[0].id}`,
      "DELETE",
    );
    expect(missing.status).toBe(404);
  });

  it("flags and clears the blocked reason", async () => {
    const task = await (
      await jsonRequest("/api/v1/tasks", "POST", { title: "Waiting" })
    ).json();

    const flagged = await jsonRequest(`/api/v1/tasks/${task.data.id}/blocked`, "POST", {
      reason: "waiting on vendor",
    });
    expect(flagged.status).toBe(200);
    await expect(flagged.json()).resolves.toMatchObject({
      data: {
        isBlocked: true,
        blocked: { reason: "waiting on vendor", since: NOW.toISOString() },
        version: 2,
      },
    });
    const blank = await jsonRequest(`/api/v1/tasks/${task.data.id}/blocked`, "POST", {
      reason: "   ",
    });
    expect(blank.status).toBe(422);

    const cleared = await jsonRequest(
      `/api/v1/tasks/${task.data.id}/blocked?expectedVersion=2`,
      "DELETE",
    );
    expect(cleared.status).toBe(200);
    await expect(cleared.json()).resolves.toMatchObject({
      data: { isBlocked: false, blocked: null, version: 3 },
    });
  });

  it("maps a version conflict to 409 with the actual version", async () => {
    const created = await (
      await jsonRequest("/api/v1/tasks", "POST", {
        title: "Draft",
      })
    ).json();
    await jsonRequest(`/api/v1/tasks/${created.data.id}`, "PATCH", {
      title: "Second",
    });

    const response = await jsonRequest(`/api/v1/tasks/${created.data.id}`, "PATCH", {
      title: "Third",
      expectedVersion: 1,
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "TASK_VERSION_CONFLICT",
        details: { expectedVersion: 1, actualVersion: 2 },
      },
    });
  });

  it("maps a missing task to 404", async () => {
    const response = await request(`/api/v1/tasks/${uuidv7()}`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "TASK_NOT_FOUND" },
    });
  });

  it("maps a validation failure to 422 with field detail", async () => {
    const response = await jsonRequest("/api/v1/tasks", "POST", { title: "" });

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details.issues[0].path).toBe("title");
  });

  it("rejects a malformed JSON body", async () => {
    const response = await request("/api/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
        message: "Request body must be valid JSON.",
      },
    });
  });

  it("rejects an oversized body before parsing it", async () => {
    const response = await request("/api/v1/tasks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "2000000",
      },
      body: JSON.stringify({ title: "x" }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: "Request body is too large." },
    });
  });

  it("returns the error envelope for an unknown endpoint", async () => {
    const response = await request("/api/v1/nope");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });

  it("hides another workspace behind not-found", async () => {
    const otherWorkspaceId = uuidv7();
    const response = await request(`/api/v1/tasks?workspaceId=${otherWorkspaceId}`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "WORKSPACE_NOT_FOUND" },
    });
  });
});

describe("activity endpoints", () => {
  it("lists a task's history by key, newest first, with readable changes", async () => {
    const created = await (
      await jsonRequest("/api/v1/tasks", "POST", { title: "Draft brief" })
    ).json();
    await jsonRequest(`/api/v1/tasks/${created.data.id}`, "PATCH", {
      title: "Draft the brief",
      expectedVersion: 1,
    });

    const response = await request("/api/v1/tasks/ML-1/activity?limit=1");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      eventType: "task.updated",
      summary: "Updated task fields",
      actorKind: "user",
      actorDisplayName: "Alex",
      changes: [{ field: "title", from: "Draft brief", to: "Draft the brief" }],
    });
    expect(body.page.hasMore).toBe(true);

    const rest = await request(
      `/api/v1/tasks/ML-1/activity?cursor=${encodeURIComponent(body.page.nextCursor)}`,
    );
    const restBody = await rest.json();
    expect(
      restBody.data.map((entry: { eventType: string }) => entry.eventType),
    ).toEqual(["task.created"]);
    expect(restBody.page).toEqual({ hasMore: false, nextCursor: null });
  });

  it("rejects a tampered cursor and reports an unknown task", async () => {
    const forged = await request("/api/v1/tasks/ML-1/activity?cursor=abc.def");
    expect(forged.status).toBe(404);

    await jsonRequest("/api/v1/tasks", "POST", { title: "Exists" });
    const tampered = await request("/api/v1/tasks/ML-1/activity?cursor=abc.def");
    expect(tampered.status).toBe(422);
    await expect(tampered.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_FAILED" },
    });

    const missing = await request("/api/v1/tasks/ML-9/activity");
    expect(missing.status).toBe(404);
  });

  it("lists a project's history including its tasks", async () => {
    const project = await (
      await jsonRequest("/api/v1/projects", "POST", { name: "Launch" })
    ).json();
    await jsonRequest("/api/v1/tasks", "POST", {
      title: "Inside",
      projectId: project.data.project.id,
    });
    await jsonRequest("/api/v1/tasks", "POST", { title: "Outside" });

    const response = await request(
      `/api/v1/projects/${project.data.project.id}/activity`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.map((entry: { eventType: string }) => entry.eventType)).toEqual([
      "task.created",
      "project.created",
    ]);
  });
});

describe("project and board endpoints", () => {
  it("creates, lists, and gets a project with its ordered default workflow", async () => {
    const createdResponse = await jsonRequest("/api/v1/projects", "POST", {
      name: "Research launch",
      colorToken: "blue",
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();

    expect(created.data.project).toMatchObject({
      name: "Research launch",
      slug: "research-launch",
    });
    expect(
      created.data.statuses.map((status: { name: string }) => status.name),
    ).toEqual(["Backlog", "Ready", "In Progress", "Blocked", "In Review", "Done"]);

    const listed = await (await request("/api/v1/projects")).json();
    expect(listed.data.map((project: { name: string }) => project.name)).toEqual([
      "Research launch",
    ]);
    expect(listed.page).toEqual({ nextCursor: null, hasMore: false });

    const fetched = await (
      await request(`/api/v1/projects/${created.data.project.id}`)
    ).json();
    expect(fetched.data).toEqual(created.data);
  });

  it("returns one normalized board response and reports truncation", async () => {
    const created = await (
      await jsonRequest("/api/v1/projects", "POST", { name: "Research launch" })
    ).json();
    const projectId = created.data.project.id as string;
    const readyId = created.data.statuses.find(
      (status: { category: string }) => status.category === "ready",
    ).id as string;

    await jsonRequest("/api/v1/tasks", "POST", {
      title: "First board card",
      projectId,
      statusId: readyId,
    });
    await jsonRequest("/api/v1/tasks", "POST", {
      title: "Second board card",
      projectId,
      statusId: readyId,
    });

    const response = await request(`/api/v1/projects/${projectId}/board?limit=1`);
    expect(response.status).toBe(200);
    const board = await response.json();

    expect(board.data.project.id).toBe(projectId);
    expect(board.data.statuses).toHaveLength(6);
    expect(board.data.tasks).toHaveLength(1);
    expect(board.page).toEqual({ hasMore: true, truncated: true });
  });

  it("hides subtasks from the board unless includeSubtasks is set", async () => {
    const project = await (
      await jsonRequest("/api/v1/projects", "POST", { name: "Research Launch" })
    ).json();
    const parent = await (
      await jsonRequest("/api/v1/tasks", "POST", {
        title: "Parent",
        projectId: project.data.project.id,
      })
    ).json();
    await jsonRequest("/api/v1/tasks", "POST", {
      title: "Child",
      parentTaskId: parent.data.id,
    });

    const hidden = await (
      await request(`/api/v1/projects/${project.data.project.id}/board`)
    ).json();
    expect(hidden.data.tasks.map((t: { title: string }) => t.title)).toEqual([
      "Parent",
    ]);
    expect(hidden.data.tasks[0].subtaskProgress).toEqual({ completed: 0, total: 1 });

    const shown = await (
      await request(
        `/api/v1/projects/${project.data.project.id}/board?includeSubtasks=true`,
      )
    ).json();
    expect(shown.data.tasks.map((t: { title: string }) => t.title)).toEqual([
      "Parent",
      "Child",
    ]);
  });

  it("moves a task across statuses and reorders from neighbour IDs", async () => {
    const created = await (
      await jsonRequest("/api/v1/projects", "POST", { name: "Research launch" })
    ).json();
    const projectId = created.data.project.id as string;
    const readyId = created.data.statuses.find(
      (status: { category: string }) => status.category === "ready",
    ).id as string;
    const progressId = created.data.statuses.find(
      (status: { category: string }) => status.category === "in_progress",
    ).id as string;

    const first = await (
      await jsonRequest("/api/v1/tasks", "POST", {
        title: "First",
        projectId,
        statusId: readyId,
      })
    ).json();
    const second = await (
      await jsonRequest("/api/v1/tasks", "POST", {
        title: "Second",
        projectId,
        statusId: readyId,
      })
    ).json();

    const reordered = await (
      await jsonRequest(`/api/v1/tasks/${second.data.id}/reorder`, "POST", {
        afterTaskId: first.data.id,
        expectedVersion: second.data.version,
      })
    ).json();
    expect(reordered.data.rank < first.data.rank).toBe(true);

    const moved = await (
      await jsonRequest(`/api/v1/tasks/${reordered.data.id}/move`, "POST", {
        projectId,
        statusId: progressId,
        expectedVersion: reordered.data.version,
      })
    ).json();
    expect(moved.data.statusId).toBe(progressId);
  });

  it("rejects ambiguous movement neighbours before calling the service", async () => {
    const response = await jsonRequest(`/api/v1/tasks/${uuidv7()}/reorder`, "POST", {
      beforeTaskId: "0198f0a0-0000-7000-8000-000000000002",
      afterTaskId: "0198f0a0-0000-7000-8000-000000000002",
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_FAILED" },
    });
  });
});

describe("My Day and view endpoints", () => {
  it("adds a task to today, shows it in the Today view, and removes it again", async () => {
    const created = await (
      await jsonRequest("/api/v1/tasks", "POST", { title: "Chosen for today" })
    ).json();
    await jsonRequest("/api/v1/tasks", "POST", {
      title: "Overdue",
      dueDate: "2026-08-20",
    });

    const added = await jsonRequest(`/api/v1/tasks/${created.data.id}/today`, "POST");
    expect(added.status).toBe(200);
    await expect(added.json()).resolves.toMatchObject({
      data: { id: created.data.id, dayPlans: ["2026-08-29"], version: 1 },
    });

    const today = await request("/api/v1/views/today");
    expect(today.status).toBe(200);
    const view = await today.json();
    expect(view.data.date).toBe("2026-08-29");
    expect(view.data.sections.map((s: { id: string }) => s.id)).toEqual([
      "overdue",
      "due_today",
      "my_day",
    ]);
    expect(view.data.sections[0].tasks[0]).toMatchObject({
      task: { title: "Overdue" },
      reasons: ["overdue"],
    });
    expect(view.data.sections[2].tasks[0]).toMatchObject({
      task: { id: created.data.id },
      reasons: ["my_day"],
    });
    expect(view.data.review).toBeNull();

    const removed = await request(`/api/v1/tasks/${created.data.id}/today/2026-08-29`, {
      method: "DELETE",
    });
    expect(removed.status).toBe(200);
    await expect(removed.json()).resolves.toMatchObject({ data: { dayPlans: [] } });
  });

  it("surfaces yesterday's unfinished selection in the review, not the sections", async () => {
    const created = await (
      await jsonRequest("/api/v1/tasks", "POST", { title: "Left over" })
    ).json();
    await jsonRequest(`/api/v1/tasks/${created.data.id}/today`, "POST", {
      date: "2026-08-28",
    });

    const view = await (await request("/api/v1/views/today")).json();

    expect(view.data.review).toMatchObject({
      date: "2026-08-28",
      tasks: [{ id: created.data.id }],
    });
    expect(
      view.data.sections.every((s: { tasks: unknown[] }) => s.tasks.length === 0),
    ).toBe(true);
  });

  it("validates the day plan date and the view queries", async () => {
    const created = await (
      await jsonRequest("/api/v1/tasks", "POST", { title: "Dated" })
    ).json();

    const badBody = await jsonRequest(
      `/api/v1/tasks/${created.data.id}/today`,
      "POST",
      {
        date: "tomorrow",
      },
    );
    expect(badBody.status).toBe(422);
    const badPath = await request(`/api/v1/tasks/${created.data.id}/today/nope`, {
      method: "DELETE",
    });
    expect(badPath.status).toBe(422);
    expect((await request("/api/v1/views/today?date=2026-13-01")).status).toBe(422);
    expect((await request("/api/v1/views/upcoming?horizon=9")).status).toBe(422);
  });

  it("groups upcoming tasks by date within the requested horizon", async () => {
    await jsonRequest("/api/v1/tasks", "POST", {
      title: "Soon",
      dueDate: "2026-08-30",
    });
    await jsonRequest("/api/v1/tasks", "POST", {
      title: "Later",
      dueDate: "2026-09-20",
    });

    const fortnight = await (await request("/api/v1/views/upcoming")).json();
    const all = await (await request("/api/v1/views/upcoming?horizon=all")).json();

    expect(fortnight.data).toMatchObject({ from: "2026-08-29", horizon: "14" });
    expect(fortnight.data.groups.map((g: { date: string }) => g.date)).toEqual([
      "2026-08-30",
    ]);
    expect(all.data.groups.map((g: { date: string }) => g.date)).toEqual([
      "2026-08-30",
      "2026-09-20",
    ]);
  });

  it("requires authentication for the views", async () => {
    currentUser = null;

    expect((await request("/api/v1/views/today")).status).toBe(401);
  });
});

describe("tag endpoints", () => {
  it("creates, lists, renames, attaches, filters by, detaches, and deletes a tag", async () => {
    const createdResponse = await jsonRequest("/api/v1/tags", "POST", {
      name: " Deep  Work ",
      colorToken: "teal",
    });
    expect(createdResponse.status).toBe(201);
    const tag = (await createdResponse.json()).data;
    expect(tag).toMatchObject({ name: "Deep Work", colorToken: "teal" });

    const task = (
      await (
        await jsonRequest("/api/v1/tasks", "POST", { title: "Focus block" })
      ).json()
    ).data;
    await jsonRequest("/api/v1/tasks", "POST", { title: "Untagged" });

    const attached = await jsonRequest(
      `/api/v1/tasks/${task.id}/tags/${tag.id}`,
      "POST",
    );
    expect(attached.status).toBe(200);
    const attachedBody = await attached.json();
    expect(attachedBody.data.tags.map((t: { name: string }) => t.name)).toEqual([
      "Deep Work",
    ]);
    expect(attachedBody.data.version).toBe(task.version);

    const listed = await (await request("/api/v1/tags")).json();
    expect(listed.data).toEqual([
      expect.objectContaining({ id: tag.id, taskCount: 1 }),
    ]);

    const filtered = await (await request(`/api/v1/tasks?tagId=${tag.id}`)).json();
    expect(filtered.data.map((t: { title: string }) => t.title)).toEqual([
      "Focus block",
    ]);

    const renamed = await jsonRequest(`/api/v1/tags/${tag.id}`, "PATCH", {
      name: "Deep Focus",
    });
    expect(renamed.status).toBe(200);
    const fetched = await (await request(`/api/v1/tasks/${task.id}`)).json();
    expect(fetched.data.tags[0].name).toBe("Deep Focus");

    const detached = await jsonRequest(
      `/api/v1/tasks/${task.id}/tags/${tag.id}`,
      "DELETE",
    );
    expect((await detached.json()).data.tags).toEqual([]);

    const deleted = await request(`/api/v1/tags/${tag.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(204);
    expect((await (await request("/api/v1/tags")).json()).data).toEqual([]);
  });

  it("maps a case-insensitive duplicate to 409 with a clear message", async () => {
    await jsonRequest("/api/v1/tags", "POST", { name: "Deep Work" });

    const response = await jsonRequest("/api/v1/tags", "POST", { name: "deep work" });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "TAG_NAME_CONFLICT",
        message: expect.stringContaining("already exists"),
      },
    });
  });

  it("maps an unknown tag to 404 and an unknown colour to 422", async () => {
    const task = (
      await (await jsonRequest("/api/v1/tasks", "POST", { title: "x" })).json()
    ).data;

    const missing = await jsonRequest(
      `/api/v1/tasks/${task.id}/tags/${uuidv7()}`,
      "POST",
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      error: { code: "TAG_NOT_FOUND" },
    });

    const badColour = await jsonRequest("/api/v1/tags", "POST", {
      name: "x",
      colorToken: "magenta",
    });
    expect(badColour.status).toBe(422);
  });
});

describe("workflow editing endpoints", () => {
  async function createProject(name = "Research launch") {
    const created = await (
      await jsonRequest("/api/v1/projects", "POST", { name })
    ).json();
    const statuses = created.data.statuses as {
      id: string;
      category: string;
      name: string;
    }[];
    const byCategory = (category: string) => {
      const status = statuses.find((candidate) => candidate.category === category);
      if (!status) throw new Error(`no ${category} status`);
      return status;
    };
    return { projectId: created.data.project.id as string, statuses, byCategory };
  }

  it("adds, renames, reorders, and lists columns", async () => {
    const { projectId, byCategory } = await createProject();

    const createdResponse = await jsonRequest(
      `/api/v1/projects/${projectId}/statuses`,
      "POST",
      { name: "Testing", category: "review", wipLimit: 2 },
    );
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()).data;
    expect(created).toMatchObject({ name: "Testing", wipLimit: 2, policyMd: null });

    const renamed = await (
      await jsonRequest(`/api/v1/statuses/${created.id}`, "PATCH", {
        name: "QA",
        policyMd: "Two reviewers.",
        expectedVersion: 1,
      })
    ).json();
    expect(renamed.data).toMatchObject({
      name: "QA",
      category: "review",
      policyMd: "Two reviewers.",
      version: 2,
    });

    const reordered = await jsonRequest(
      `/api/v1/statuses/${created.id}/reorder`,
      "POST",
      {
        afterStatusId: byCategory("backlog").id,
      },
    );
    expect(reordered.status).toBe(200);

    const listed = await (
      await request(`/api/v1/projects/${projectId}/statuses`)
    ).json();
    expect(listed.data.map((status: { name: string }) => status.name)).toEqual([
      "QA",
      "Backlog",
      "Ready",
      "In Progress",
      "Blocked",
      "In Review",
      "Done",
    ]);
  });

  it("archives a column with its tasks and reports the workflow rules as 409", async () => {
    const { projectId, byCategory } = await createProject();
    const ready = byCategory("ready");
    const blocked = byCategory("blocked");
    const task = await (
      await jsonRequest("/api/v1/tasks", "POST", {
        title: "Stuck",
        projectId,
        statusId: blocked.id,
      })
    ).json();

    const noDestination = await jsonRequest(
      `/api/v1/statuses/${blocked.id}/archive`,
      "POST",
      {},
    );
    expect(noDestination.status).toBe(409);
    await expect(noDestination.json()).resolves.toMatchObject({
      error: { code: "STATUS_ARCHIVE_REQUIRES_DESTINATION" },
    });

    const defaultWithoutReplacement = await jsonRequest(
      `/api/v1/statuses/${ready.id}/archive`,
      "POST",
      {},
    );
    expect(defaultWithoutReplacement.status).toBe(409);
    await expect(defaultWithoutReplacement.json()).resolves.toMatchObject({
      error: { code: "STATUS_ARCHIVE_REQUIRES_REPLACEMENT" },
    });

    const lastDone = await jsonRequest(
      `/api/v1/statuses/${byCategory("done").id}/archive`,
      "POST",
      {},
    );
    expect(lastDone.status).toBe(422);
    await expect(lastDone.json()).resolves.toMatchObject({
      error: { code: "WORKFLOW_INVARIANT_VIOLATED" },
    });

    const archived = await jsonRequest(
      `/api/v1/statuses/${blocked.id}/archive`,
      "POST",
      {
        destinationStatusId: ready.id,
      },
    );
    expect(archived.status).toBe(200);
    const moved = await (await request(`/api/v1/tasks/${task.data.id}`)).json();
    expect(moved.data.statusId).toBe(ready.id);

    const listed = await (
      await request(`/api/v1/projects/${projectId}/statuses`)
    ).json();
    expect(listed.data.map((status: { id: string }) => status.id)).not.toContain(
      blocked.id,
    );
    const withArchived = await (
      await request(`/api/v1/projects/${projectId}/statuses?includeArchived=true`)
    ).json();
    expect(withArchived.data).toHaveLength(6);
  });

  it("maps a stale status version to 409 VERSION_CONFLICT", async () => {
    const { byCategory } = await createProject();
    const response = await jsonRequest(
      `/api/v1/statuses/${byCategory("ready").id}`,
      "PATCH",
      {
        name: "Next",
        expectedVersion: 9,
      },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VERSION_CONFLICT" },
    });
  });

  it("updates, archives, lists, and restores a project", async () => {
    const { projectId } = await createProject();

    const updated = await (
      await jsonRequest(`/api/v1/projects/${projectId}`, "PATCH", {
        name: "Research relaunch",
        colorToken: "violet",
      })
    ).json();
    expect(updated.data).toMatchObject({ name: "Research relaunch", version: 2 });

    const archived = await jsonRequest(
      `/api/v1/projects/${projectId}/archive`,
      "POST",
      {},
    );
    expect(archived.status).toBe(200);

    const visible = await (await request("/api/v1/projects")).json();
    expect(visible.data).toEqual([]);
    const all = await (await request("/api/v1/projects?includeArchived=true")).json();
    expect(all.data.map((project: { name: string }) => project.name)).toEqual([
      "Research relaunch",
    ]);
    expect((await request(`/api/v1/projects/${projectId}/board`)).status).toBe(404);

    const restored = await (
      await jsonRequest(`/api/v1/projects/${projectId}/restore`, "POST", {})
    ).json();
    expect(restored.data.archivedAt).toBeNull();
    expect((await request(`/api/v1/projects/${projectId}/board`)).status).toBe(200);
  });

  it("rejects an empty status update before calling the service", async () => {
    const response = await jsonRequest(`/api/v1/statuses/${uuidv7()}`, "PATCH", {});
    expect(response.status).toBe(422);
  });
});

describe("defer and deadline dates (GAP-16)", () => {
  // NOW is 29 August in Europe/Berlin.
  it("carries the dates and order warnings on the task and filters the list by them", async () => {
    const created = await (
      await jsonRequest("/api/v1/tasks", "POST", {
        title: "Deferred",
        deferUntil: "2026-09-10",
        dueDate: "2026-09-03",
        deadline: "2026-09-06",
        deadlineTime: "17:00",
      })
    ).json();
    expect(created.data).toMatchObject({
      deferUntil: "2026-09-10",
      deadline: "2026-09-06",
      deadlineTime: "17:00",
      dateWarnings: ["defer_after_due", "defer_after_deadline"],
    });
    await jsonRequest("/api/v1/tasks", "POST", {
      title: "Plain",
      deadline: "2026-09-02",
    });

    const deferred = await (await request("/api/v1/tasks?deferred=true")).json();
    const live = await (await request("/api/v1/tasks?deferred=false")).json();
    const week = await (await request("/api/v1/tasks?deadline=week")).json();
    expect(deferred.data.map((t: { title: string }) => t.title)).toEqual(["Deferred"]);
    expect(live.data.map((t: { title: string }) => t.title)).toEqual(["Plain"]);
    expect(week.data.map((t: { title: string }) => t.title)).toEqual(["Plain"]);
    expect((await request("/api/v1/tasks?deadline=soon")).status).toBe(422);

    const bad = await jsonRequest("/api/v1/tasks", "POST", {
      title: "x",
      deadlineTime: "17:00",
    });
    expect(bad.status).toBe(422);

    const cleared = await (
      await jsonRequest(`/api/v1/tasks/${created.data.id}`, "PATCH", {
        deadline: null,
        deferUntil: null,
      })
    ).json();
    expect(cleared.data).toMatchObject({
      deadline: null,
      deadlineTime: null,
      deferUntil: null,
      dateWarnings: [],
      version: 2,
    });
  });

  it("keeps a deferred card off the board unless includeDeferred is set", async () => {
    const project = await (
      await jsonRequest("/api/v1/projects", "POST", { name: "Deferral" })
    ).json();
    await jsonRequest("/api/v1/tasks", "POST", {
      title: "Later",
      projectId: project.data.project.id,
      deferUntil: "2026-09-10",
    });
    await jsonRequest("/api/v1/tasks", "POST", {
      title: "Now",
      projectId: project.data.project.id,
      deferUntil: "2026-08-29",
    });

    const base = `/api/v1/projects/${project.data.project.id}/board`;
    const hidden = await (await request(base)).json();
    const shown = await (await request(`${base}?includeDeferred=true`)).json();
    expect(hidden.data.tasks.map((t: { title: string }) => t.title)).toEqual(["Now"]);
    expect(shown.data.tasks.map((t: { title: string }) => t.title).sort()).toEqual([
      "Later",
      "Now",
    ]);
  });
});

describe("search endpoint", () => {
  it("finds tasks by description word with match offsets and lists project hits", async () => {
    await jsonRequest("/api/v1/projects", "POST", { name: "Budget planning" });
    await jsonRequest("/api/v1/tasks", "POST", {
      title: "Slides",
      descriptionMd: "Budget review deck",
    });
    await jsonRequest("/api/v1/tasks", "POST", { title: "Unrelated" });

    const response = await request("/api/v1/search?q=budget");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.tasks).toHaveLength(1);
    expect(body.data.tasks[0].task.title).toBe("Slides");
    expect(body.data.tasks[0].matches.description).toEqual([{ start: 0, end: 6 }]);
    expect(body.data.projects[0].project.name).toBe("Budget planning");
    expect(body.page).toEqual({ nextCursor: null, hasMore: false });
  });

  it("resolves a task key first and honours operators", async () => {
    await jsonRequest("/api/v1/tasks", "POST", { title: "First", priority: "high" });
    await jsonRequest("/api/v1/tasks", "POST", { title: "Second" });

    const byKey = await (await request("/api/v1/search?q=ML-2")).json();
    expect(
      byKey.data.tasks.map((hit: { task: { key: string } }) => hit.task.key),
    ).toEqual(["ML-2"]);

    const byOperator = await (await request("/api/v1/search?q=priority%3Ahigh")).json();
    expect(
      byOperator.data.tasks.map((hit: { task: { title: string } }) => hit.task.title),
    ).toEqual(["First"]);
  });

  it("rejects an empty query and an unknown operator value with the envelope", async () => {
    expect((await request("/api/v1/search?q=")).status).toBe(422);

    const response = await request("/api/v1/search?q=due%3Asomeday");
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details.operator).toBe("due");
  });
});

describe("saved view endpoints", () => {
  it("saves, lists, renames, reorders, and deletes personal views", async () => {
    const created = await jsonRequest("/api/v1/views/saved", "POST", {
      name: "Overdue",
      filters: { due: "overdue" },
    });
    expect(created.status).toBe(201);
    const first = (await created.json()).data;
    expect(first).toMatchObject({
      name: "Overdue",
      layout: "list",
      filters: { due: "overdue" },
    });

    const second = (
      await (
        await jsonRequest("/api/v1/views/saved", "POST", {
          name: "Blocked",
          layout: "board",
        })
      ).json()
    ).data;

    const duplicate = await jsonRequest("/api/v1/views/saved", "POST", {
      name: "overdue",
    });
    expect(duplicate.status).toBe(409);

    const renamed = await jsonRequest(`/api/v1/views/saved/${first.id}`, "PATCH", {
      name: "Overdue work",
    });
    expect((await renamed.json()).data.name).toBe("Overdue work");

    const reordered = await jsonRequest(
      `/api/v1/views/saved/${second.id}/reorder`,
      "POST",
      {
        afterViewId: first.id,
      },
    );
    expect(reordered.status).toBe(200);

    const listed = await (await request("/api/v1/views/saved")).json();
    expect(listed.data.map((view: { name: string }) => view.name)).toEqual([
      "Blocked",
      "Overdue work",
    ]);

    expect(
      (await request(`/api/v1/views/saved/${first.id}`, { method: "DELETE" })).status,
    ).toBe(204);
    expect(
      (await request(`/api/v1/views/saved/${first.id}`, { method: "DELETE" })).status,
    ).toBe(404);
  });

  it("rejects unknown filter fields", async () => {
    const response = await jsonRequest("/api/v1/views/saved", "POST", {
      name: "Bad",
      filters: { q: "text" },
    });
    expect(response.status).toBe(422);
  });
});

describe("notifications", () => {
  async function timedTask() {
    const created = await jsonRequest("/api/v1/tasks", "POST", {
      title: "Call the bank",
      dueDate: "2026-08-29",
      dueTime: "12:00",
      dueTimezone: "UTC",
      reminderOffsetMinutes: 15,
    });
    expect(created.status).toBe(201);
    return (await created.json()).data;
  }

  it("carries the reminder offset on the task and validates it", async () => {
    const task = await timedTask();
    expect(task.reminderOffsetMinutes).toBe(15);
    expect(unitOfWork.data.reminders.get(task.id)?.remindAt).toEqual(
      new Date("2026-08-29T11:45:00.000Z"),
    );

    const cleared = await jsonRequest(`/api/v1/tasks/${task.id}`, "PATCH", {
      reminderOffsetMinutes: null,
    });
    expect((await cleared.json()).data.reminderOffsetMinutes).toBeNull();
    expect(unitOfWork.data.reminders.has(task.id)).toBe(false);

    const invalid = await jsonRequest(`/api/v1/tasks/${task.id}`, "PATCH", {
      reminderOffsetMinutes: 99_999,
    });
    expect(invalid.status).toBe(422);
  });

  it("lists, reads, and snoozes the caller's notifications", async () => {
    const task = await timedTask();
    // Deliver as the worker would.
    const delivered = await deps.notificationService.deliverDue(
      new Date("2026-08-29T11:45:00.000Z"),
    );
    expect(delivered).toBe(1);

    const listed = await request("/api/v1/notifications?unread=true");
    expect(listed.status).toBe(200);
    const body = await listed.json();
    expect(body.unreadCount).toBe(1);
    expect(body.data[0]).toMatchObject({
      kind: "reminder",
      taskId: task.id,
      title: "Reminder: Call the bank",
      readAt: null,
    });

    const snoozed = await jsonRequest(
      `/api/v1/notifications/${body.data[0].id}/snooze`,
      "POST",
    );
    expect(snoozed.status).toBe(200);
    expect((await snoozed.json()).data.readAt).not.toBeNull();
    expect(unitOfWork.data.reminders.get(task.id)?.remindAt).toEqual(
      new Date("2026-08-29T10:00:00.000Z"),
    );

    const read = await jsonRequest(
      `/api/v1/notifications/${body.data[0].id}/read`,
      "POST",
    );
    expect(read.status).toBe(200);
    const missing = await jsonRequest(`/api/v1/notifications/${uuidv7()}/read`, "POST");
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("NOTIFICATION_NOT_FOUND");
  });

  it("reads and updates preferences and requires a signed-in user", async () => {
    const defaults = await request("/api/v1/me/notification-preferences");
    expect(defaults.status).toBe(200);
    expect((await defaults.json()).data).toMatchObject({
      channels: { inApp: true, email: false, push: false },
      digestTime: null,
      defaultOffsetMinutes: 30,
    });

    const updated = await jsonRequest("/api/v1/me/notification-preferences", "PATCH", {
      digestTime: "08:00",
      channels: { email: true },
    });
    expect(updated.status).toBe(200);
    expect((await updated.json()).data).toMatchObject({
      digestTime: "08:00",
      channels: { inApp: true, email: true, push: false },
    });

    const empty = await jsonRequest("/api/v1/me/notification-preferences", "PATCH", {});
    expect(empty.status).toBe(422);

    currentUser = null;
    expect((await request("/api/v1/notifications")).status).toBe(401);
    expect((await request("/api/v1/me/notification-preferences")).status).toBe(401);
  });

  it("registers and removes a push subscription", async () => {
    const added = await jsonRequest("/api/v1/me/push-subscriptions", "POST", {
      endpoint: "https://push.example/abc",
      keys: { p256dh: "p", auth: "a" },
    });
    expect(added.status).toBe(201);
    expect((await added.json()).data).toEqual({
      endpoint: "https://push.example/abc",
      createdAt: NOW.toISOString(),
    });

    const rejected = await jsonRequest("/api/v1/me/push-subscriptions", "POST", {
      endpoint: "not a url",
      keys: { p256dh: "p", auth: "a" },
    });
    expect(rejected.status).toBe(422);

    const removed = await request(
      "/api/v1/me/push-subscriptions?endpoint=https%3A%2F%2Fpush.example%2Fabc",
      { method: "DELETE" },
    );
    expect(removed.status).toBe(204);
    expect(unitOfWork.data.pushSubscriptions.size).toBe(0);
    expect(
      (await request("/api/v1/me/push-subscriptions", { method: "DELETE" })).status,
    ).toBe(422);
  });
});
