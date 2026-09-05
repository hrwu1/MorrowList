import { describe, expect, it } from "vitest";

import { fixedClock } from "../shared/clock.js";
import {
  DomainError,
  ValidationError,
  VersionConflictError,
} from "../shared/errors.js";

import { TEST_INSTANT, testContext, testStatus } from "./fixtures.js";
import {
  assertExpectedVersion,
  childProgress,
  clearBlocked,
  completeTask,
  createTask,
  deleteTask,
  flagBlocked,
  materialChanges,
  moveTask,
  reopenTask,
  reorderTask,
  resolveReopenStatus,
  restoreTask,
  setParent,
  skipOccurrence,
  spawnNextOccurrence,
  updateTaskFields,
} from "./policies.js";
import {
  dateOrderWarnings,
  isDeferred,
  isInboxTask,
  isPastDeadline,
  type Task,
} from "./task.js";
import { toPlainDate, toPlainTime } from "./values.js";

const baseInput = {
  id: "task-1",
  workspaceId: "workspace-1",
  taskNumber: 142,
  title: "Prepare research presentation",
  rank: "a0",
};

function inboxTask(overrides: Partial<Task> = {}): Task {
  return { ...createTask(baseInput, testContext()), ...overrides };
}

describe("createTask", () => {
  it("creates an Inbox task from a title alone", () => {
    const task = createTask(baseInput, testContext());

    expect(task.projectId).toBeNull();
    expect(task.statusId).toBeNull();
    expect(isInboxTask(task)).toBe(true);
    expect(task.version).toBe(1);
    expect(task.priority).toBe("none");
    expect(task.completedAt).toBeNull();
    expect(task.createdAt).toEqual(TEST_INSTANT);
    expect(task.createdBy).toEqual({ kind: "user", id: "user-1" });
  });

  it("trims and normalizes the title", () => {
    const task = createTask(
      { ...baseInput, title: "  Write the brief  " },
      testContext(),
    );

    expect(task.title).toBe("Write the brief");
  });

  it("rejects a blank title", () => {
    expect(() => createTask({ ...baseInput, title: "   " }, testContext())).toThrow(
      ValidationError,
    );
  });

  it("rejects a title over 500 characters", () => {
    expect(() =>
      createTask({ ...baseInput, title: "x".repeat(501) }, testContext()),
    ).toThrow(/500 characters or fewer/);
  });

  it("counts emoji as single characters", () => {
    const task = createTask({ ...baseInput, title: "🎯".repeat(500) }, testContext());

    expect([...task.title].length).toBe(500);
  });

  it("places a task into a project status when one is supplied", () => {
    const status = testStatus({ category: "ready" });
    const task = createTask(
      { ...baseInput, project: { id: "project-1", status } },
      testContext(),
    );

    expect(task.projectId).toBe("project-1");
    expect(task.statusId).toBe(status.id);
  });

  it("refuses to create a task directly in a Done status", () => {
    const done = testStatus({ category: "done", id: "status-done" });

    expect(() =>
      createTask(
        { ...baseInput, project: { id: "project-1", status: done } },
        testContext(),
      ),
    ).toThrow(/cannot be created directly in a Done status/);
  });

  it("refuses a status belonging to another project", () => {
    const foreign = testStatus({ projectId: "project-2" });

    expect(() =>
      createTask(
        { ...baseInput, project: { id: "project-1", status: foreign } },
        testContext(),
      ),
    ).toThrow(/belongs to a different project/);
  });

  it("drops a due timezone when there is no due time", () => {
    const task = createTask(
      {
        ...baseInput,
        dueDate: toPlainDate("2026-09-01"),
        dueTimezone: "Europe/Berlin",
      },
      testContext(),
    );

    expect(task.dueTimezone).toBeNull();
  });

  it("rejects a due time without a due date", () => {
    expect(() =>
      createTask(
        { ...baseInput, dueTime: toPlainTime("09:30"), dueTimezone: "UTC" },
        testContext(),
      ),
    ).toThrow(/due time requires a due date/);
  });
});

