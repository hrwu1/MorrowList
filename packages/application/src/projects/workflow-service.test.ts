import {
  fixedClock,
  rankBetween,
  uuidv7,
  type PlainDate,
  type PlainTime,
  type Task,
} from "@morrowlist/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { SCOPES, type ActorContext } from "../shared/actor-context.js";
import {
  buildActorContext,
  buildTask,
  createInMemoryUnitOfWork,
  emptyData,
  seedWorkspace,
  statusByCategory,
  type InMemoryUnitOfWork,
  type SeededWorkspace,
} from "../testing/index.js";

import { WorkflowService } from "./workflow-service.js";

const NOW = new Date("2026-09-01T10:00:00.000Z");

let unitOfWork: InMemoryUnitOfWork;
let seeded: SeededWorkspace;
let service: WorkflowService;

beforeEach(() => {
  unitOfWork = createInMemoryUnitOfWork(emptyData());
  seeded = seedWorkspace(unitOfWork.data);
  service = new WorkflowService({ unitOfWork, clock: fixedClock(NOW) });
});

function stored(statusId: string) {
  const status = unitOfWork.data.statuses.get(statusId);
  if (!status) throw new Error(`status ${statusId} is gone`);
  return status;
}

function eventsOfType(type: string) {
  return unitOfWork.data.activity.filter((event) => event.eventType === type);
}

