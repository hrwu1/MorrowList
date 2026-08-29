import type { TaskDto } from "@morrowlist/contracts";
import { describe, expect, it } from "vitest";

import { EXIT, exitCodeFor, formatTaskTable } from "./output.js";

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "01a04e0f-0000-7000-8000-000000000001",
    key: "ML-1",
    workspaceId: "01a04e0f-0000-7000-8000-000000000002",
    taskNumber: 1,
    projectId: null,
    statusId: null,
    title: "Prepare research presentation",
    descriptionMd: null,
    priority: "none",
    dueDate: null,
    dueTime: null,
    dueTimezone: null,
    parentTaskId: null,
    rank: "a0",
    isCompleted: false,
    completedAt: null,
    version: 1,
    createdBy: { kind: "user", id: "u1" },
    lastActor: { kind: "user", id: "u1" },
    createdAt: "2026-08-29T09:00:00.000Z",
    updatedAt: "2026-08-29T09:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("exitCodeFor", () => {
  it("maps error codes to distinct shell exit codes", () => {
    expect(exitCodeFor("AUTH_REQUIRED")).toBe(EXIT.authentication);
    expect(exitCodeFor("TASK_NOT_FOUND")).toBe(EXIT.notFound);
    expect(exitCodeFor("TASK_VERSION_CONFLICT")).toBe(EXIT.conflict);
    expect(exitCodeFor("VALIDATION_FAILED")).toBe(EXIT.validation);
    expect(exitCodeFor("INTERNAL_ERROR")).toBe(EXIT.server);
    expect(exitCodeFor("SOMETHING_NEW")).toBe(EXIT.server);
  });
});

describe("formatTaskTable", () => {
  it("reports an empty list plainly", () => {
    expect(formatTaskTable([])).toBe("No tasks.");
  });

  it("aligns keys of differing width", () => {
    const lines = formatTaskTable([
      task({ key: "ML-1" }),
      task({ key: "ML-1234", title: "Second" }),
    ]).split("\n");

    expect(lines[0]?.indexOf("Prepare")).toBe(lines[1]?.indexOf("Second"));
  });

  it("marks completion and due dates", () => {
    const output = formatTaskTable([
      task({ isCompleted: true, dueDate: "2026-09-01", priority: "urgent" }),
    ]);

    expect(output).toContain("[x]");
    expect(output).toContain("(due 2026-09-01)");
    expect(output).toContain("!");
  });
});