describe("updateTaskFields", () => {
  it("increments the version and records the actor on a material change", () => {
    const task = inboxTask();
    const updated = updateTaskFields(task, { title: "New title" }, testContext());

    expect(updated.title).toBe("New title");
    expect(updated.version).toBe(2);
    expect(updated.lastActor).toEqual({ kind: "user", id: "user-1" });
  });

  it("does not bump the version when nothing changed", () => {
    const task = inboxTask();
    const updated = updateTaskFields(task, { title: task.title }, testContext());

    expect(updated).toBe(task);
    expect(updated.version).toBe(1);
  });

  it("distinguishes an omitted field from an explicitly cleared one", () => {
    const task = updateTaskFields(
      inboxTask(),
      { descriptionMd: "Some notes", priority: "high" },
      testContext(),
    );

    const omitted = updateTaskFields(task, { priority: "urgent" }, testContext());
    expect(omitted.descriptionMd).toBe("Some notes");

    const cleared = updateTaskFields(task, { descriptionMd: null }, testContext());
    expect(cleared.descriptionMd).toBeNull();
  });

  it("clears the due time when the due date is cleared", () => {
    const dated = updateTaskFields(
      inboxTask(),
      {
        dueDate: toPlainDate("2026-09-01"),
        dueTime: toPlainTime("09:30"),
        dueTimezone: "Europe/Berlin",
      },
      testContext(),
    );
    expect(dated.dueTime).toBe("09:30");

    const cleared = updateTaskFields(dated, { dueDate: null }, testContext());
    expect(cleared.dueDate).toBeNull();
    expect(cleared.dueTime).toBeNull();
    expect(cleared.dueTimezone).toBeNull();
  });

  it("refuses to change a deleted task", () => {
    const deleted = deleteTask(inboxTask(), testContext());

    expect(() => updateTaskFields(deleted, { title: "x" }, testContext())).toThrow(
      /must be restored/,
    );
  });
});

describe("completeTask", () => {
  it("completes an Inbox task without giving it a project or status", () => {
    const completed = completeTask(inboxTask(), {}, testContext());

    expect(completed.completedAt).toEqual(TEST_INSTANT);
    expect(completed.projectId).toBeNull();
    expect(completed.statusId).toBeNull();
    expect(completed.version).toBe(2);
  });

  it("preserves dates, priority, and description when completing", () => {
    const rich = updateTaskFields(
      inboxTask(),
      {
        priority: "high",
        descriptionMd: "Notes",
        dueDate: toPlainDate("2026-09-01"),
      },
      testContext(),
    );
    const completed = completeTask(rich, {}, testContext());

    expect(completed.priority).toBe("high");
    expect(completed.descriptionMd).toBe("Notes");
    expect(completed.dueDate).toBe("2026-09-01");
  });

  it("moves a project task to Done and remembers the prior status", () => {
    const inProgress = testStatus({ category: "in_progress", id: "status-wip" });
    const done = testStatus({ category: "done", id: "status-done" });
    const task = createTask(
      { ...baseInput, project: { id: "project-1", status: inProgress } },
      testContext(),
    );

    const completed = completeTask(
      task,
      { doneStatus: { status: done, rank: "a1" } },
      testContext(),
    );

    expect(completed.statusId).toBe("status-done");
    expect(completed.lastActiveStatusId).toBe("status-wip");
    expect(completed.rank).toBe("a1");
    expect(completed.completedAt).toEqual(TEST_INSTANT);
  });

  it("is a no-op for an already completed task", () => {
    const completed = completeTask(inboxTask(), {}, testContext());
    const again = completeTask(completed, {}, testContext());

    expect(again).toBe(completed);
    expect(again.version).toBe(2);
  });

  it("fails when a project has no Done status", () => {
    const ready = testStatus();
    const task = createTask(
      { ...baseInput, project: { id: "project-1", status: ready } },
      testContext(),
    );

    expect(() => completeTask(task, {}, testContext())).toThrow(
      /no active Done status/,
    );
  });

  it("refuses a non-terminal status as the completion destination", () => {
    const ready = testStatus();
    const task = createTask(
      { ...baseInput, project: { id: "project-1", status: ready } },
      testContext(),
    );

    expect(() =>
      completeTask(task, { doneStatus: { status: ready, rank: "a1" } }, testContext()),
    ).toThrow(/requires a Done-category status/);
  });
});