describe("WorkflowService.create", () => {
  it("appends a column after the last one and records both event rows", async () => {
    const created = await service.create(
      seeded.context,
      seeded.workspace.id,
      seeded.project.id,
      { name: " Testing ", category: "review", wipLimit: 2, policyMd: "Two eyes." },
    );

    expect(created).toMatchObject({
      name: "Testing",
      category: "review",
      wipLimit: 2,
      isDefault: false,
      isTerminal: false,
      policyMd: "Two eyes.",
      version: 1,
    });
    const listed = await service.list(
      seeded.context,
      seeded.workspace.id,
      seeded.project.id,
    );
    expect(listed.map((status) => status.name).at(-1)).toBe("Testing");

    expect(unitOfWork.data.activity.at(-1)).toMatchObject({
      aggregateType: "status",
      aggregateId: created.id,
      eventType: "workflow_status.created",
    });
    expect(unitOfWork.data.outbox.at(-1)?.eventType).toBe("workflow_status.created");
  });

  it("refuses a column on an archived project", async () => {
    unitOfWork.data.projects.set(seeded.project.id, {
      ...seeded.project,
      archivedAt: NOW,
    });
    await expect(
      service.create(seeded.context, seeded.workspace.id, seeded.project.id, {
        name: "Nope",
        category: "backlog",
      }),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });
});

describe("WorkflowService.update", () => {
  it("renames a column without changing its category or the tasks in it", async () => {
    const done = statusByCategory(seeded.statuses, "done");
    const task = buildTask(seeded, unitOfWork.data, {
      statusId: done.id,
      title: "Shipped",
      completedAt: NOW,
    });

    const updated = await service.update(seeded.context, seeded.workspace.id, done.id, {
      name: "Shipped",
    });

    expect(updated).toMatchObject({ name: "Shipped", category: "done", version: 2 });
    expect(unitOfWork.data.tasks.get(task.id)).toBe(task);
    expect(eventsOfType("workflow_status.updated")).toHaveLength(1);
    expect(eventsOfType("workflow_status.updated")[0]?.payload).toMatchObject({
      statusId: done.id,
      changes: { name: { from: "Done", to: "Shipped" } },
    });
  });

  it("promotes a new default and demotes the previous one in one transaction", async () => {
    const backlog = statusByCategory(seeded.statuses, "backlog");
    const ready = statusByCategory(seeded.statuses, "ready");

    await service.update(seeded.context, seeded.workspace.id, backlog.id, {
      isDefault: true,
    });

    expect(stored(backlog.id)).toMatchObject({ isDefault: true, version: 2 });
    expect(stored(ready.id)).toMatchObject({ isDefault: false, version: 2 });
    // The demotion is recorded first: the database allows one active default at a time.
    expect(eventsOfType("workflow_status.updated").map((e) => e.aggregateId)).toEqual([
      ready.id,
      backlog.id,
    ]);
  });

  it("completes the column's tasks when its category becomes Done", async () => {
    const review = statusByCategory(seeded.statuses, "review");
    const open = buildTask(seeded, unitOfWork.data, {
      statusId: review.id,
      title: "Open",
    });
    // A second Done column keeps the workflow valid when Review flips category.
    await service.update(seeded.context, seeded.workspace.id, review.id, {
      category: "done",
    });

    expect(unitOfWork.data.tasks.get(open.id)).toMatchObject({
      statusId: review.id,
      completedAt: NOW,
      version: 2,
    });
    expect(eventsOfType("task.completed")).toHaveLength(1);
  });

  it("reopens the column's tasks when its category leaves Done", async () => {
    const done = statusByCategory(seeded.statuses, "done");
    const review = statusByCategory(seeded.statuses, "review");
    const completed = buildTask(seeded, unitOfWork.data, {
      statusId: done.id,
      title: "Completed",
      completedAt: NOW,
    });
    await service.update(seeded.context, seeded.workspace.id, review.id, {
      category: "done",
    });

    await service.update(seeded.context, seeded.workspace.id, done.id, {
      category: "backlog",
    });

    expect(unitOfWork.data.tasks.get(completed.id)).toMatchObject({
      statusId: done.id,
      completedAt: null,
    });
    expect(eventsOfType("task.reopened")).toHaveLength(1);
  });

  it("cancels a task's pending reminder when its column becomes Done and restores it when the column leaves Done", async () => {
    const done = statusByCategory(seeded.statuses, "done");
    const review = statusByCategory(seeded.statuses, "review");
    // 12:00 Berlin (UTC+2), 30 minutes ahead: 09:30Z.
    const timed = buildTask(seeded, unitOfWork.data, {
      statusId: review.id,
      title: "Timed",
      dueDate: "2026-09-02" as PlainDate,
      dueTime: "12:00" as PlainTime,
      dueTimezone: "Europe/Berlin",
      reminderOffsetMinutes: 30,
    });
    const remindAt = new Date("2026-09-02T09:30:00.000Z");
    unitOfWork.data.reminders.set(timed.id, {
      taskId: timed.id,
      workspaceId: seeded.workspace.id,
      remindAt,
      offsetMinutes: 30,
      deliveredAt: null,
    });

    await service.update(seeded.context, seeded.workspace.id, review.id, {
      category: "done",
    });
    expect(unitOfWork.data.tasks.get(timed.id)?.completedAt).toEqual(NOW);
    expect(unitOfWork.data.reminders.has(timed.id)).toBe(false);

    // Leaving Done reopens the task; the reminder comes back in the same transaction.
    await service.update(seeded.context, seeded.workspace.id, review.id, {
      category: "review",
    });
    expect(unitOfWork.data.tasks.get(timed.id)?.completedAt).toBeNull();
    expect(unitOfWork.data.reminders.get(timed.id)).toMatchObject({
      remindAt,
      offsetMinutes: 30,
      deliveredAt: null,
    });

    // Archiving Review into Done completes the task through the move policy too.
    await service.archive(seeded.context, seeded.workspace.id, review.id, {
      destinationStatusId: done.id,
    });
    expect(unitOfWork.data.tasks.get(timed.id)).toMatchObject({
      statusId: done.id,
      completedAt: NOW,
    });
    expect(unitOfWork.data.reminders.has(timed.id)).toBe(false);
  });

  it("rejects an invariant violation and persists nothing", async () => {
    const done = statusByCategory(seeded.statuses, "done");
    const activityBefore = unitOfWork.data.activity.length;

    await expect(
      service.update(seeded.context, seeded.workspace.id, done.id, {
        category: "review",
      }),
    ).rejects.toMatchObject({
      code: "WORKFLOW_INVARIANT_VIOLATED",
      details: { invariant: "terminal_required" },
    });
    expect(stored(done.id).version).toBe(1);
    expect(unitOfWork.data.activity).toHaveLength(activityBefore);
  });

  it("rejects a stale expected version", async () => {
    const ready = statusByCategory(seeded.statuses, "ready");
    await expect(
      service.update(seeded.context, seeded.workspace.id, ready.id, {
        name: "Next up",
        expectedVersion: 7,
      }),
    ).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      details: { statusId: ready.id, expectedVersion: 7, actualVersion: 1 },
    });
  });

  it("does not bump the version or record an event when nothing changed", async () => {
    const ready = statusByCategory(seeded.statuses, "ready");
    const before = unitOfWork.data.activity.length;
    const result = await service.update(seeded.context, seeded.workspace.id, ready.id, {
      name: "Ready",
    });
    expect(result.version).toBe(1);
    expect(unitOfWork.data.activity).toHaveLength(before);
  });
});

