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
    expect(document.components.schemas).toHaveProperty("ProjectBoard");
    expect(document.components.schemas).toHaveProperty("MoveTaskRequest");
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
});