describe("reopenTask", () => {
  it("clears the completion timestamp of an Inbox task", () => {
    const completed = completeTask(inboxTask(), {}, testContext());
    const reopened = reopenTask(completed, {}, testContext());

    expect(reopened.completedAt).toBeNull();
    expect(reopened.projectId).toBeNull();
    expect(reopened.version).toBe(3);
  });

  it("returns a project task to its previous status", () => {
    const inProgress = testStatus({ category: "in_progress", id: "status-wip" });
    const done = testStatus({ category: "done", id: "status-done" });
    const task = createTask(
      { ...baseInput, project: { id: "project-1", status: inProgress } },
      testContext(),
    );
    const completed = completeTask(
      task,
      { doneStatus: { status: done, rank: "a1" } },
      testContext(),
    );

    const destination = resolveReopenStatus(completed, [inProgress, done]);
    expect(destination).toBe(inProgress);

    const reopened = reopenTask(
      completed,
      { destination: { status: inProgress, rank: "a2" } },
      testContext(),
    );

    expect(reopened.completedAt).toBeNull();
    expect(reopened.statusId).toBe("status-wip");
    expect(reopened.lastActiveStatusId).toBeNull();
  });

  it("falls back to the default status when the previous one was archived", () => {
    const archived = testStatus({
      category: "in_progress",
      id: "status-wip",
      archivedAt: TEST_INSTANT,
    });
    const ready = testStatus({
      category: "ready",
      id: "status-ready",
      isDefault: true,
    });
    const completed: Task = {
      ...inboxTask(),
      projectId: "project-1",
      statusId: "status-done",
      lastActiveStatusId: "status-wip",
      completedAt: TEST_INSTANT,
    };

    expect(resolveReopenStatus(completed, [archived, ready])).toBe(ready);
  });

  it("is a no-op for a task that is not completed", () => {
    const task = inboxTask();

    expect(reopenTask(task, {}, testContext())).toBe(task);
  });
});

describe("moveTask", () => {
  it("completes a task moved into a Done status", () => {
    const ready = testStatus();
    const done = testStatus({ category: "done", id: "status-done" });
    const task = createTask(
      { ...baseInput, project: { id: "project-1", status: ready } },
      testContext(),
    );

    const moved = moveTask(
      task,
      { destination: { projectId: "project-1", status: done }, rank: "a1" },
      testContext(),
    );

    expect(moved.completedAt).toEqual(TEST_INSTANT);
    expect(moved.lastActiveStatusId).toBe(ready.id);
  });

  it("reopens a completed task moved out of Done", () => {
    const ready = testStatus();
    const done = testStatus({ category: "done", id: "status-done" });
    const task = createTask(
      { ...baseInput, project: { id: "project-1", status: ready } },
      testContext(),
    );
    const completed = moveTask(
      task,
      { destination: { projectId: "project-1", status: done }, rank: "a1" },
      testContext(),
    );

    const reopened = moveTask(
      completed,
      { destination: { projectId: "project-1", status: ready }, rank: "a2" },
      testContext(),
    );

    expect(reopened.completedAt).toBeNull();
    expect(reopened.statusId).toBe(ready.id);
  });

  it("does not restamp completion when re-entering the same Done status", () => {
    const earlier = new Date("2026-08-01T00:00:00.000Z");
    const ready = testStatus();
    const done = testStatus({ category: "done", id: "status-done" });
    const task = createTask(
      { ...baseInput, project: { id: "project-1", status: ready } },
      testContext({ clock: fixedClock(earlier) }),
    );
    const completed = moveTask(
      task,
      { destination: { projectId: "project-1", status: done }, rank: "a1" },
      testContext({ clock: fixedClock(earlier) }),
    );

    const reordered = moveTask(
      completed,
      { destination: { projectId: "project-1", status: done }, rank: "a5" },
      testContext(),
    );

    expect(reordered.completedAt).toEqual(earlier);
    expect(reordered.rank).toBe("a5");
  });

  it("clears project and status when moved back to the Inbox", () => {
    const ready = testStatus();
    const task = createTask(
      { ...baseInput, project: { id: "project-1", status: ready } },
      testContext(),
    );

    const moved = moveTask(task, { destination: null, rank: "a1" }, testContext());

    expect(moved.projectId).toBeNull();
    expect(moved.statusId).toBeNull();
    expect(isInboxTask(moved)).toBe(true);
  });
});

