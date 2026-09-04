import type { TaskDto } from "@morrowlist/contracts";
import { SEARCH_GRAMMAR_EXAMPLES } from "@morrowlist/domain";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_VIEW,
  filtersFromView,
  matchesFilters,
  readTaskView,
  toListQuery,
  viewFromFilters,
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
    deferUntil: null,
    deadline: null,
    deadlineTime: null,
    dateWarnings: [],
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
      project: "any",
      priority: "high",
      due: "overdue",
      tag: "any",
      completion: "any",
      blocked: "any",
      sort: "dueDate",
      order: "desc",
    });
  });
});

describe("readTaskView with a saved view as the base", () => {
  it("lets an explicit any widen a narrower saved filter", () => {
    const base = {
      ...DEFAULT_VIEW,
      priority: "urgent" as const,
      due: "overdue" as const,
    };

    expect(readTaskView(new URLSearchParams("priority=any&due=any"), base)).toEqual({
      ...base,
      priority: "any",
      due: "any",
    });
    expect(writeTaskView({ ...base, priority: "any" }, base)).toBe("priority=any");
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
      deferred: false,
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

  it("respects a tag filter and carries it through the URL and the query", () => {
    const tag = {
      id: "01a04e0f-2e8a-7000-ae0a-989d784c0299",
      workspaceId: "01a04e0f-2e8a-7000-ae0a-989d784c0288",
      name: "Deep Work",
      colorToken: "teal" as const,
      description: null,
      createdAt: "2026-09-03T09:00:00.000Z",
      updatedAt: "2026-09-03T09:00:00.000Z",
    };
    const view = readTaskView(new URLSearchParams(`tag=${tag.id}`));
    expect(view.tag).toBe(tag.id);
    expect(writeTaskView(view)).toBe(`tag=${tag.id}`);
    expect(toListQuery("inbox", view)).toMatchObject({ tagId: tag.id });

    expect(matchesFilters(task({ tags: [tag] }), { tagId: tag.id })).toBe(true);
    expect(matchesFilters(task(), { tagId: tag.id })).toBe(false);
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

describe("blocked filter", () => {
  it("travels through the URL and the query, and drops an unblocked task", () => {
    const view = readTaskView(new URLSearchParams("blocked=yes"));
    expect(view.blocked).toBe("yes");
    expect(writeTaskView(view)).toBe("blocked=yes");
    expect(toListQuery("inbox", view)).toMatchObject({ isBlocked: true });
    expect(toListQuery("inbox", DEFAULT_VIEW)).not.toHaveProperty("isBlocked");

    expect(matchesFilters(task({ isBlocked: true }), { isBlocked: true })).toBe(true);
    expect(matchesFilters(task(), { isBlocked: true })).toBe(false);
    expect(matchesFilters(task({ isBlocked: true }), { isBlocked: false })).toBe(false);
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

describe("saved view filters", () => {
  const TAG_ID = "0198f0a0-0000-7000-8000-000000000009";

  it("round-trips a view through the stored filter shape", () => {
    const view = {
      ...DEFAULT_VIEW,
      project: "0198f0a0-0000-7000-8000-000000000001",
      due: "overdue" as const,
      blocked: "yes" as const,
      completion: "any" as const,
      sort: "dueDate" as const,
    };

    const filters = filtersFromView("all", view);
    expect(filters).toEqual({
      projectId: "0198f0a0-0000-7000-8000-000000000001",
      due: "overdue",
      isBlocked: true,
      sort: "dueDate",
      order: "asc",
    });
    expect(viewFromFilters(filters)).toEqual({ scope: "all", view });
  });

  it("keeps the Inbox scope and fixes Completed to done", () => {
    expect(filtersFromView("inbox", DEFAULT_VIEW)).toMatchObject({
      inbox: true,
      isCompleted: false,
    });
    expect(viewFromFilters({ inbox: true }).scope).toBe("inbox");
    expect(filtersFromView("completed", DEFAULT_VIEW)).toMatchObject({
      isCompleted: true,
    });
    expect(filtersFromView("completed", DEFAULT_VIEW)).not.toHaveProperty("deleted");
  });

  /**
   * The completion criterion shared with the CLI (`apps/cli/src/commands/where.test.ts`):
   * the panel's controls and `--where` produce identical list queries for the same
   * grammar rows. `tag` names resolve to the same id on both sides.
   */
  it.each(SEARCH_GRAMMAR_EXAMPLES.filter((row) => row.text === ""))(
    "produces the same query as --where $query",
    ({ filters }) => {
      const { tag, ...rest } = filters;
      const expected = { ...rest, ...(tag ? { tagId: TAG_ID } : {}) };
      const view = viewFromFilters(expected);
      const {
        sort: _sort,
        order: _order,
        ...query
      } = toListQuery(view.scope, view.view);
      expect(query).toEqual(expected);
    },
  );
});
