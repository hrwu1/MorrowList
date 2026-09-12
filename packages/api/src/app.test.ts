import {
  IdempotencyService,
  CalendarFeedService,
  InboundEmailService,
  ActivityService,
  ExportService,
  FieldService,
  FlowService,
  ImportService,
  NotificationService,
  ProjectService,
  SavedViewService,
  SearchService,
  TagService,
  TaskService,
  RuleService,
  ViewService,
  WebhookService,
  WorkflowService,
  WorkspaceService,
  bootstrapUser,
  type WebhookRequest,
  type WebhookSender,
} from "@morrowlist/application";
import type { AuthPort, AuthenticatedUser } from "@morrowlist/auth";
import { fixedClock, parseCsv, uuidv7 } from "@morrowlist/domain";
import { createLogger, silentLogger } from "@morrowlist/observability";
import {
  createInMemoryUnitOfWork,
  createRecordingEmailSender,
  createRecordingPushSender,
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
/** A VAPID public key: 65 base64url bytes, as `GET /me/push-config` publishes it. */
const PUSH_PUBLIC_KEY = Buffer.alloc(65, 4).toString("base64url");

let unitOfWork: InMemoryUnitOfWork;
let app: ReturnType<typeof createApiApp>;
let deps: ApiDependencies;
let currentUser: AuthenticatedUser | null;
let healthy: boolean;
/** A receiver that always accepts, so webhook routes can be exercised without a server. */
let webhookSender: WebhookSender & { sent: WebhookRequest[] };

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

  webhookSender = {
    sent: [],
    async send(request) {
      webhookSender.sent.push(request);
      return { status: 200, error: null };
    },
  };
  const auth: AuthPort = {
    resolveUser: async () => currentUser,
    handleRequest: async () => new Response("not used", { status: 404 }),
  };

  deps = {
    idempotencyService: new IdempotencyService({ unitOfWork }),
    idempotencySecret: "test-only-replay-encryption-secret",
    calendarFeedService: new CalendarFeedService({
      unitOfWork,
      signingSecret: "test-calendar-secret",
      appUrl: "http://localhost",
      clock: fixedClock(NOW),
    }),
    inboundEmailService: new InboundEmailService({
      unitOfWork,
      domain: "inbox.example.com",
      webhookSecret: "test-inbound-secret",
      addressSecret: "test-address-secret",
      clock: fixedClock(NOW),
    }),
    auth,
    unitOfWork,
    pushPublicKey: PUSH_PUBLIC_KEY,
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
    exportService: new ExportService({ unitOfWork, clock: fixedClock(NOW) }),
    importService: new ImportService({ unitOfWork, clock: fixedClock(NOW) }),
    viewService: new ViewService({ unitOfWork, clock: fixedClock(NOW) }),
    tagService: new TagService({ unitOfWork, clock: fixedClock(NOW) }),
    fieldService: new FieldService({ unitOfWork, clock: fixedClock(NOW) }),
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
      pushSender: createRecordingPushSender(),
      userDirectory: { findById: async () => currentUser },
      appUrl: "http://localhost:3200",
    }),
    ruleService: new RuleService({ unitOfWork, clock: fixedClock(NOW) }),
    webhookService: new WebhookService({
      unitOfWork,
      clock: fixedClock(NOW),
      cursorSecret: "test-secret",
      sender: webhookSender,
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
      key: "ML-000001",
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

    const response = await request("/api/v1/tasks/ML-000001");

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
      ["ML-000001", "2026-09-05"],
      ["ML-000002", "2026-09-12"],
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
      task: { key: "ML-000002", title: "Make slides" },
    });

    const blocked = await (await request(`/api/v1/tasks?isBlocked=true`)).json();
    expect(blocked.data.map((t: { key: string }) => t.key)).toEqual(["ML-000002"]);

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