describe("WorkflowService.reorder", () => {
  it("places a column between two neighbours and records the event", async () => {
    const backlog = statusByCategory(seeded.statuses, "backlog");
    const ready = statusByCategory(seeded.statuses, "ready");
    const review = statusByCategory(seeded.statuses, "review");

    const moved = await service.reorder(
      seeded.context,
      seeded.workspace.id,
      review.id,
      {
        beforeStatusId: backlog.id,
        afterStatusId: ready.id,
      },
    );

    expect(moved.rank > backlog.rank && moved.rank < ready.rank).toBe(true);
    const listed = await service.list(
      seeded.context,
      seeded.workspace.id,
      seeded.project.id,
    );
    expect(listed.map((status) => status.name)).toEqual([
      "Backlog",
      "In Review",
      "Ready",
      "In Progress",
      "Blocked",
      "Done",
    ]);
    expect(unitOfWork.data.activity.at(-1)).toMatchObject({
      eventType: "workflow_status.reordered",
      payload: { beforeStatusId: backlog.id, afterStatusId: ready.id },
    });
  });
});

describe("WorkflowService.archive", () => {
  it("moves every task, trashed ones included, then archives the column", async () => {
    const ready = statusByCategory(seeded.statuses, "ready");
    const backlog = statusByCategory(seeded.statuses, "backlog");
    const progress = statusByCategory(seeded.statuses, "in_progress");
    const existing = buildTask(seeded, unitOfWork.data, {
      statusId: progress.id,
      title: "Already in progress",
    });
    const first = buildTask(seeded, unitOfWork.data, {
      statusId: ready.id,
      title: "First",
      rank: "a0",
    });
    const second = buildTask(seeded, unitOfWork.data, {
      statusId: ready.id,
      title: "Second",
      rank: rankBetween("a0", null),
    });
    const trashed = buildTask(seeded, unitOfWork.data, {
      statusId: ready.id,
      title: "Trashed",
      rank: rankBetween(rankBetween("a0", null), null),
      deletedAt: NOW,
      deletedBy: { kind: "user", id: seeded.userId },
    });

    const archived = await service.archive(
      seeded.context,
      seeded.workspace.id,
      ready.id,
      {
        destinationStatusId: progress.id,
        newDefaultStatusId: backlog.id,
      },
    );

    expect(archived).toMatchObject({
      id: ready.id,
      archivedAt: NOW.toISOString(),
      isDefault: false,
      version: 2,
    });
    expect(stored(backlog.id)).toMatchObject({ isDefault: true, version: 2 });

    const moved = [first, second, trashed].map((task) =>
      unitOfWork.data.tasks.get(task.id),
    );
    expect(moved.every((task) => task?.statusId === progress.id)).toBe(true);
    const ranks = [existing, first, second, trashed].map(
      (task) => unitOfWork.data.tasks.get(task.id)?.rank as string,
    );
    expect(ranks).toEqual([...ranks].sort());
    expect(unitOfWork.data.tasks.get(trashed.id)?.deletedAt).toEqual(NOW);

    expect(eventsOfType("task.moved")).toHaveLength(3);
    expect(eventsOfType("workflow_status.archived")[0]?.payload).toMatchObject({
      statusId: ready.id,
      destinationStatusId: progress.id,
      newDefaultStatusId: backlog.id,
      movedTaskIds: [first.id, second.id, trashed.id],
    });
    const listed = await service.list(
      seeded.context,
      seeded.workspace.id,
      seeded.project.id,
    );
    expect(listed.map((status) => status.id)).not.toContain(ready.id);
  });

  it("makes the destination the default when the default column is archived", async () => {
    const ready = statusByCategory(seeded.statuses, "ready");
    const backlog = statusByCategory(seeded.statuses, "backlog");
    buildTask(seeded, unitOfWork.data, { statusId: ready.id, title: "Task" });

    await service.archive(seeded.context, seeded.workspace.id, ready.id, {
      destinationStatusId: backlog.id,
    });

    expect(stored(backlog.id).isDefault).toBe(true);
    expect(
      [...unitOfWork.data.statuses.values()].filter(
        (status) => status.isDefault && status.archivedAt === null,
      ),
    ).toHaveLength(1);
  });

  it("requires a destination when the column has tasks and a replacement for the default", async () => {
    const ready = statusByCategory(seeded.statuses, "ready");
    const blocked = statusByCategory(seeded.statuses, "blocked");
    buildTask(seeded, unitOfWork.data, { statusId: blocked.id, title: "Stuck" });

    await expect(
      service.archive(seeded.context, seeded.workspace.id, blocked.id, {}),
    ).rejects.toMatchObject({ code: "STATUS_ARCHIVE_REQUIRES_DESTINATION" });
    await expect(
      service.archive(seeded.context, seeded.workspace.id, ready.id, {}),
    ).rejects.toMatchObject({ code: "STATUS_ARCHIVE_REQUIRES_REPLACEMENT" });
    expect(stored(blocked.id).archivedAt).toBeNull();
    expect(stored(ready.id).archivedAt).toBeNull();
  });

  it("refuses to archive the last Done column", async () => {
    const done = statusByCategory(seeded.statuses, "done");
    await expect(
      service.archive(seeded.context, seeded.workspace.id, done.id, {}),
    ).rejects.toMatchObject({
      code: "WORKFLOW_INVARIANT_VIOLATED",
      details: { invariant: "terminal_required" },
    });
  });

  it("rolls back the moved tasks, both statuses, and every event row together", async () => {
    const ready = statusByCategory(seeded.statuses, "ready");
    const backlog = statusByCategory(seeded.statuses, "backlog");
    const task = buildTask(seeded, unitOfWork.data, { statusId: ready.id, title: "T" });
    const before = {
      activity: unitOfWork.data.activity.length,
      outbox: unitOfWork.data.outbox.length,
    };
    unitOfWork.failNextCommit();

    await expect(
      service.archive(seeded.context, seeded.workspace.id, ready.id, {
        destinationStatusId: backlog.id,
      }),
    ).rejects.toThrow(/simulated commit failure/);

    expect(unitOfWork.data.tasks.get(task.id)).toMatchObject({
      statusId: ready.id,
      version: 1,
    });
    expect(stored(ready.id)).toMatchObject({ archivedAt: null, isDefault: true });
    expect(stored(backlog.id)).toMatchObject({ isDefault: false, version: 1 });
    expect(unitOfWork.data.activity).toHaveLength(before.activity);
    expect(unitOfWork.data.outbox).toHaveLength(before.outbox);
  });
});

