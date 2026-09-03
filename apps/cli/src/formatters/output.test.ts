import type { ActivityEntryDto, TaskDto } from "@morrowlist/contracts";
import { describe, expect, it } from "vitest";

import {
  EXIT,
  exitCodeFor,
  formatActivity,
  formatTaskTable,
  formatTodayView,
} from "./output.js";

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
    dayPlans: [],
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

describe("formatActivity", () => {
  it("prints when, who, and what, with readable diffs beneath", () => {
    const entry: ActivityEntryDto = {
      id: "01a04e0f-0000-7000-8000-000000000009",
      workspaceId: "01a04e0f-0000-7000-8000-000000000002",
      aggregateType: "task",
      aggregateId: "01a04e0f-0000-7000-8000-000000000001",
      eventType: "task.updated",
      actorKind: "user",
      actorId: "u1",
      actorDisplayName: "Alex",
      summary: "Updated task fields",
      payload: { secretLooking: "never printed" },
      createdAt: "2026-08-29T09:00:00.000Z",
      changes: [
        { field: "title", from: "Old", to: "New" },
        { field: "dueDate", from: null, to: "2026-09-15" },
      ],
    };

    const output = formatActivity([
      entry,
      { ...entry, actorDisplayName: null, actorKind: "api_key", changes: [] },
    ]);

    expect(output).toBe(
      [
        "2026-08-29T09:00:00.000Z  Alex              Updated task fields",
        '    title: "Old" → "New"',
        '    dueDate: (none) → "2026-09-15"',
        "2026-08-29T09:00:00.000Z  api key           Updated task fields",
      ].join("\n"),
    );
    expect(output).not.toContain("never printed");
    expect(formatActivity([])).toBe("No activity.");
  });
});

describe("formatTodayView", () => {
  it("prints non-empty sections with the extra badges and the review", () => {
    const output = formatTodayView({
      date: "2026-09-03",
      sections: [
        {
          id: "overdue",
          tasks: [
            {
              task: task({ title: "Overdue and chosen", dueDate: "2026-09-01" }),
              reasons: ["overdue", "my_day"],
            },
          ],
        },
        { id: "due_today", tasks: [] },
        {
          id: "my_day",
          tasks: [
            { task: task({ key: "ML-2", title: "Chosen" }), reasons: ["my_day"] },
          ],
        },
      ],
      review: {
        date: "2026-09-02",
        tasks: [task({ key: "ML-3", title: "Left over" })],
      },
    });

    expect(output).toBe(
      [
        "2026-09-03",
        "",
        "Overdue",
        "[ ] ML-1    Overdue and chosen  (due 2026-09-01)  [My Day]",
        "",
        "My Day",
        "[ ] ML-2    Chosen",
        "",
        "Left over from 2026-09-02",
        "[ ] ML-3    Left over",
      ].join("\n"),
    );
  });

  it("says so when the day is empty", () => {
    expect(
      formatTodayView({
        date: "2026-09-03",
        sections: [
          { id: "overdue", tasks: [] },
          { id: "due_today", tasks: [] },
          { id: "my_day", tasks: [] },
        ],
        review: null,
      }),
    ).toBe("Nothing planned for 2026-09-03.");
  });
});