describe("reorderTask", () => {
  it("changes only the rank", () => {
    const task = inboxTask();
    const reordered = reorderTask(task, "a1", testContext());

    expect(reordered.rank).toBe("a1");
    expect(reordered.version).toBe(2);
    expect(reordered.statusId).toBe(task.statusId);
  });
});

describe("deleteTask and restoreTask", () => {
  it("soft deletes with an actor snapshot and restores", () => {
    const task = inboxTask();
    const deleted = deleteTask(task, testContext());

    expect(deleted.deletedAt).toEqual(TEST_INSTANT);
    expect(deleted.deletedBy).toEqual({ kind: "user", id: "user-1" });

    const restored = restoreTask(deleted, testContext());
    expect(restored.deletedAt).toBeNull();
    expect(restored.deletedBy).toBeNull();
    expect(restored.version).toBe(3);
  });

  it("is idempotent", () => {
    const deleted = deleteTask(inboxTask(), testContext());

    expect(deleteTask(deleted, testContext())).toBe(deleted);
  });
});

describe("setParent", () => {
  it("attaches a task to a parent and bumps the version", () => {
    const parent = inboxTask({ id: "parent" });
    const task = inboxTask({ id: "child", taskNumber: 143 });

    const attached = setParent(task, { parent }, testContext());

    expect(attached.parentTaskId).toBe("parent");
    expect(attached.version).toBe(2);
    // A subtask stays a normal task: nothing else about it changes (spec 8.3).
    expect(attached.projectId).toBe(task.projectId);
    expect(attached.rank).toBe(task.rank);
  });

  it("detaches a task and is a no-op when already detached", () => {
    const parent = inboxTask({ id: "parent" });
    const attached = setParent(inboxTask({ id: "child" }), { parent }, testContext());

    const detached = setParent(attached, { parent: null }, testContext());
    expect(detached.parentTaskId).toBeNull();
    expect(detached.version).toBe(3);
    expect(setParent(detached, { parent: null }, testContext())).toBe(detached);
  });

  it("allows three nesting levels and rejects a fourth", () => {
    const level2 = inboxTask({ id: "level-2" });
    const level3 = inboxTask({ id: "level-3" });
    const task = inboxTask({ id: "level-4" });

    expect(
      setParent(task, { parent: level2, ancestorIds: ["root"] }, testContext())
        .parentTaskId,
    ).toBe("level-2");

    expect(() =>
      setParent(
        task,
        { parent: level3, ancestorIds: ["level-2", "root"] },
        testContext(),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "TASK_NESTING_LIMIT_EXCEEDED",
      }) as DomainError,
    );

    // Depth counts the levels already hanging below the task being moved.
    expect(() =>
      setParent(
        task,
        { parent: level2, ancestorIds: ["root"], descendantDepth: 1 },
        testContext(),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "TASK_NESTING_LIMIT_EXCEEDED",
      }) as DomainError,
    );
  });

  it("rejects a cycle and self-parenting", () => {
    const task = inboxTask({ id: "task" });
    const child = inboxTask({ id: "child" });

    expect(() =>
      setParent(task, { parent: child, ancestorIds: ["task"] }, testContext()),
    ).toThrow(expect.objectContaining({ code: "TASK_RELATION_CYCLE" }) as DomainError);
    expect(() => setParent(task, { parent: task }, testContext())).toThrow(
      expect.objectContaining({ code: "TASK_RELATION_CYCLE" }) as DomainError,
    );
  });

  it("rejects a parent from another workspace or in the Trash", () => {
    const task = inboxTask({ id: "task" });

    expect(() =>
      setParent(
        task,
        { parent: inboxTask({ id: "foreign", workspaceId: "workspace-2" }) },
        testContext(),
      ),
    ).toThrow(expect.objectContaining({ code: "TASK_NOT_FOUND" }) as DomainError);
    expect(() =>
      setParent(
        task,
        { parent: deleteTask(inboxTask({ id: "gone" }), testContext()) },
        testContext(),
      ),
    ).toThrow(expect.objectContaining({ code: "TASK_NOT_FOUND" }) as DomainError);
  });

  it("refuses to change a deleted task", () => {
    const deleted = deleteTask(inboxTask(), testContext());

    expect(() =>
      setParent(deleted, { parent: inboxTask({ id: "p" }) }, testContext()),
    ).toThrow(ValidationError);
  });
});