describe("bulk task endpoint (GAP-08)", () => {
  async function create(title: string) {
    return (await jsonRequest("/api/v1/tasks", "POST", { title })).json();
  }

  it("applies every operation and answers in request order", async () => {
    const first = await create("First");
    const second = await create("Second");

    const response = await jsonRequest("/api/v1/tasks/batch", "POST", {
      operations: [
        { op: "complete", taskId: first.data.id },
        { op: "setPriority", taskId: second.data.id, priority: "urgent" },
      ],
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({ op: "complete", taskId: first.data.id });
    expect(body.data[0].data.isCompleted).toBe(true);
    expect(body.data[1].data.priority).toBe("urgent");
    expect(body.warnings).toEqual([]);
  });

  it("rolls back and reports the failing entry with 409", async () => {
    const first = await create("First");
    const second = await create("Second");

    const response = await jsonRequest("/api/v1/tasks/batch", "POST", {
      operations: [
        { op: "complete", taskId: first.data.id },
        { op: "complete", taskId: second.data.id, expectedVersion: 99 },
      ],
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("TASK_VERSION_CONFLICT");
    expect(body.error.details).toMatchObject({
      operationIndex: 1,
      operation: "complete",
    });

    const untouched = await (await request(`/api/v1/tasks/${first.data.id}`)).json();
    expect(untouched.data.isCompleted).toBe(false);
  });

  it("rejects an empty batch and one past the 200-operation limit", async () => {
    const first = await create("First");
    await expect(
      (await jsonRequest("/api/v1/tasks/batch", "POST", { operations: [] })).status,
    ).toBe(422);

    const tooMany = Array.from({ length: 201 }, () => ({
      op: "complete",
      taskId: first.data.id,
    }));
    await expect(
      (await jsonRequest("/api/v1/tasks/batch", "POST", { operations: tooMany }))
        .status,
    ).toBe(422);
  });

  it("does not read `batch` as a task key", async () => {
    // The POST route is registered ahead of GET /tasks/{idOrKey}; the GET must still 404.
    expect((await request("/api/v1/tasks/batch")).status).toBe(404);
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

    const response = await request("/api/v1/tasks/ML-000001/activity?limit=1");

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
      `/api/v1/tasks/ML-000001/activity?cursor=${encodeURIComponent(body.page.nextCursor)}`,
    );
    const restBody = await rest.json();
    expect(
      restBody.data.map((entry: { eventType: string }) => entry.eventType),
    ).toEqual(["task.created"]);
    expect(restBody.page).toEqual({ hasMore: false, nextCursor: null });
  });

  it("rejects a tampered cursor and reports an unknown task", async () => {
    const forged = await request("/api/v1/tasks/ML-000001/activity?cursor=abc.def");
    expect(forged.status).toBe(404);

    await jsonRequest("/api/v1/tasks", "POST", { title: "Exists" });
    const tampered = await request("/api/v1/tasks/ML-000001/activity?cursor=abc.def");
    expect(tampered.status).toBe(422);
    await expect(tampered.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_FAILED" },
    });

    const missing = await request("/api/v1/tasks/ML-000009/activity");
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

    const byKey = await (await request("/api/v1/search?q=ML-000002")).json();
    expect(
      byKey.data.tasks.map((hit: { task: { key: string } }) => hit.task.key),
    ).toEqual(["ML-000002"]);

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

  it("publishes the push key when configured, and reports push off when it is not", async () => {
    const configured = await request("/api/v1/me/push-config");
    expect(configured.status).toBe(200);
    expect((await configured.json()).data).toEqual({
      enabled: true,
      publicKey: PUSH_PUBLIC_KEY,
    });

    // A deployment with no VAPID pair says so rather than handing out a key that
    // would produce registrations nothing can ever deliver to.
    const withoutKeys = createApiApp({ ...deps, pushPublicKey: null });
    const off = await withoutKeys.request("/api/v1/me/push-config", {
      headers: { cookie: "session=test" },
    });
    expect(await off.json()).toEqual({ data: { enabled: false, publicKey: null } });

    currentUser = null;
    expect((await request("/api/v1/me/push-config")).status).toBe(401);
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

describe("webhook routes", () => {
  async function createEndpoint(url = "https://receiver.example/hook") {
    const response = await jsonRequest("/api/v1/webhooks", "POST", {
      url,
      eventTypes: ["task.*"],
    });
    expect(response.status).toBe(201);
    return (await response.json()).data;
  }

  it("returns the secret on create and never again", async () => {
    const created = await createEndpoint();
    expect(created.secret.startsWith("whsec_")).toBe(true);

    const listed = await request("/api/v1/webhooks");
    expect(listed.status).toBe(200);
    const body = await listed.text();
    expect(body).toContain(created.secretPrefix);
    expect(body).not.toContain(created.secret.slice(14));
  });

  it("validates the URL and the event types", async () => {
    const badUrl = await jsonRequest("/api/v1/webhooks", "POST", {
      url: "not a url",
    });
    expect(badUrl.status).toBe(422);

    const badType = await jsonRequest("/api/v1/webhooks", "POST", {
      url: "https://receiver.example/hook",
      eventTypes: ["Task Created"],
    });
    expect(badType.status).toBe(422);
  });

  it("updates, tests, logs and deletes an endpoint", async () => {
    const created = await createEndpoint();

    const patched = await jsonRequest(`/api/v1/webhooks/${created.id}`, "PATCH", {
      active: false,
      description: "Staging receiver",
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).data).toMatchObject({
      active: false,
      description: "Staging receiver",
    });

    const tested = await jsonRequest(`/api/v1/webhooks/${created.id}/test`, "POST");
    expect(tested.status).toBe(200);
    expect((await tested.json()).data).toMatchObject({
      eventType: "webhook.test",
      status: "delivered",
      responseCode: 200,
    });
    expect(webhookSender.sent).toHaveLength(1);

    const log = await request(`/api/v1/webhooks/${created.id}/deliveries`);
    expect(log.status).toBe(200);
    expect((await log.json()).data).toHaveLength(1);

    const removed = await request(`/api/v1/webhooks/${created.id}`, {
      method: "DELETE",
    });
    expect(removed.status).toBe(204);
    expect((await request(`/api/v1/webhooks/${created.id}/deliveries`)).status).toBe(
      404,
    );
  });

  it("reports an unknown endpoint and an unknown delivery as 404", async () => {
    const missing = uuidv7();
    expect((await jsonRequest(`/api/v1/webhooks/${missing}/test`, "POST")).status).toBe(
      404,
    );

    const created = await createEndpoint();
    const retry = await jsonRequest(
      `/api/v1/webhooks/${created.id}/deliveries/${missing}/retry`,
      "POST",
    );
    expect(retry.status).toBe(404);
    expect((await retry.json()).error.code).toBe("WEBHOOK_DELIVERY_NOT_FOUND");
  });

  it("requires authentication like every other resource route", async () => {
    currentUser = null;
    expect((await request("/api/v1/webhooks")).status).toBe(401);
  });
});

describe("export and import endpoints (GAP-07)", () => {
  const trelloBoard = JSON.stringify({
    name: "Product Roadmap",
    lists: [
      { id: "l1", name: "Backlog", pos: 1 },
      { id: "l2", name: "Done", pos: 2 },
    ],
    labels: [{ id: "lb1", name: "research", color: "green" }],
    cards: [
      {
        id: "c1",
        name: "Interview users",
        desc: "",
        idList: "l1",
        idLabels: ["lb1"],
        due: "2026-09-14T12:00:00.000Z",
        closed: false,
      },
    ],
    checklists: [
      {
        id: "ch1",
        idCard: "c1",
        pos: 1,
        checkItems: [{ id: "ci1", name: "Write the screener", state: "complete" }],
      },
    ],
  });

  it("streams the archive as a downloadable file", async () => {
    await jsonRequest("/api/v1/tasks", "POST", { title: "Draft the brief" });

    const response = await request("/api/v1/exports/workspace.json");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="morrowlist-.+\.json"$/,
    );
    const archive = JSON.parse(await response.text());
    expect(archive.format).toBe("morrowlist-export");
    expect(archive.schemaVersion).toBe(1);
    expect(archive.tasks.map((task: { title: string }) => task.title)).toEqual([
      "Draft the brief",
    ]);
    // The sections are written in the documented order, even when streamed.
    expect(Object.keys(archive).slice(4)).toEqual([
      "projects",
      "statuses",
      "tasks",
      "fields",
      "tags",
      "taskTags",
      "relations",
      "dayPlans",
      "savedViews",
      "activity",
    ]);
  });

  it("drops history from the archive on request and rejects an unknown scope", async () => {
    await jsonRequest("/api/v1/tasks", "POST", { title: "Draft the brief" });

    const none = await request("/api/v1/exports/workspace.json?activity=none");
    expect(JSON.parse(await none.text()).activity).toEqual([]);

    const bad = await request("/api/v1/exports/workspace.json?activity=everything");
    expect(bad.status).toBe(422);
  });

  it("answers the task CSV as a downloadable file, honouring the list filters", async () => {
    await jsonRequest("/api/v1/tasks", "POST", { title: "Draft the brief" });
    await jsonRequest("/api/v1/tasks", "POST", { title: "Something urgent" });

    const response = await request("/api/v1/exports/tasks.csv");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toMatch(/\.csv"$/);
    const body = await response.text();
    expect(body.split("\r\n")[0]).toBe(
      "key,title,description,status,priority,dueDate,deadline,deferUntil,tags,parentKey,completed",
    );
    expect(body).toContain("Draft the brief");

    const filtered = await request("/api/v1/exports/tasks.csv?priority=urgent");
    expect(await filtered.text()).not.toContain("Draft the brief");
  });

  it("uses the same custom-field selection for task lists and CSV downloads", async () => {
    const defined = await jsonRequest("/api/v1/fields", "POST", {
      name: "Effort",
      key: "effort",
      type: "number",
    });
    expect(defined.status).toBe(201);
    for (const [title, effort] of [
      ["Small", 1],
      ["Large", 5],
    ] as const) {
      expect(
        (
          await jsonRequest("/api/v1/tasks", "POST", {
            title,
            fields: { effort },
          })
        ).status,
      ).toBe(201);
    }
    const query = "field.effort=gt:3";
    const listed = await (await request(`/api/v1/tasks?${query}`)).json();
    const exported = await request(`/api/v1/exports/tasks.csv?${query}`);
    expect(exported.status).toBe(200);
    const [columns, ...rows] = parseCsv(await exported.text());
    expect(rows.map((row) => row[columns!.indexOf("title")])).toEqual(
      listed.data.map((task: { title: string }) => task.title),
    );
    expect(listed.data.map((task: { title: string }) => task.title)).toEqual(["Large"]);
  });

  it.each(["/tasks", "/exports/tasks.csv"])(
    "rejects malformed and excessive custom-field filters on %s",
    async (path) => {
      for (const query of [
        "field.effort=unsupported:3",
        "field.a=empty&field.b=empty&field.c=empty&field.d=empty&field.e=empty",
      ]) {
        const response = await request(`/api/v1${path}?${query}`);
        expect(response.status).toBe(422);
        expect((await response.json()).error.code).toBe("VALIDATION_FAILED");
      }
    },
  );

  it("previews a Trello import without writing, then applies it", async () => {
    const preview = await jsonRequest("/api/v1/imports/trello?dryRun=true", "POST", {
      content: trelloBoard,
    });

    expect(preview.status).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody.data.dryRun).toBe(true);
    expect(previewBody.data.projectId).toBeNull();
    expect(previewBody.data.preview.counts).toMatchObject({ tasks: 1, subtasks: 1 });
    expect(unitOfWork.data.tasks.size).toBe(0);

    const applied = await jsonRequest("/api/v1/imports/trello", "POST", {
      content: trelloBoard,
      projectName: "Roadmap",
    });

    expect(applied.status).toBe(201);
    const appliedBody = await applied.json();
    expect(appliedBody.data.projectId).not.toBeNull();
    expect(appliedBody.data.preview.projectName).toBe("Roadmap");
    expect(unitOfWork.data.tasks.size).toBe(2);
  });

  it("reports an unreadable file as a validation failure and an unknown source as 404", async () => {
    const broken = await jsonRequest("/api/v1/imports/trello", "POST", {
      content: "not json at all",
    });
    expect(broken.status).toBe(422);
    expect((await broken.json()).error.code).toBe("VALIDATION_FAILED");

    const unknown = await jsonRequest("/api/v1/imports/asana", "POST", {
      content: "{}",
    });
    expect(unknown.status).toBe(404);

    const empty = await jsonRequest("/api/v1/imports/csv", "POST", { content: "" });
    expect(empty.status).toBe(422);
  });

  it("allows an import body far larger than an ordinary request", async () => {
    const oversizedTask = await request("/api/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "2000000" },
      body: JSON.stringify({ title: "Too big" }),
    });
    expect(oversizedTask.status).toBe(422);

    const importedBody = await request("/api/v1/imports/csv", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "2000000" },
      body: JSON.stringify({ content: "title\nFrom a big file" }),
    });
    expect(importedBody.status).toBe(201);
  });
});

describe("Calendar API", () => {
  it("validates ranges and protects token management while allowing signed feed subscriptions", async () => {
    expect(
      (await request("/api/v1/views/calendar?from=2026-09-30&to=2026-09-01")).status,
    ).toBe(422);
    expect(
      (await request("/api/v1/views/calendar?from=2026-09-01&to=2026-09-30")).status,
    ).toBe(200);
    const created = await request("/api/v1/me/calendar-feed", { method: "POST" });
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("no-store");
    const { data } = (await created.json()) as { data: { url: string } };
    const user = currentUser;
    currentUser = null;
    expect((await request("/api/v1/me/calendar-feed", { method: "POST" })).status).toBe(
      401,
    );
    const feed = await request(new URL(data.url).pathname);
    expect(feed.status).toBe(200);
    expect(feed.headers.get("content-type")).toContain("text/calendar");
    expect(feed.headers.get("cache-control")).toContain("must-revalidate");
    currentUser = user;
    expect(
      (await request("/api/v1/me/calendar-feed", { method: "DELETE" })).status,
    ).toBe(204);
    expect((await request(new URL(data.url).pathname)).status).toBe(404);
    expect((await request("/api/v1/feeds/fake.ics")).status).toBe(404);
  });
  it("bounds unauthenticated feed request traffic", async () => {
    for (let i = 0; i < 120; i++) await request("/api/v1/feeds/invalid.ics");
    const limited = await request("/api/v1/feeds/invalid.ics");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });
});

it("never writes a feed bearer URL into application access logs", async () => {
  const lines: string[] = [];
  const logged = createApiApp({
    ...deps,
    logger: createLogger({ write: (line) => lines.push(line) }),
  });
  await logged.request("http://localhost/api/v1/feeds/private-bearer-example.ics");
  expect(lines.join("\n")).not.toContain("private-bearer-example");
  expect(lines.join("\n")).toContain("/api/v1/feeds/[redacted]");
});
describe("inbound capture endpoints", () => {
  it("requires authentication before parsing and keeps address responses private", async () => {
    const missing = await jsonRequest("/api/v1/inbound/email", "POST", {});
    expect(missing.status).toBe(403);
    const address = await jsonRequest("/api/v1/capture/address/rotate", "POST");
    expect(address.status).toBe(200);
    expect(address.headers.get("cache-control")).toBe("private, no-store");
    const body = await address.json();
    const envelope = {
      messageId: "route-1",
      recipient: body.data.address,
      subject: "Route capture tomorrow",
      text: "Notes",
    };
    const send = () =>
      request("/api/v1/inbound/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-inbound-secret",
        },
        body: JSON.stringify(envelope),
      });
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(200);
    expect(unitOfWork.data.tasks.size).toBe(1);
    await jsonRequest("/api/v1/capture/address/rotate", "POST");
    expect((await send()).status).toBe(403);
    currentUser = null;
    expect((await request("/api/v1/capture/address")).status).toBe(401);
  });
  it("rejects oversized inbound bodies and malformed authenticated provider shapes", async () => {
    const oversized = await request("/api/v1/inbound/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-inbound-secret",
      },
      body: JSON.stringify({ text: "x".repeat(1_000_001) }),
    });
    expect(oversized.status).toBe(422);
    const malformed = await request("/api/v1/inbound/email?provider=ses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-inbound-secret",
      },
      body: JSON.stringify({ Message: "unverified SNS" }),
    });
    expect(malformed.status).toBe(422);
  });
});

