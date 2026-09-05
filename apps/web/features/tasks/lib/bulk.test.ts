import type { BatchResultItemDto, TaskDto } from "@morrowlist/contracts";
import { describe, expect, it } from "vitest";

import { bulkVerb, inverseOperations, toOperations } from "./bulk";

function task(overrides: Partial<TaskDto>): TaskDto {
  return {
    id: "t",
    title: "Task",
    rank: "m",
    version: 3,
    priority: "none",
    dueDate: null,
    projectId: "p",
    statusId: "ready",
    deletedAt: null,
    ...overrides,
  } as TaskDto;
}

/** What the server answered for each entry: the same task, one version on. */
function results(tasks: readonly TaskDto[], op: string): BatchResultItemDto[] {
  return tasks.map((current) => ({
    op,
    taskId: current.id,
    data: { ...current, version: current.version + 1 },
  }));
}

describe("bulk operations", () => {
  const tasks = [task({ id: "a", version: 1 }), task({ id: "b", version: 4 })];

  it("sends each task's own version so a stale row is refused, not overwritten", () => {
    expect(toOperations({ kind: "complete" }, tasks)).toEqual([
      { op: "complete", taskId: "a", expectedVersion: 1, acknowledgeBlocked: true },
      { op: "complete", taskId: "b", expectedVersion: 4, acknowledgeBlocked: true },
    ]);
  });

  it("omits a version for a tag, which is a relation and does not bump one", () => {
    expect(toOperations({ kind: "addTag", tagId: "tag-1" }, tasks)).toEqual([
      { op: "addTag", taskId: "a", tagId: "tag-1" },
      { op: "addTag", taskId: "b", tagId: "tag-1" },
    ]);
  });

  it("names each action in the past tense for the toast", () => {
    expect(bulkVerb({ kind: "complete" })).toBe("completed");
    expect(bulkVerb({ kind: "setDueDate", dueDate: "2026-09-15" })).toBe("rescheduled");
    expect(bulkVerb({ kind: "setDueDate", dueDate: null })).toBe(
      "cleared of a due date",
    );
  });
});

describe("undoing a bulk change", () => {
  it("inverts each entry against the version that entry produced", () => {
    const tasks = [
      task({ id: "a", version: 1, priority: "low" }),
      task({ id: "b", version: 4, priority: "urgent" }),
    ];

    expect(
      inverseOperations({ kind: "complete" }, tasks, results(tasks, "complete"), []),
    ).toEqual([
      { op: "reopen", taskId: "a", expectedVersion: 2 },
      { op: "reopen", taskId: "b", expectedVersion: 5 },
    ]);

    // A field change goes back to the value each task actually had, not to a default.
    expect(
      inverseOperations(
        { kind: "setPriority", priority: "high" },
        tasks,
        results(tasks, "setPriority"),
        [],
      ),
    ).toEqual([
      { op: "setPriority", taskId: "a", expectedVersion: 2, priority: "low" },
      { op: "setPriority", taskId: "b", expectedVersion: 5, priority: "urgent" },
    ]);
  });

  it("skips a task the server did not answer for", () => {
    const tasks = [task({ id: "a" }), task({ id: "b" })];
    expect(
      inverseOperations({ kind: "delete" }, tasks, results([tasks[0]!], "delete"), []),
    ).toEqual([{ op: "restore", taskId: "a", expectedVersion: 4 }]);
  });

  it("restores a moved group into its old column in its old order", () => {
    // Three cards from the middle of Ready, moved to In Progress together. Undo has to
    // chain them: a card still in the destination is not an anchor anything can use.
    const stayedAbove = task({ id: "top", rank: "a" });
    const first = task({ id: "one", rank: "d" });
    const second = task({ id: "two", rank: "f" });
    const stayedBelow = task({ id: "bottom", rank: "z" });
    const moved = [second, first];
    const candidates = [stayedAbove, first, second, stayedBelow];

    const operations = inverseOperations(
      { kind: "move", projectId: "p", statusId: "doing" },
      moved,
      results(moved, "move"),
      candidates,
    );

    expect(operations).toEqual([
      {
        op: "move",
        taskId: "one",
        expectedVersion: 4,
        projectId: "p",
        statusId: "ready",
        beforeTaskId: "top",
        afterTaskId: "bottom",
      },
      {
        op: "move",
        taskId: "two",
        expectedVersion: 4,
        projectId: "p",
        statusId: "ready",
        // Anchored to the card already put back, which is what preserves their order.
        beforeTaskId: "one",
        afterTaskId: "bottom",
      },
    ]);
  });

  it("restores cards from different columns to the column each came from", () => {
    const fromReady = task({ id: "a", rank: "d", statusId: "ready" });
    const fromInbox = task({ id: "b", rank: "e", projectId: null, statusId: null });
    const moved = [fromReady, fromInbox];

    const operations = inverseOperations(
      { kind: "move", projectId: "p", statusId: "doing" },
      moved,
      results(moved, "move"),
      moved,
    );

    expect(operations.map((operation) => operation)).toEqual([
      {
        op: "move",
        taskId: "a",
        expectedVersion: 4,
        projectId: "p",
        statusId: "ready",
        beforeTaskId: null,
        afterTaskId: null,
      },
      {
        op: "move",
        taskId: "b",
        expectedVersion: 4,
        projectId: null,
        beforeTaskId: null,
        afterTaskId: null,
      },
    ]);
  });
});
