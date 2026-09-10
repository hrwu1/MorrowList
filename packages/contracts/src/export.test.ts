import { describe, expect, it } from "vitest";

import {
  EXPORT_ARRAY_SECTIONS,
  EXPORT_FORMAT,
  EXPORT_SCHEMA_VERSION,
  exportTasksCsvQuerySchema,
  exportWorkspaceQuerySchema,
  importQuerySchema,
  importRequestSchema,
  workspaceExportSchema,
} from "./export.js";

const UUID = "01a04e0f-0000-7000-8000-000000000001";

function archive(overrides: Record<string, unknown> = {}) {
  return {
    format: EXPORT_FORMAT,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: "2026-09-05T09:00:00.000Z",
    workspace: {
      id: UUID,
      name: "Alex's Workspace",
      slug: "alex",
      taskKeyPrefix: "ML",
      timezone: "Europe/Berlin",
      inProgressLimit: null,
      createdByUserId: UUID,
      createdAt: "2026-09-01T09:00:00.000Z",
      updatedAt: "2026-09-01T09:00:00.000Z",
    },
    projects: [],
    statuses: [],
    tasks: [],
    fields: [],
    tags: [],
    taskTags: [],
    relations: [],
    dayPlans: [],
    savedViews: [],
    activity: [],
    ...overrides,
  };
}

describe("workspaceExportSchema", () => {
  it("accepts an archive with every section present and empty", () => {
    expect(workspaceExportSchema.safeParse(archive()).success).toBe(true);
  });

  it("names every array section exactly once, in the order the archive writes them", () => {
    const shape = Object.keys(workspaceExportSchema.shape);

    expect([...EXPORT_ARRAY_SECTIONS]).toEqual(
      shape.filter((key) => (EXPORT_ARRAY_SECTIONS as readonly string[]).includes(key)),
    );
    expect(new Set(EXPORT_ARRAY_SECTIONS).size).toBe(EXPORT_ARRAY_SECTIONS.length);
  });

  it("rejects a foreign format or a future schema version", () => {
    expect(workspaceExportSchema.safeParse(archive({ format: "trello" })).success).toBe(
      false,
    );
    expect(workspaceExportSchema.safeParse(archive({ schemaVersion: 2 })).success).toBe(
      false,
    );
  });

  it("rejects an archive missing a section, so a truncated download cannot pass", () => {
    const { tasks: _tasks, ...withoutTasks } = archive();
    expect(workspaceExportSchema.safeParse(withoutTasks).success).toBe(false);
  });

  it("declares exactly the sections of spec 30.2, and no others", () => {
    // A new section is a deliberate change to the published format, so it is listed
    // here as well as in the schema. Auth-provider data has no section by construction.
    expect(Object.keys(workspaceExportSchema.shape)).toEqual([
      "format",
      "schemaVersion",
      "exportedAt",
      "workspace",
      ...EXPORT_ARRAY_SECTIONS,
    ]);
  });
});

describe("export and import queries", () => {
  it("defaults the archive to the full history and the import to a real run", () => {
    expect(exportWorkspaceQuerySchema.parse({})).toEqual({ activity: "all" });
    expect(importQuerySchema.parse({})).toEqual({ dryRun: false });
    expect(importQuerySchema.parse({ dryRun: "true" })).toEqual({ dryRun: true });
  });

  it("takes the task list filters for the CSV, without paging", () => {
    const query = exportTasksCsvQuerySchema.parse({ priority: "high", due: "overdue" });

    expect(query).toMatchObject({ priority: "high", due: "overdue", sort: "rank" });
    expect(query).not.toHaveProperty("cursor");
    expect(query).not.toHaveProperty("limit");
  });

  it("requires import content and caps it", () => {
    expect(importRequestSchema.safeParse({ content: "" }).success).toBe(false);
    expect(importRequestSchema.parse({ content: "title\nWrite" })).toEqual({
      content: "title\nWrite",
    });
  });
});