describe("WorkflowService status intervals", () => {
  const ENTERED = new Date("2026-08-29T08:00:00.000Z");

  /** The open interval the task would have if it had arrived through TaskService. */
  function openInterval(task: Task) {
    const status = stored(task.statusId as string);
    unitOfWork.data.intervals.push({
      id: uuidv7(),
      taskId: task.id,
      workspaceId: task.workspaceId,
      projectId: task.projectId as string,
      statusId: status.id,
      category: status.category,
      enteredAt: ENTERED,
      leftAt: null,
    });
  }
  const intervalsOf = (taskId: string) =>
    unitOfWork.data.intervals
      .filter((row) => row.taskId === taskId)
      .map((row) => ({
        statusId: row.statusId,
        category: row.category,
        enteredAt: row.enteredAt,
        leftAt: row.leftAt,
      }));

  it("closes each moved task's stay and opens one in the destination on archive", async () => {
    const ready = statusByCategory(seeded.statuses, "ready");
    const backlog = statusByCategory(seeded.statuses, "backlog");
    const progress = statusByCategory(seeded.statuses, "in_progress");
    const live = buildTask(seeded, unitOfWork.data, {
      statusId: ready.id,
      title: "Live",
    });
    openInterval(live);
    // Trashed work has no open interval and must not gain one from the move.
    const trashed = buildTask(seeded, unitOfWork.data, {
      statusId: ready.id,
      title: "Trashed",
      rank: rankBetween("a0", null),
      deletedAt: ENTERED,
      deletedBy: { kind: "user", id: seeded.userId },
    });

    await service.archive(seeded.context, seeded.workspace.id, ready.id, {
      destinationStatusId: progress.id,
      newDefaultStatusId: backlog.id,
    });

    expect(intervalsOf(live.id)).toEqual([
      { statusId: ready.id, category: "ready", enteredAt: ENTERED, leftAt: NOW },
      { statusId: progress.id, category: "in_progress", enteredAt: NOW, leftAt: null },
    ]);
    expect(intervalsOf(trashed.id)).toEqual([]);
  });

  it("re-enters the column when its category crosses the Done boundary either way", async () => {
    const review = statusByCategory(seeded.statuses, "review");
    const task = buildTask(seeded, unitOfWork.data, {
      statusId: review.id,
      title: "Under review",
    });
    openInterval(task);

    await service.update(seeded.context, seeded.workspace.id, review.id, {
      category: "done",
    });
    expect(intervalsOf(task.id)).toEqual([
      { statusId: review.id, category: "review", enteredAt: ENTERED, leftAt: NOW },
      { statusId: review.id, category: "done", enteredAt: NOW, leftAt: null },
    ]);

    await service.update(seeded.context, seeded.workspace.id, review.id, {
      category: "review",
    });
    expect(intervalsOf(task.id).map((row) => [row.category, row.leftAt])).toEqual([
      ["review", NOW],
      ["done", NOW],
      ["review", null],
    ]);
    expect(unitOfWork.data.tasks.get(task.id)?.completedAt).toBeNull();
  });

  it("leaves intervals alone when a column edit does not change its category", async () => {
    const ready = statusByCategory(seeded.statuses, "ready");
    const task = buildTask(seeded, unitOfWork.data, {
      statusId: ready.id,
      title: "Stays",
    });
    openInterval(task);

    await service.update(seeded.context, seeded.workspace.id, ready.id, {
      name: "Next up",
      wipLimit: 2,
    });

    expect(intervalsOf(task.id)).toEqual([
      { statusId: ready.id, category: "ready", enteredAt: ENTERED, leftAt: null },
    ]);
  });
});

describe("WorkflowService authorization", () => {
  it("hides statuses of another workspace and requires the write scope", async () => {
    const ready = statusByCategory(seeded.statuses, "ready");
    const outsider = buildActorContext({ workspaceIds: ["someone-else"] });
    await expect(
      service.update(outsider, seeded.workspace.id, ready.id, { name: "X" }),
    ).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });

    const other = seedWorkspace(unitOfWork.data, {
      workspace: { slug: "other", name: "Other" },
    });
    await expect(
      service.update(other.context, other.workspace.id, ready.id, { name: "X" }),
    ).rejects.toMatchObject({ code: "STATUS_NOT_FOUND" });

    const reader: ActorContext = buildActorContext({
      actorKind: "api_key",
      workspaceIds: [seeded.workspace.id],
      scopes: new Set([SCOPES.projectsRead]),
    });
    await expect(
      service.list(reader, seeded.workspace.id, seeded.project.id),
    ).resolves.toHaveLength(6);
    await expect(
      service.update(reader, seeded.workspace.id, ready.id, { name: "X" }),
    ).rejects.toMatchObject({ code: "AUTH_FORBIDDEN" });
  });
});
