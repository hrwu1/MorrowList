import type { TaskDto } from "@morrowlist/contracts";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_VIEW,
  matchesFilters,
  readTaskView,
  toListQuery,
  writeTaskView,
} from "./task-view";

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "01a04e0f-2e8a-7000-ae0a-989d784c0287",
    key: "ML-1",
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
    parentTaskId: null,
    rank: "aa",
    isCompleted: false,
    completedAt: null,
    version: 1,
    createdBy: { kind: "user", id: "u1" },
    lastActor: { kind: "user", id: "u1" },
    createdAt: "2026-08-29T09:00:00.000Z",
    updatedAt: "2026-08-29T09:00:00.000Z",
    deletedAt: null,
    dayPlans: [],
    subtaskProgress: null,
    ...overrides,
  };
}

describe("readTaskView", () => {
  it("falls back to the default for an absent or unrecognised value", () => {
    expect(readTaskView(new URLSearchParams("priority=nonsense&sort=colour"))).toEqual(
      DEFAULT_VIEW,
    );
  });

  it("reads every control from the query string", () => {
    expect(
      readTaskView(
        new URLSearchParams(
          "priority=high&due=overdue&completed=any&sort=dueDate&order=desc",
        ),
      ),
    ).toEqual({
      priority: "high",
      due: "overdue",
      completion: "any",
      sort: "dueDate",
      order: "desc",
    });
  });
});

describe("writeTaskView", () => {
  it("omits defaults so a plain view has a clean URL", () => {
    expect(writeTaskView(DEFAULT_VIEW)).toBe("");
  });

  it("round-trips through the URL", () => {
    const view = {
      ...DEFAULT_VIEW,
      priority: "urgent" as const,
      sort: "priority" as const,
      order: "desc" as const,
    };

    expect(readTaskView(new URLSearchParams(writeTaskView(view)))).toEqual(view);
  });

  it("keeps unrelated parameters such as the open task panel", () => {
    const query = writeTaskView(
      { ...DEFAULT_VIEW, priority: "low" },
      DEFAULT_VIEW,
      new URLSearchParams("task=ML-7"),
    );

    expect(new URLSearchParams(query).get("task")).toBe("ML-7");
    expect(new URLSearchParams(query).get("priority")).toBe("low");
  });
});

describe("toListQuery", () => {
  it("scopes the Inbox to open, project-less tasks", () => {
    expect(toListQuery("inbox", DEFAULT_VIEW)).toEqual({
      inbox: true,
      isCompleted: false,
      sort: "rank",
      order: "asc",
    });
  });

  it("drops the completion filter when the view asks for any", () => {
    const query = toListQuery("inbox", { ...DEFAULT_VIEW, completion: "any" });

    expect(query).not.toHaveProperty("isCompleted");
  });

  it("asks for Trash rather than filtering a normal list", () => {
    expect(toListQuery("trash", DEFAULT_VIEW)).toMatchObject({ deleted: true });
    expect(toListQuery("trash", DEFAULT_VIEW)).not.toHaveProperty("inbox");
  });
});

describe("matchesFilters", () => {
  it("drops a completed task from an open list and keeps it in a completed one", () => {
    const done = task({ isCompleted: true, completedAt: "2026-08-29T10:00:00.000Z" });

    expect(matchesFilters(done, { inbox: true, isCompleted: false })).toBe(false);
    expect(matchesFilters(done, { isCompleted: true })).toBe(true);
  });

  it("keeps deleted and live tasks in separate lists", () => {
    const trashed = task({ deletedAt: "2026-08-29T10:00:00.000Z" });

    expect(matchesFilters(trashed, { inbox: true })).toBe(false);
    expect(matchesFilters(trashed, { deleted: true })).toBe(true);
    expect(matchesFilters(task(), { deleted: true })).toBe(false);
  });

  it("respects a priority filter", () => {
    expect(matchesFilters(task({ priority: "high" }), { priority: "high" })).toBe(true);
    expect(matchesFilters(task({ priority: "low" }), { priority: "high" })).toBe(false);
  });

  it("leaves a due-filtered list alone, since the browser cannot evaluate it", () => {
    // `due` is relative to the workspace timezone, which lives on the server.
    expect(matchesFilters(task({ dueDate: null }), { due: "today" })).toBe(true);
  });
});

describe("matchesFilters for subtasks", () => {
  it("keeps a subtask in its parent's list and out of a parent-free list", () => {
    const parentId = "01a04e0f-2e8a-7000-ae0a-989d784c0299";
    const subtask = task({ parentTaskId: parentId });

    expect(matchesFilters(subtask, { parentTaskId: parentId })).toBe(true);
    expect(matchesFilters(task(), { parentTaskId: parentId })).toBe(false);
    expect(matchesFilters(subtask, { includeSubtasks: false })).toBe(false);
    expect(matchesFilters(subtask, { inbox: true })).toBe(true);
  });
});
