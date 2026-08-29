import { describe, expect, it } from "vitest";

import {
  createTaskRequestSchema,
  listTasksQuerySchema,
  updateTaskRequestSchema,
} from "./task.js";

describe("createTaskRequestSchema", () => {
  it("accepts a title on its own", () => {
    const parsed = createTaskRequestSchema.parse({ title: "Capture this" });

    expect(parsed.title).toBe("Capture this");
    expect(parsed.projectId).toBeUndefined();
  });

  it("trims the title and rejects a blank one", () => {
    expect(createTaskRequestSchema.parse({ title: "  spaced  " }).title).toBe("spaced");
    expect(createTaskRequestSchema.safeParse({ title: "   " }).success).toBe(false);
  });

  it("rejects a due time without a due date", () => {
    const result = createTaskRequestSchema.safeParse({
      title: "x",
      dueTime: "09:30",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a status without a project", () => {
    const result = createTaskRequestSchema.safeParse({
      title: "x",
      statusId: "0198f0a0-0000-7000-8000-000000000000",
    });

    expect(result.success).toBe(false);
  });
});

describe("updateTaskRequestSchema", () => {
  it("distinguishes an omitted field from an explicit null", () => {
    const omitted = updateTaskRequestSchema.parse({ title: "New" });
    expect("descriptionMd" in omitted).toBe(false);

    const cleared = updateTaskRequestSchema.parse({ descriptionMd: null });
    expect(cleared.descriptionMd).toBeNull();
  });

  it("rejects an empty patch", () => {
    expect(updateTaskRequestSchema.safeParse({}).success).toBe(false);
    expect(updateTaskRequestSchema.safeParse({ expectedVersion: 3 }).success).toBe(
      false,
    );
  });
});

describe("listTasksQuerySchema", () => {
  it("applies pagination and sort defaults", () => {
    const query = listTasksQuerySchema.parse({});

    expect(query.limit).toBe(50);
    expect(query.sort).toBe("rank");
    expect(query.order).toBe("asc");
    expect(query.includeSubtasks).toBe(true);
  });

  it("coerces query-string booleans and numbers", () => {
    const query = listTasksQuerySchema.parse({
      limit: "200",
      isCompleted: "false",
      inbox: "true",
    });

    expect(query.limit).toBe(200);
    expect(query.isCompleted).toBe(false);
    expect(query.inbox).toBe(true);
  });

  it("caps the page size at 200", () => {
    expect(listTasksQuerySchema.safeParse({ limit: "201" }).success).toBe(false);
  });
});
