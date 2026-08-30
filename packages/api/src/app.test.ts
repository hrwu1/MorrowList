import { ProjectService, TaskService, bootstrapUser } from "@morrowlist/application";
import type { AuthPort, AuthenticatedUser } from "@morrowlist/auth";
import { fixedClock, uuidv7 } from "@morrowlist/domain";
import { silentLogger } from "@morrowlist/observability";
import {
  createInMemoryUnitOfWork,
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

  const deps: ApiDependencies = {
    auth,
    unitOfWork,
    projectService: new ProjectService({ unitOfWork, clock: fixedClock(NOW) }),
    taskService: new TaskService({
      unitOfWork,
      clock: fixedClock(NOW),
      cursorSecret: "test-secret",
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
    expect(body.data.defaultWorkspaceId).toBe(body.data.workspaces[0].id);
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
