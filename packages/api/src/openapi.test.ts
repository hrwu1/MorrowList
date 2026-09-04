import { describe, expect, it } from "vitest";

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
