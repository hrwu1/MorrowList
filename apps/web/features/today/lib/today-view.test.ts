import type { TaskDto, TodayViewResponse } from "@morrowlist/contracts";
import { describe, expect, it } from "vitest";

import { countTodayTasks, patchTaskInToday } from "./today-view";

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "0198f0a0-0000-7000-8000-000000000001",
    key: "ML-1",
    workspaceId: "0198f0a0-0000-7000-8000-000000000010",
    taskNumber: 1,
    projectId: null,
    statusId: null,
    title: "Task",
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
    createdAt: "2026-09-03T09:00:00.000Z",
    updatedAt: "2026-09-03T09:00:00.000Z",
    deletedAt: null,
    dayPlans: [],
    subtaskProgress: null,
    ...overrides,
  };
}

const DATE = "2026-09-03";

function view(overrides: Partial<TodayViewResponse["data"]> = {}): TodayViewResponse {
  return {
    data: {
      date: DATE,
      sections: [
        { id: "overdue", tasks: [] },
        { id: "due_today", tasks: [] },
        { id: "my_day", tasks: [] },
      ],
      review: null,
      ...overrides,
    },
  };
}

describe("patchTaskInToday", () => {
  it("removes a completed task from its section", () => {
    const planned = task({ dayPlans: [DATE] });
    const cached = view({
      sections: [
        { id: "overdue", tasks: [] },
        { id: "due_today", tasks: [] },
        { id: "my_day", tasks: [{ task: planned, reasons: ["my_day"] }] },
      ],
    });

    const patched = patchTaskInToday(cached, { ...planned, isCompleted: true });

    expect(countTodayTasks(patched)).toBe(0);
  });

  it("drops the My Day badge, and the row, when the selection is removed", () => {
    const overdueAndPlanned = task({ dueDate: "2026-09-01", dayPlans: [DATE] });
    const planned = task({ id: "2", key: "ML-2", dayPlans: [DATE] });
    const cached = view({
      sections: [
        {
          id: "overdue",
          tasks: [{ task: overdueAndPlanned, reasons: ["overdue", "my_day"] }],
        },
        { id: "due_today", tasks: [] },
        { id: "my_day", tasks: [{ task: planned, reasons: ["my_day"] }] },
      ],
    });

    const first = patchTaskInToday(cached, { ...overdueAndPlanned, dayPlans: [] });
    const second = patchTaskInToday(first, { ...planned, dayPlans: [] });

    expect(first.data.sections[0]?.tasks[0]?.reasons).toEqual(["overdue"]);
    expect(second.data.sections[2]?.tasks).toEqual([]);
  });

  it("adds a newly planned task to My Day and takes it out of the review", () => {
    const leftover = task();
    const cached = view({ review: { date: "2026-09-02", tasks: [leftover] } });

    const patched = patchTaskInToday(cached, { ...leftover, dayPlans: [DATE] });

    expect(patched.data.review).toBeNull();
    expect(patched.data.sections[2]?.tasks).toEqual([
      { task: { ...leftover, dayPlans: [DATE] }, reasons: ["my_day"] },
    ]);
  });

  it("files an overdue task that was just planned under Overdue with both badges", () => {
    const leftover = task({ dueDate: "2026-09-01" });
    const cached = view({ review: { date: "2026-09-02", tasks: [leftover] } });

    const patched = patchTaskInToday(cached, { ...leftover, dayPlans: [DATE] });

    expect(patched.data.sections[0]?.tasks[0]?.reasons).toEqual(["overdue", "my_day"]);
    expect(patched.data.sections[2]?.tasks).toEqual([]);
  });

  it("leaves an unrelated task and the review untouched", () => {
    const listed = task({ dueDate: DATE });
    const other = task({ id: "9", key: "ML-9" });
    const cached = view({
      sections: [
        { id: "overdue", tasks: [] },
        { id: "due_today", tasks: [{ task: listed, reasons: ["due_today"] }] },
        { id: "my_day", tasks: [] },
      ],
      review: { date: "2026-09-02", tasks: [other] },
    });

    const patched = patchTaskInToday(cached, { ...listed, title: "Renamed" });

    expect(patched.data.sections[1]?.tasks[0]?.task.title).toBe("Renamed");
    expect(patched.data.review?.tasks).toEqual([other]);
  });
});
