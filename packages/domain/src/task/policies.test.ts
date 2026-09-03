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
  completeTask,
  createTask,
  deleteTask,
  materialChanges,
  moveTask,
  reopenTask,
  reorderTask,
  resolveReopenStatus,
  restoreTask,
  setParent,
  updateTaskFields,
} from "./policies.js";
import { isInboxTask, type Task } from "./task.js";
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