describe("automation rule routes", () => {
  it("validates typed rules and supports create/update/test/run/delete", async () => {
    const createdResponse = await jsonRequest("/api/v1/rules", "POST", {
      name: "Urgency",
      trigger: { type: "task.created" },
      conditions: [{ type: "priority_is", priority: "none" }],
      actions: [{ type: "set_priority", priority: "urgent" }],
      enabled: false,
    });
    expect(createdResponse.status).toBe(201);
    const { data: rule } = await createdResponse.json();
    const changed = await jsonRequest(`/api/v1/rules/${rule.id}`, "PATCH", {
      name: "Renamed",
    });
    expect((await changed.json()).data).toMatchObject({
      enabled: false,
      conditions: [{ type: "priority_is", priority: "none" }],
    });
    expect((await request("/api/v1/rules")).status).toBe(200);
    expect((await request(`/api/v1/rules/${rule.id}/runs`)).status).toBe(200);
    const taskResponse = await jsonRequest("/api/v1/tasks", "POST", {
      title: "Preview",
    });
    const { data: task } = await taskResponse.json();
    expect(
      (await jsonRequest(`/api/v1/rules/${rule.id}/test`, "POST", { taskId: task.id }))
        .status,
    ).toBe(200);
    expect(
      (
        await jsonRequest("/api/v1/rules", "POST", {
          name: "Unsafe",
          trigger: { type: "task.created" },
          actions: [{ type: "execute", script: "x" }],
        })
      ).status,
    ).toBe(422);
    expect(
      (await request(`/api/v1/rules/${rule.id}`, { method: "DELETE" })).status,
    ).toBe(204);
    expect((await request(`/api/v1/rules/${rule.id}/runs`)).status).toBe(404);
  });
});

