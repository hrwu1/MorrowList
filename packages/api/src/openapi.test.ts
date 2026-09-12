import { describe, expect, it } from "vitest";

import { createApiApp } from "./app.js";
import type { ApiDependencies } from "./context.js";
import { buildOpenApiDocument } from "./openapi.js";

describe("board OpenAPI surface", () => {
  it("publishes projects, the normalized board, and server-ranked movement", () => {
    const document = buildOpenApiDocument() as {
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown> };
    };

    expect(document.paths["/projects"]).toHaveProperty("get");
    expect(document.paths["/projects"]).toHaveProperty("post");
    expect(document.paths["/projects/{projectId}"]).toHaveProperty("get");
    expect(document.paths["/projects/{projectId}/board"]).toHaveProperty("get");
    expect(document.paths["/tasks/{id}/move"]).toHaveProperty("post");
    expect(document.paths["/tasks/{id}/reorder"]).toHaveProperty("post");
    expect(document.paths["/tasks/{id}/parent"]).toHaveProperty("post");
    expect(document.paths["/tasks/{id}/parent"]).toHaveProperty("delete");
    expect(document.components.schemas).toHaveProperty("SetTaskParentRequest");
    expect(document.components.schemas).toHaveProperty("ProjectBoard");
    expect(document.components.schemas).toHaveProperty("MoveTaskRequest");
  });

  it("publishes the read-only flow metrics for a project", () => {
    const document = buildOpenApiDocument() as {
      paths: Record<string, Record<string, { parameters: { name: string }[] }>>;
      components: { schemas: Record<string, unknown> };
    };

    const flow = document.paths["/projects/{projectId}/flow"]?.get;
    expect(flow).toBeDefined();
    expect(flow?.parameters.map((parameter) => parameter.name)).toContain("range");
    expect(document.components.schemas).toHaveProperty("ProjectFlow");
  });

  it("publishes the read-only activity history for tasks and projects", () => {
    const document = buildOpenApiDocument() as {
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown> };
    };

    expect(document.paths["/tasks/{idOrKey}/activity"]).toHaveProperty("get");
    expect(document.paths["/projects/{projectId}/activity"]).toHaveProperty("get");
    expect(document.components.schemas).toHaveProperty("ActivityList");
  });

  it("publishes My Day and the Today and Upcoming views", () => {
    const document = buildOpenApiDocument() as {
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown> };
    };

    expect(document.paths["/tasks/{id}/today"]).toHaveProperty("post");
    expect(document.paths["/tasks/{id}/today/{date}"]).toHaveProperty("delete");
    expect(document.paths["/views/today"]).toHaveProperty("get");
    expect(document.paths["/views/upcoming"]).toHaveProperty("get");
    expect(document.components.schemas).toHaveProperty("TodayView");
    expect(document.components.schemas).toHaveProperty("UpcomingView");
  });

  it("publishes tag management and task tagging", () => {
    const document = buildOpenApiDocument() as {
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown> };
    };

    expect(document.paths["/tags"]).toHaveProperty("get");
    expect(document.paths["/tags"]).toHaveProperty("post");
    expect(document.paths["/tags/{id}"]).toHaveProperty("patch");
    expect(document.paths["/tags/{id}"]).toHaveProperty("delete");
    expect(document.paths["/tasks/{id}/tags/{tagId}"]).toHaveProperty("post");
    expect(document.paths["/tasks/{id}/tags/{tagId}"]).toHaveProperty("delete");
    expect(document.components.schemas).toHaveProperty("TagList");
    expect(document.components.schemas).toHaveProperty("CreateTagRequest");
  });

  it("publishes the workspace limit and the warnings on move and reopen", () => {
    const document = buildOpenApiDocument() as {
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
      components: { schemas: Record<string, unknown> };
    };

    expect(document.paths["/workspaces/{id}"]).toHaveProperty("patch");
    expect(document.components.schemas).toHaveProperty("UpdateWorkspaceRequest");
    expect(document.components.schemas).toHaveProperty("TaskCommandResult");
    expect(document.paths["/tasks/{id}/move"]?.post?.responses["200"]).toMatchObject({
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/TaskCommandResult" },
        },
      },
    });
  });
});

describe("data portability surface (GAP-07)", () => {
  it("publishes the archive, the task CSV, and the importers", () => {
    const document = buildOpenApiDocument() as {
      paths: Record<string, Record<string, { parameters?: { name: string }[] }>>;
      components: { schemas: Record<string, unknown> };
    };

    const archive = document.paths["/exports/workspace.json"]?.get;
    expect(archive).toBeDefined();
    expect(archive?.parameters?.map((parameter) => parameter.name)).toContain(
      "activity",
    );

    const csv = document.paths["/exports/tasks.csv"]?.get;
    expect(csv).toBeDefined();
    // The CSV takes the list filters, without paging.
    const csvParameters = csv?.parameters?.map((parameter) => parameter.name) ?? [];
    expect(csvParameters).toContain("priority");
    expect(csvParameters).not.toContain("cursor");

    expect(document.paths["/imports/{source}"]).toHaveProperty("post");
    expect(document.components.schemas).toHaveProperty("WorkspaceExport");
    expect(document.components.schemas).toHaveProperty("ImportRequest");
    expect(document.components.schemas).toHaveProperty("ImportResult");
  });
});

describe("runtime and wire documentation parity", () => {
  it("documents every registered operation and no absent endpoints", () => {
    const document = buildOpenApiDocument() as {
      paths: Record<string, Record<string, unknown>>;
    };
    const normalize = (path: string) =>
      path
        .replace(/^\/api\/v1/, "")
        .replace(/:[^/]+/g, "{}")
        .replace(/\{[^}]+\}/g, "{}")
        // Hono accepts the full file segment; the handler validates the .ics suffix.
        .replace(/\/feeds\/\{\}\.ics$/, "/feeds/{}");
    const runtime = createApiApp({} as ApiDependencies)
      .routes.filter((route) => route.method !== "ALL")
      .map((route) => `${route.method} ${normalize(route.path)}`);
    const documented = Object.entries(document.paths).flatMap(([path, operations]) =>
      Object.keys(operations)
        .filter((method) => ["get", "post", "put", "patch", "delete"].includes(method))
        .map((method) => `${method.toUpperCase()} ${normalize(path)}`),
    );
    expect(new Set(documented)).toEqual(new Set(runtime));
  });

  it("gives CSV export the same task filter wire parameters, excluding pagination", () => {
    const document = buildOpenApiDocument() as {
      paths: Record<string, { get: { parameters: { name: string }[] } }>;
    };
    const taskParameters = document.paths["/tasks"]!.get.parameters;
    const exportParameters = document.paths["/exports/tasks.csv"]!.get.parameters;
    expect(exportParameters).toEqual(
      taskParameters.filter(({ name }) => name !== "cursor" && name !== "limit"),
    );
    expect(exportParameters.map(({ name }) => name)).toContain("field");
    expect(exportParameters.map(({ name }) => name)).not.toContain("fields");
  });
});