describe("childProgress", () => {
  it("counts completed over total direct children, ignoring deleted ones", () => {
    const open = inboxTask({ id: "open" });
    const done = completeTask(inboxTask({ id: "done" }), {}, testContext());
    const deleted = deleteTask(
      completeTask(inboxTask({ id: "deleted" }), {}, testContext()),
      testContext(),
    );

    expect(childProgress([open, done, deleted])).toEqual({ completed: 1, total: 2 });
    expect(childProgress([])).toEqual({ completed: 0, total: 0 });
  });
});

describe("assertExpectedVersion", () => {
  it("passes when the version matches or is omitted", () => {
    const task = inboxTask();

    expect(() => assertExpectedVersion(task, 1)).not.toThrow();
    expect(() => assertExpectedVersion(task, undefined)).not.toThrow();
  });

  it("reports the actual version on conflict", () => {
    const task: Task = { ...inboxTask(), version: 7 };

    try {
      assertExpectedVersion(task, 6);
      expect.unreachable("expected a version conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(VersionConflictError);
      const conflict = error as VersionConflictError;
      expect(conflict.code).toBe("TASK_VERSION_CONFLICT");
      expect(conflict.details).toMatchObject({ expectedVersion: 6, actualVersion: 7 });
    }
  });
});

describe("materialChanges", () => {
  it("reports only the fields that changed", () => {
    const task = inboxTask();
    const updated = updateTaskFields(
      task,
      { title: "Renamed", priority: "high" },
      testContext(),
    );

    expect(materialChanges(updated, task)).toEqual({
      title: { from: task.title, to: "Renamed" },
      priority: { from: "none", to: "high" },
    });
  });

  it("serializes date changes as ISO strings", () => {
    const task = inboxTask();
    const completed = completeTask(task, {}, testContext());

    expect(materialChanges(completed, task)).toEqual({
      completedAt: { from: null, to: TEST_INSTANT.toISOString() },
    });
  });
});

describe("DomainError", () => {
  it("carries a stable code and details", () => {
    const error = new DomainError("TASK_NOT_FOUND", "gone", { taskId: "t1" });

    expect(error.code).toBe("TASK_NOT_FOUND");
    expect(error.details).toEqual({ taskId: "t1" });
  });
});

describe("flagBlocked and clearBlocked", () => {
  it("records the reason and the first flag time, keeping the task in its status", () => {
    const status = testStatus({ category: "in_progress" });
    const task = moveTask(
      inboxTask(),
      { destination: { projectId: status.projectId, status }, rank: "a1" },
      testContext(),
    );

    const flagged = flagBlocked(task, "  waiting on   vendor ", testContext());
    expect(flagged.blockedReason).toBe("waiting on vendor");
    expect(flagged.blockedSince).toEqual(TEST_INSTANT);
    expect(flagged.statusId).toBe(status.id);
    expect(flagged.version).toBe(task.version + 1);
    expect(materialChanges(flagged, task)).toEqual({
      blockedReason: { from: null, to: "waiting on vendor" },
      blockedSince: { from: null, to: TEST_INSTANT.toISOString() },
    });

    // A changed reason keeps the original start so blocked time is continuous.
    const later = testContext({
      clock: fixedClock(new Date("2026-08-30T09:00:00.000Z")),
    });
    const reworded = flagBlocked(flagged, "vendor replied, waiting on legal", later);
    expect(reworded.blockedSince).toEqual(TEST_INSTANT);
    expect(flagBlocked(reworded, "vendor replied, waiting on legal", later)).toBe(
      reworded,
    );

    const cleared = clearBlocked(reworded, later);
    expect(cleared.blockedReason).toBeNull();
    expect(cleared.blockedSince).toBeNull();
    expect(clearBlocked(cleared, later)).toBe(cleared);
  });

  it("rejects an empty reason and a deleted task", () => {
    expect(() => flagBlocked(inboxTask(), "   ", testContext())).toThrow(
      ValidationError,
    );
    expect(() =>
      flagBlocked(deleteTask(inboxTask(), testContext()), "x", testContext()),
    ).toThrow(ValidationError);
  });

  it("survives completion so a reopened task shows the same reason", () => {
    const flagged = flagBlocked(inboxTask(), "vendor", testContext());
    const done = completeTask(flagged, {}, testContext());
    expect(done.blockedReason).toBe("vendor");
    expect(reopenTask(done, {}, testContext()).blockedReason).toBe("vendor");
  });
});

describe("recurrence", () => {
  const weekly = { freq: "weekly" as const, weekdays: ["thu" as const] };

  it("starts a series with the task itself when a rule is set on creation", () => {
    const task = createTask({ ...baseInput, recurrence: weekly }, testContext());

    expect(task.recurrence).toMatchObject({ freq: "weekly", weekdays: ["thu"] });
    expect(task.seriesId).toBe("task-1");
  });

  it("assigns the series on the first rule and keeps it when the rule is cleared", () => {
    const task = inboxTask();
    const repeating = updateTaskFields(task, { recurrence: weekly }, testContext());
    expect(repeating.seriesId).toBe("task-1");
    expect(repeating.version).toBe(2);
    expect(materialChanges(repeating, task)).toMatchObject({
      recurrence: { from: null },
      seriesId: { from: null, to: "task-1" },
    });

    const stopped = updateTaskFields(repeating, { recurrence: null }, testContext());
    expect(stopped.recurrence).toBeNull();
    expect(stopped.seriesId).toBe("task-1");

    // The same rule in a different key order is not a change.
    const same = updateTaskFields(
      repeating,
      { recurrence: { weekdays: ["thu"], freq: "weekly" } },
      testContext(),
    );
    expect(same).toBe(repeating);
  });

  it("rejects an unusable rule", () => {
    expect(() =>
      updateTaskFields(inboxTask(), { recurrence: { freq: "weekly" } }, testContext()),
    ).toThrow(ValidationError);
  });

  it("describes the next occurrence with the task's fields and the counted-down rule", () => {
    const task = inboxTask({
      projectId: "project-1",
      statusId: "status-ready",
      priority: "high",
      descriptionMd: "Notes",
      dueDate: toPlainDate("2026-09-03"),
      dueTime: toPlainTime("09:00"),
      dueTimezone: "Europe/Berlin",
      reminderOffsetMinutes: 30,
      parentTaskId: "parent-1",
      recurrence: {
        ...createTask(
          { ...baseInput, recurrence: { ...weekly, count: 2 } },
          testContext(),
        ).recurrence!,
      },
      seriesId: "series-1",
    });

    expect(spawnNextOccurrence(task, toPlainDate("2026-09-03"))).toEqual({
      workspaceId: "workspace-1",
      title: task.title,
      descriptionMd: "Notes",
      priority: "high",
      projectId: "project-1",
      parentTaskId: "parent-1",
      fields: {},
      dueDate: "2026-09-10",
      dueTime: "09:00",
      dueTimezone: "Europe/Berlin",
      deferUntil: null,
      deadline: null,
      deadlineTime: null,
      reminderOffsetMinutes: 30,
      recurrence: { ...task.recurrence, count: 1 },
      seriesId: "series-1",
    });
  });

  it("spawns nothing for a task that does not repeat or whose series is over", () => {
    expect(spawnNextOccurrence(inboxTask(), toPlainDate("2026-09-03"))).toBeNull();
    const last = createTask(
      { ...baseInput, recurrence: { ...weekly, count: 1 } },
      testContext(),
    );
    expect(spawnNextOccurrence(last, toPlainDate("2026-09-03"))).toBeNull();
  });

  it("skips to the next occurrence on the same task", () => {
    const task = createTask(
      {
        ...baseInput,
        dueDate: toPlainDate("2026-09-03"),
        recurrence: { ...weekly, count: 3 },
      },
      testContext(),
    );

    const skipped = skipOccurrence(task, toPlainDate("2026-09-03"), testContext());
    expect(skipped.id).toBe(task.id);
    expect(skipped.dueDate).toBe("2026-09-10");
    expect(skipped.recurrence?.count).toBe(2);
    expect(skipped.version).toBe(2);
  });

  it("refuses to skip a non-repeating, completed, or last occurrence", () => {
    expect(() =>
      skipOccurrence(inboxTask(), toPlainDate("2026-09-03"), testContext()),
    ).toThrow(/does not repeat/);
    const last = createTask(
      { ...baseInput, recurrence: { ...weekly, count: 1 } },
      testContext(),
    );
    expect(() =>
      skipOccurrence(last, toPlainDate("2026-09-03"), testContext()),
    ).toThrow(/last occurrence/);
    const done = completeTask(
      createTask({ ...baseInput, recurrence: weekly }, testContext()),
      {},
      testContext(),
    );
    expect(() =>
      skipOccurrence(done, toPlainDate("2026-09-03"), testContext()),
    ).toThrow(/completed/);
  });
});

describe("defer and deadline dates (GAP-16)", () => {
  it("stores the three dates on create and drops a deadline time without a deadline", () => {
    const task = createTask(
      {
        ...baseInput,
        deferUntil: toPlainDate("2026-09-01"),
        dueDate: toPlainDate("2026-09-03"),
        deadline: toPlainDate("2026-09-05"),
        deadlineTime: toPlainTime("17:00"),
      },
      testContext(),
    );

    expect(task.deferUntil).toBe("2026-09-01");
    expect(task.deadline).toBe("2026-09-05");
    expect(task.deadlineTime).toBe("17:00");
    expect(dateOrderWarnings(task)).toEqual([]);

    expect(() =>
      createTask({ ...baseInput, deadlineTime: toPlainTime("17:00") }, testContext()),
    ).toThrow(/deadline time requires a deadline/);
  });

  it("clears the deadline time with the deadline and records the fields as changes", () => {
    const dated = updateTaskFields(
      inboxTask(),
      { deadline: toPlainDate("2026-09-05"), deadlineTime: toPlainTime("17:00") },
      testContext(),
    );
    expect(dated.version).toBe(2);
    expect(materialChanges(dated, inboxTask())).toEqual({
      deadline: { from: null, to: "2026-09-05" },
      deadlineTime: { from: null, to: "17:00" },
    });

    const cleared = updateTaskFields(dated, { deadline: null }, testContext());
    expect(cleared.deadline).toBeNull();
    expect(cleared.deadlineTime).toBeNull();

    const deferred = updateTaskFields(
      cleared,
      { deferUntil: toPlainDate("2026-09-10") },
      testContext(),
    );
    expect(deferred.deferUntil).toBe("2026-09-10");
    expect(materialChanges(deferred, cleared)).toEqual({
      deferUntil: { from: null, to: "2026-09-10" },
    });
  });

  it("warns about an unusual date order instead of rejecting it", () => {
    const task = updateTaskFields(
      inboxTask(),
      {
        deferUntil: toPlainDate("2026-09-10"),
        dueDate: toPlainDate("2026-09-03"),
        deadline: toPlainDate("2026-09-01"),
      },
      testContext(),
    );

    expect(dateOrderWarnings(task)).toEqual([
      "defer_after_due",
      "due_after_deadline",
      "defer_after_deadline",
    ]);
    expect(dateOrderWarnings(inboxTask())).toEqual([]);
  });

  it("judges deferral and past deadline by date comparison at read time", () => {
    const task = inboxTask({
      deferUntil: toPlainDate("2026-09-10"),
      deadline: toPlainDate("2026-09-05"),
    });

    expect(isDeferred(task, toPlainDate("2026-09-09"))).toBe(true);
    expect(isDeferred(task, toPlainDate("2026-09-10"))).toBe(false);
    expect(isPastDeadline(task, toPlainDate("2026-09-05"))).toBe(false);
    expect(isPastDeadline(task, toPlainDate("2026-09-06"))).toBe(true);
    expect(isDeferred(inboxTask(), toPlainDate("2026-09-09"))).toBe(false);
  });

  it("moves the defer date and deadline with the due date on spawn and skip, and drops them without one", () => {
    const weekly = { freq: "weekly" as const, weekdays: ["thu" as const] };
    const windowed = createTask(
      {
        ...baseInput,
        deferUntil: toPlainDate("2026-08-31"),
        dueDate: toPlainDate("2026-09-03"),
        deadline: toPlainDate("2026-09-05"),
        deadlineTime: toPlainTime("17:00"),
        recurrence: weekly,
      },
      testContext(),
    );

    // Spawned on the due date: the next Thursday, with the window shifted by a week.
    expect(spawnNextOccurrence(windowed, toPlainDate("2026-09-03"))).toMatchObject({
      dueDate: "2026-09-10",
      deferUntil: "2026-09-07",
      deadline: "2026-09-12",
      deadlineTime: "17:00",
    });
    // Skipping moves the same task the same way.
    expect(
      skipOccurrence(windowed, toPlainDate("2026-09-03"), testContext()),
    ).toMatchObject({
      dueDate: "2026-09-10",
      deferUntil: "2026-09-07",
      deadline: "2026-09-12",
      deadlineTime: "17:00",
    });

    // Without a due date nothing anchors the window: a new occurrence starts without
    // it, while a skipped task keeps its own dates.
    const unanchored = createTask(
      {
        ...baseInput,
        deferUntil: toPlainDate("2026-08-31"),
        deadline: toPlainDate("2026-09-05"),
        recurrence: weekly,
      },
      testContext(),
    );
    expect(spawnNextOccurrence(unanchored, toPlainDate("2026-09-03"))).toMatchObject({
      deferUntil: null,
      deadline: null,
      deadlineTime: null,
    });
    expect(
      skipOccurrence(unanchored, toPlainDate("2026-09-03"), testContext()),
    ).toMatchObject({ deferUntil: "2026-08-31", deadline: "2026-09-05" });
  });
});
