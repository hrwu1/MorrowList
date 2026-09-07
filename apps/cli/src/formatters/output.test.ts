import type {
  ActivityEntryDto,
  FieldDefinitionListItemDto,
  TaskDto,
} from "@morrowlist/contracts";
import { describe, expect, it } from "vitest";

import {
  EXIT,
  exitCodeFor,
  formatActivity,
  formatFlowSummary,
  formatFieldTable,
  formatTagTable,
  formatStatusTable,
  formatTaskDetail,
  formatTaskTable,
  formatTodayView,
} from "./output.js";

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "01a04e0f-0000-7000-8000-000000000001",
    key: "ML-000001",
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
    deferUntil: null,
    deadline: null,
    deadlineTime: null,
    dateWarnings: [],
    reminderOffsetMinutes: null,
    parentTaskId: null,
    recurrence: null,
    seriesId: null,
    fields: {},
    rank: "a0",
    isCompleted: false,
    completedAt: null,
    version: 1,
    tags: [],
    createdBy: { kind: "user", id: "u1" },
    lastActor: { kind: "user", id: "u1" },
    createdAt: "2026-08-29T09:00:00.000Z",
    updatedAt: "2026-08-29T09:00:00.000Z",
    deletedAt: null,
    dayPlans: [],
    subtaskProgress: null,
    relations: [],
    blocked: null,
    isBlocked: false,
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
      task({ key: "ML-000001" }),
      task({ key: "ML-001234", title: "Second" }),
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
            { task: task({ key: "ML-000002", title: "Chosen" }), reasons: ["my_day"] },
          ],
        },
      ],
      review: {
        date: "2026-09-02",
        tasks: [task({ key: "ML-000003", title: "Left over" })],
      },
    });

    expect(output).toBe(
      [
        "2026-09-03",
        "",
        "Overdue",
        "[ ] ML-000001    Overdue and chosen  (due 2026-09-01)  [My Day]",
        "",
        "My Day",
        "[ ] ML-000002    Chosen",
        "",
        "Left over from 2026-09-02",
        "[ ] ML-000003    Left over",
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

describe("formatTaskDetail", () => {
  it("prints subtask progress and the children beneath the task", () => {
    const output = formatTaskDetail(
      task({ subtaskProgress: { completed: 1, total: 2 } }),
      [
        task({ key: "ML-000002", title: "Collect sources", isCompleted: true }),
        task({ key: "ML-000003", title: "Make slides" }),
      ],
    );

    expect(output).toContain("subtasks    1/2 done");
    expect(output).toContain("Subtasks");
    expect(output).toContain("[x] ML-000002  ");
    expect(output).toContain("[ ] ML-000003  ");
  });

  it("prints the blocked flag and relations from the task's point of view", () => {
    const output = formatTaskDetail(
      task({
        isBlocked: true,
        blocked: { reason: "waiting on vendor", since: "2026-09-03T09:00:00.000Z" },
        relations: [
          {
            id: "01a04e0f-0000-7000-8000-000000000010",
            type: "blocks",
            sourceTaskId: "01a04e0f-0000-7000-8000-000000000003",
            targetTaskId: "01a04e0f-0000-7000-8000-000000000001",
            task: {
              id: "01a04e0f-0000-7000-8000-000000000003",
              key: "ML-000003",
              title: "Collect sources",
              isCompleted: false,
            },
            createdAt: "2026-09-03T09:00:00.000Z",
          },
          {
            id: "01a04e0f-0000-7000-8000-000000000011",
            type: "related_to",
            sourceTaskId: "01a04e0f-0000-7000-8000-000000000001",
            targetTaskId: "01a04e0f-0000-7000-8000-000000000004",
            task: {
              id: "01a04e0f-0000-7000-8000-000000000004",
              key: "ML-000004",
              title: "Book venue",
              isCompleted: true,
            },
            createdAt: "2026-09-03T09:00:00.000Z",
          },
        ],
      }),
    );

    expect(output).toContain(
      "  blocked     waiting on vendor (since 2026-09-03T09:00:00.000Z)",
    );
    expect(output).toContain("  blocked by  [ ] ML-000003  Collect sources");
    expect(output).toContain("  related to  [x] ML-000004  Book venue");
    expect(formatTaskTable([task({ isBlocked: true })])).toContain("[blocked]");
  });

  it("prints the repeat rule in words and the series id", () => {
    const detail = formatTaskDetail(
      task({
        recurrence: {
          freq: "weekly",
          interval: 2,
          mode: "after_completion",
          weekdays: ["mon", "thu"],
          monthDay: null,
          nthWeekday: null,
          until: null,
          count: 3,
        },
        seriesId: "0198f0a0-0000-7000-8000-000000000009",
      }),
    );
    expect(detail).toContain(
      "repeat      Every 2 weeks on Mon, Thu after completion, 3 occurrences left",
    );
    expect(detail).toContain("series      0198f0a0-0000-7000-8000-000000000009");
    expect(formatTaskDetail(task())).not.toContain("repeat");
  });

  it("omits the subtask lines for a childless task", () => {
    expect(formatTaskDetail(task())).not.toContain("subtasks");
  });
});

describe("formatTagTable", () => {
  it("lists tags with colour and task counts", () => {
    expect(formatTagTable([])).toBe("No tags.");
    const lines = formatTagTable([
      {
        id: "01a04e0f-0000-7000-8000-000000000009",
        workspaceId: "01a04e0f-0000-7000-8000-000000000002",
        name: "Deep Work",
        colorToken: "teal",
        description: "Focus blocks",
        createdAt: "2026-09-03T09:00:00.000Z",
        updatedAt: "2026-09-03T09:00:00.000Z",
        taskCount: 1,
      },
    ]).split("\n");
    expect(lines[0]).toBe("Deep Work  teal     1 task  Focus blocks");
  });

  it("shows tags after the title in the task table", () => {
    const output = formatTaskTable([
      task({
        tags: [
          {
            id: "01a04e0f-0000-7000-8000-000000000009",
            workspaceId: "01a04e0f-0000-7000-8000-000000000002",
            name: "Deep Work",
            colorToken: "teal",
            description: null,
            createdAt: "2026-09-03T09:00:00.000Z",
            updatedAt: "2026-09-03T09:00:00.000Z",
          },
        ],
      }),
    ]);
    expect(output).toContain("#Deep Work");
  });
});

describe("formatStatusTable", () => {
  it("shows the flags that matter when editing a workflow", () => {
    const base = {
      projectId: "p",
      rank: "a0",
      colorToken: "blue",
      policyMd: null,
      archivedAt: null,
      version: 1,
    };
    const lines = formatStatusTable([
      {
        ...base,
        id: "s1",
        name: "Ready",
        category: "ready",
        wipLimit: 3,
        isDefault: true,
        isTerminal: false,
      },
      {
        ...base,
        id: "s2",
        name: "Done",
        category: "done",
        wipLimit: null,
        isDefault: false,
        isTerminal: true,
        archivedAt: "2026-09-01T10:00:00.000Z",
      },
    ]).split("\n");

    expect(lines[0]).toBe("s1  Ready  (ready)  [default, wip 3]");
    expect(lines[1]).toBe("s2  Done  (done)  [done, archived]");
    expect(formatStatusTable([])).toBe("No statuses.");
  });
});

describe("formatFlowSummary", () => {
  it("prints the numbers, a weekly bar per week, and the aging list", () => {
    const output = formatFlowSummary({
      projectId: "01a04e0f-0000-7000-8000-000000000003",
      range: "30",
      from: "2026-08-01",
      to: "2026-08-30",
      timezone: "Europe/Berlin",
      computedAt: "2026-08-30T09:00:00.000Z",
      wip: 2,
      completed: 3,
      cycleTimeDays: { samples: 2, p50: 1.5, p85: 4, p95: 4 },
      leadTimeDays: { samples: 3, p50: 2, p85: 6, p95: 6 },
      throughput: [
        { weekStart: "2026-07-27", count: 2 },
        { weekStart: "2026-08-03", count: 0 },
      ],
      cumulativeFlow: [],
      aging: [
        {
          taskId: "01a04e0f-0000-7000-8000-000000000001",
          key: "ML-000007",
          title: "Old one",
          statusId: "01a04e0f-0000-7000-8000-000000000004",
          statusName: "In Progress",
          category: "in_progress",
          ageDays: 9,
          band: "over_p95",
        },
      ],
    });

    expect(output).toContain("WIP now     2");
    expect(output).toContain("cycle time  p50 1.5d  p85 4d  p95 4d  (2 started tasks)");
    expect(output).toContain("2026-07-27  ## 2");
    expect(output).toContain("2026-08-03  0");
    expect(output).toContain("ML-000007       9d  In progress  Old one  [over p95]");
  });
});

describe("defer and deadline dates (GAP-16)", () => {
  it("shows the deadline and deferral in the table and the detail, with any warning", () => {
    const dated = task({
      dueDate: "2026-09-03",
      deadline: "2026-09-01",
      deadlineTime: "17:00",
      deferUntil: "2026-09-10",
      dateWarnings: ["defer_after_due", "due_after_deadline", "defer_after_deadline"],
    });

    expect(formatTaskTable([dated])).toBe(
      "[ ] ML-000001    Prepare research presentation  (due 2026-09-03)  (deadline 2026-09-01)  (deferred until 2026-09-10)",
    );
    const detail = formatTaskDetail(dated);
    expect(detail).toContain("  deadline    2026-09-01 17:00");
    expect(detail).toContain("  deferred    until 2026-09-10");
    expect(detail).toContain(
      "  warning     deferred past its due date; due after its deadline; deferred past its deadline",
    );
    expect(formatTaskDetail(task())).toContain("  deferred    no");
    expect(formatTaskDetail(task())).not.toContain("warning");
  });
});

describe("formatFieldTable", () => {
  const field = (
    overrides: Partial<FieldDefinitionListItemDto>,
  ): FieldDefinitionListItemDto => ({
    id: "01a04e0f-0000-7000-8000-00000000000a",
    workspaceId: "01a04e0f-0000-7000-8000-000000000002",
    key: "effort",
    name: "Effort",
    type: "number",
    options: [],
    rank: "a0",
    showOnCard: false,
    taskCount: 0,
    createdAt: "2026-09-05T09:00:00.000Z",
    updatedAt: "2026-09-05T09:00:00.000Z",
    ...overrides,
  });

  it("says so when there are none", () => {
    expect(formatFieldTable([])).toBe("No custom fields.");
  });

  it("lines up the key, name, type, use count, card flag and options", () => {
    const rendered = formatFieldTable([
      field({ taskCount: 1 }),
      field({
        key: "stage",
        name: "Release stage",
        type: "select",
        options: ["alpha", "beta"],
        showOnCard: true,
        taskCount: 4,
      }),
    ]);

    expect(rendered.split("\n")).toEqual([
      "effort  Effort         number  1 task",
      "stage   Release stage  select  4 tasks  on cards  [alpha, beta]",
    ]);
  });
});