describe("transactional mutation replay", () => {
  const create = (key: string, title = "Replay once") =>
    request("/api/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify({ title }),
    });

  it("replays concurrent identical requests without repeating data or audit effects", async () => {
    const initialEvents = unitOfWork.data.outbox.length;
    const [first, second] = await Promise.all([create("same-key"), create("same-key")]);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(await second.json()).toEqual(await first.json());
    expect(unitOfWork.data.tasks.size).toBe(1);
    expect(unitOfWork.data.outbox).toHaveLength(initialEvents + 1);
    expect(first.headers.get("x-request-id")).not.toBe(
      second.headers.get("x-request-id"),
    );
    expect(unitOfWork.data.idempotency.size).toBe(1);
    expect([...unitOfWork.data.idempotency.values()][0]?.response).not.toContain(
      "Replay once",
    );
  });

  it("rejects a changed body under the same actor, operation and key", async () => {
    expect((await create("same-key")).status).toBe(201);
    const conflict = await create("same-key", "Different task");
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(unitOfWork.data.tasks.size).toBe(1);
  });

  it("does not replay across actor or workspace access boundaries", async () => {
    await create("same-key");
    const userId = uuidv7();
    await bootstrapUser(
      { unitOfWork },
      { userId, email: "other@example.com", displayName: "Other", timezone: "UTC" },
    );
    currentUser = { id: userId, email: "other@example.com", name: "Other" };
    expect((await create("same-key")).status).toBe(201);
    expect(unitOfWork.data.tasks.size).toBe(2);
    const workspaceId = unitOfWork.data.memberships.find(
      (membership) => membership.userId === userId,
    )!.workspaceId;
    unitOfWork.data.memberships = [];
    const forbidden = await request(`/api/v1/tasks?workspaceId=${workspaceId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "same-key" },
      body: JSON.stringify({ title: "Replay once" }),
    });
    expect(forbidden.status).toBe(404);
  });

  it("rolls back command, audit and replay record together on commit failure", async () => {
    const initialEvents = unitOfWork.data.outbox.length;
    const original = deps.taskService.create.bind(deps.taskService);
    deps.taskService.create = async (...args) => {
      const result = await original(...args);
      unitOfWork.failNextCommit();
      return result;
    };
    expect((await create("retry-key")).status).toBe(500);
    expect(unitOfWork.data.tasks.size).toBe(0);
    expect(unitOfWork.data.outbox).toHaveLength(initialEvents);
    expect(unitOfWork.data.idempotency.size).toBe(0);
    deps.taskService.create = original;
    expect((await create("retry-key")).status).toBe(201);
    expect(unitOfWork.data.tasks.size).toBe(1);
  });

  it("does not persist mapped validation failures and permits corrected retry", async () => {
    expect((await create("validation-key", "")).status).toBe(422);
    expect(unitOfWork.data.idempotency.size).toBe(0);
    expect((await create("validation-key", "Corrected")).status).toBe(201);
  });

  it("encrypts one-time webhook credentials while replaying the complete response", async () => {
    const send = () =>
      request("/api/v1/webhooks", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "webhook-key",
        },
        body: JSON.stringify({
          url: "https://example.com/hook",
          eventTypes: ["task.created"],
        }),
      });
    const first = await send();
    expect(first.status).toBe(201);
    const body = await first.json();
    expect(await (await send()).json()).toEqual(body);
    expect(JSON.stringify([...unitOfWork.data.idempotency.values()])).not.toContain(
      body.data.secret,
    );
    expect(unitOfWork.data.webhookSubscriptions.size).toBe(1);
  });
});
