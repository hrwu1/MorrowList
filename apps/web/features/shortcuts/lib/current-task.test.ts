import type { TaskDto } from "@morrowlist/contracts";
import { describe, expect, it } from "vitest";

import {
  findTaskInCaches,
  taskKeyFromElementId,
  taskKeyFromLocation,
} from "./current-task";

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "01a04e0f-2e8a-7000-ae0a-989d784c0287",
    key: "ML-000001",
    workspaceId: "01a04e0f-2e8a-7000-ae0a-989d784c0288",
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
    fields: {},
    parentTaskId: null,
    recurrence: null,
    seriesId: null,
    rank: "aa",
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

describe("taskKeyFromElementId", () => {
  it("reads the key off a list row's own title link", () => {
    expect(taskKeyFromElementId("task-link-ML-000012")).toBe("ML-000012");
  });

  it("reads the key off a board card's title link", () => {
    expect(taskKeyFromElementId("board-task-link-ML-000012")).toBe("ML-000012");
  });

  it("ignores anything else on the page", () => {
    expect(taskKeyFromElementId("workspace-search")).toBeNull();
    expect(taskKeyFromElementId(null)).toBeNull();
    expect(taskKeyFromElementId("")).toBeNull();
  });
});

describe("taskKeyFromLocation", () => {
  it("reads the detail route", () => {
    expect(taskKeyFromLocation("/tasks/ML-000012", "")).toBe("ML-000012");
  });

  it("reads the panel open over a list or a board", () => {
    expect(taskKeyFromLocation("/inbox", "?task=ML-000003&priority=high")).toBe(
      "ML-000003",
    );
    expect(taskKeyFromLocation("/projects/p1/board", "?task=ML-000009")).toBe(
      "ML-000009",
    );
  });

  it("has no answer when nothing is open", () => {
    expect(taskKeyFromLocation("/inbox", "?priority=high")).toBeNull();
  });

  it("decodes a key that had to be escaped in the path", () => {
    expect(taskKeyFromLocation("/tasks/ML%2D000012", "")).toBe("ML-000012");
  });
});

describe("findTaskInCaches", () => {
  const wanted = task({ key: "ML-000007", title: "Water the plants" });
  const other = task({ key: "ML-000001" });

  it("finds a task in a cached list page", () => {
    const entries = [{ data: [other], page: { hasMore: false } }, { data: [wanted] }];
    expect(findTaskInCaches(entries, "ML-000007")).toBe(wanted);
  });

  it("finds a task in a cached board", () => {
    const entries = [{ data: { statuses: [], tasks: [other, wanted] } }];
    expect(findTaskInCaches(entries, "ML-000007")).toBe(wanted);
  });

  it("finds a task inside a Today section", () => {
    const entries = [
      {
        data: { date: "2026-09-05", sections: [{ reason: "my_day", tasks: [wanted] }] },
      },
    ];
    expect(findTaskInCaches(entries, "ML-000007")).toBe(wanted);
  });

  it("finds a task in a cached detail", () => {
    expect(findTaskInCaches([wanted], "ML-000007")).toBe(wanted);
  });

  it("finds a task inside an infinite search result", () => {
    const entries = [
      { pages: [{ data: { projects: [], tasks: [{ task: wanted, matches: {} }] } }] },
    ];
    expect(findTaskInCaches(entries, "ML-000007")).toBe(wanted);
  });

  it("answers nothing for a key no projection holds", () => {
    expect(
      findTaskInCaches([{ data: [other] }, undefined, null], "ML-000007"),
    ).toBeUndefined();
  });
});
