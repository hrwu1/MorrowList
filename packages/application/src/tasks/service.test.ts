import { fixedClock, uuidv7 } from "@morrowlist/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { SCOPES, type ActorContext } from "../shared/actor-context.js";
import {
  buildActorContext,
  createInMemoryUnitOfWork,
  emptyData,
  seedWorkspace,
  statusByCategory,
  type InMemoryUnitOfWork,
  type SeededWorkspace,
} from "../testing/index.js";

import { TaskService } from "./service.js";

const NOW = new Date("2026-08-29T09:00:00.000Z");
const CURSOR_SECRET = "test-cursor-secret";

let unitOfWork: InMemoryUnitOfWork;
let service: TaskService;
let seeded: SeededWorkspace;

function listQuery(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: seeded.workspace.id,
    limit: 50,
    includeSubtasks: true,
    sort: "rank" as const,
    order: "asc" as const,
    ...overrides,
  } as never;
}

beforeEach(() => {
  unitOfWork = createInMemoryUnitOfWork(emptyData());
  seeded = seedWorkspace(unitOfWork.data);
  service = new TaskService({
    unitOfWork,
    clock: fixedClock(NOW),
    cursorSecret: CURSOR_SECRET,
  });
});

describe("TaskService.create", () => {
  it("creates an Inbox task from a title alone with events recorded", async () => {
    // M3 acceptance scenario 1 (spec 37).
    const task = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Prepare research presentation",
    });

    expect(task.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(task.key).toBe("ML-1");
    expect(task.projectId).toBeNull();
    expect(task.statusId).toBeNull();
    expect(task.rank).toBeTruthy();
    expect(task.version).toBe(1);
    expect(task.isCompleted).toBe(false);

    expect(unitOfWork.data.activity).toHaveLength(1);
    expect(unitOfWork.data.activity[0]?.eventType).toBe("task.created");
    expect(unitOfWork.data.outbox).toHaveLength(1);
    expect(unitOfWork.data.outbox[0]?.eventType).toBe("task.created");
    expect(unitOfWork.data.outbox[0]?.correlationId).toBe(seeded.context.requestId);
  });

  it("allocates monotonic task numbers", async () => {
    const first = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "First",
    });
    const second = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Second",
    });

    expect(first.key).toBe("ML-1");
    expect(second.key).toBe("ML-2");
  });

  it("appends new tasks to the end of the Inbox", async () => {
    const first = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "First",
    });
    const second = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Second",
    });

    expect(first.rank < second.rank).toBe(true);
  });

  it("places a task into the project default status when only a project is given", async () => {
    const ready = statusByCategory(seeded.statuses, "ready");

    const task = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Ship the thing",
      projectId: seeded.project.id,
    });

    expect(task.projectId).toBe(seeded.project.id);
    expect(task.statusId).toBe(ready.id);
  });

  it("rejects a status that belongs to another project", async () => {
    const otherProject = seedWorkspace(unitOfWork.data, {
      userId: seeded.userId,
    });

    await expect(
      service.create(seeded.context, {
        workspaceId: seeded.workspace.id,
        title: "Wrong status",
        projectId: seeded.project.id,
        statusId: statusByCategory(otherProject.statuses, "ready").id,
      }),
    ).rejects.toMatchObject({ code: "STATUS_NOT_FOUND" });
  });

  it("defaults the due timezone to the workspace timezone", async () => {
    const task = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Timed",
      dueDate: "2026-09-01",
      dueTime: "09:30",
    });

    expect(task.dueTimezone).toBe(seeded.workspace.timezone);
  });

  it("rolls back the task, activity, and outbox together when the commit fails", async () => {
    // EVT-001: a failure must not leave a task without its events, or events without a task.
    unitOfWork.failNextCommit();

    await expect(
      service.create(seeded.context, {
        workspaceId: seeded.workspace.id,
        title: "Doomed",
      }),
    ).rejects.toThrow(/simulated commit failure/);

    expect(unitOfWork.data.tasks.size).toBe(0);
    expect(unitOfWork.data.activity).toHaveLength(0);
    expect(unitOfWork.data.outbox).toHaveLength(0);
  });
});

describe("TaskService authorization", () => {
  it("hides a task in another workspace behind not-found", async () => {
    // M1 acceptance scenario 2 (spec 35): no data from workspace B may leak.
    const other = seedWorkspace(unitOfWork.data);
    const task = await service.create(other.context, {
      workspaceId: other.workspace.id,
      title: "Secret roadmap",
    });

    await expect(
      service.get(seeded.context, other.workspace.id, task.id),
    ).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
  });

  it("does not return another workspace's task through this workspace", async () => {
    const other = seedWorkspace(unitOfWork.data);
    const task = await service.create(other.context, {
      workspaceId: other.workspace.id,
      title: "Secret roadmap",
    });

    await expect(
      service.get(seeded.context, seeded.workspace.id, task.id),
    ).rejects.toMatchObject({ code: "TASK_NOT_FOUND" });
  });

  it("does not assign this workspace's task to another workspace's project", async () => {
    const other = seedWorkspace(unitOfWork.data);

    await expect(
      service.create(seeded.context, {
        workspaceId: seeded.workspace.id,
        projectId: other.project.id,
        title: "Cross-tenant task",
      }),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });

  it("requires the write scope for an API key actor", async () => {
    const readOnlyKey: ActorContext = buildActorContext({
      actorKind: "api_key",
      actorId: "key_1",
      workspaceIds: [seeded.workspace.id],
      scopes: new Set([SCOPES.tasksRead]),
    });

    await expect(
      service.create(readOnlyKey, {
        workspaceId: seeded.workspace.id,
        title: "Not allowed",
      }),
    ).rejects.toMatchObject({ code: "AUTH_FORBIDDEN" });

    await expect(service.list(readOnlyKey, listQuery())).resolves.toMatchObject({
      data: [],
    });
  });
});

describe("TaskService.update", () => {
  it("increments the version and records an update event", async () => {
    const created = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Draft",
    });

    const updated = await service.update(
      seeded.context,
      seeded.workspace.id,
      created.id,
      { title: "Final", priority: "high" },
    );

    expect(updated.title).toBe("Final");
    expect(updated.priority).toBe("high");
    expect(updated.version).toBe(2);
    expect(unitOfWork.data.activity.map((e) => e.eventType)).toEqual([
      "task.created",
      "task.updated",
    ]);
  });

  it("rejects a stale expected version and changes nothing", async () => {
    // M3 acceptance scenario 2 (spec 37).
    const created = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Draft",
    });
    await service.update(seeded.context, seeded.workspace.id, created.id, {
      title: "Second",
    });

    await expect(
      service.update(seeded.context, seeded.workspace.id, created.id, {
        title: "Third",
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({
      code: "TASK_VERSION_CONFLICT",
      details: { expectedVersion: 1, actualVersion: 2 },
    });

    const current = await service.get(seeded.context, seeded.workspace.id, created.id);
    expect(current.title).toBe("Second");
    expect(current.version).toBe(2);
  });

  it("records no event when the patch changes nothing", async () => {
    const created = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Draft",
    });

    const unchanged = await service.update(
      seeded.context,
      seeded.workspace.id,
      created.id,
      { title: "Draft" },
    );

    expect(unchanged.version).toBe(1);
    expect(unitOfWork.data.activity).toHaveLength(1);
  });
});

describe("TaskService.move and reorder", () => {
  it("moves through Done and back using canonical completion semantics", async () => {
    const ready = statusByCategory(seeded.statuses, "ready");
    const done = statusByCategory(seeded.statuses, "done");
    const task = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      projectId: seeded.project.id,
      statusId: ready.id,
      title: "Ship Dawnflow",
    });

    const completed = await service.move(seeded.context, seeded.workspace.id, task.id, {
      projectId: seeded.project.id,
      statusId: done.id,
      expectedVersion: task.version,
    });
    expect(completed.statusId).toBe(done.id);
    expect(completed.isCompleted).toBe(true);
    expect(completed.completedAt).toBe(NOW.toISOString());

    const reopened = await service.move(seeded.context, seeded.workspace.id, task.id, {
      projectId: seeded.project.id,
      statusId: ready.id,
      expectedVersion: completed.version,
    });
    expect(reopened.statusId).toBe(ready.id);
    expect(reopened.isCompleted).toBe(false);
    expect(reopened.completedAt).toBeNull();
    expect(unitOfWork.data.activity.slice(-2).map((event) => event.eventType)).toEqual([
      "task.moved",
      "task.moved",
    ]);
  });

  it("resolves the destination default status and a rank between valid neighbours", async () => {
    const inProgress = statusByCategory(seeded.statuses, "in_progress");
    const first = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      projectId: seeded.project.id,
      statusId: inProgress.id,
      title: "First",
    });
    const last = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      projectId: seeded.project.id,
      statusId: inProgress.id,
      title: "Last",
    });
    const inbox = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Move me",
    });

    const moved = await service.move(seeded.context, seeded.workspace.id, inbox.id, {
      projectId: seeded.project.id,
      statusId: inProgress.id,
      beforeTaskId: first.id,
      afterTaskId: last.id,
      expectedVersion: inbox.version,
    });
    expect(moved.rank > first.rank && moved.rank < last.rank).toBe(true);

    const returnedToInbox = await service.move(
      seeded.context,
      seeded.workspace.id,
      moved.id,
      { projectId: null, expectedVersion: moved.version },
    );
    const defaulted = await service.move(
      seeded.context,
      seeded.workspace.id,
      moved.id,
      { projectId: seeded.project.id, expectedVersion: returnedToInbox.version },
    );
    expect(defaulted.statusId).toBe(statusByCategory(seeded.statuses, "ready").id);
  });

  it("rejects a neighbour outside the destination scope without changing the task", async () => {
    const ready = statusByCategory(seeded.statuses, "ready");
    const blocked = statusByCategory(seeded.statuses, "blocked");
    const moving = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      projectId: seeded.project.id,
      statusId: ready.id,
      title: "Moving",
    });
    const wrongScope = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      projectId: seeded.project.id,
      statusId: blocked.id,
      title: "Wrong lane",
    });
    const eventCount = unitOfWork.data.activity.length;

    await expect(
      service.move(seeded.context, seeded.workspace.id, moving.id, {
        projectId: seeded.project.id,
        statusId: ready.id,
        beforeTaskId: wrongScope.id,
        expectedVersion: moving.version,
      }),
    ).rejects.toMatchObject({ code: "TASK_VERSION_CONFLICT" });

    const current = await service.get(seeded.context, seeded.workspace.id, moving.id);
    expect(current).toMatchObject({ statusId: ready.id, version: moving.version });
    expect(unitOfWork.data.activity).toHaveLength(eventCount);
  });

  it("reorders only within the current scope and honors expectedVersion", async () => {
    const ready = statusByCategory(seeded.statuses, "ready");
    const first = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      projectId: seeded.project.id,
      statusId: ready.id,
      title: "First",
    });
    const second = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      projectId: seeded.project.id,
      statusId: ready.id,
      title: "Second",
    });

    const reordered = await service.reorder(
      seeded.context,
      seeded.workspace.id,
      second.id,
      { afterTaskId: first.id, expectedVersion: second.version },
    );
    expect(reordered.rank < first.rank).toBe(true);
    expect(reordered.statusId).toBe(ready.id);
    expect(reordered.version).toBe(second.version + 1);

    await expect(
      service.reorder(seeded.context, seeded.workspace.id, reordered.id, {
        expectedVersion: second.version,
      }),
    ).rejects.toMatchObject({ code: "TASK_VERSION_CONFLICT" });
  });
});

describe("TaskService.complete and reopen", () => {
  it("completes an Inbox task without giving it a project", async () => {
    const created = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Call the bank",
    });

    const completed = await service.complete(
      seeded.context,
      seeded.workspace.id,
      created.id,
    );

    expect(completed.isCompleted).toBe(true);
    expect(completed.completedAt).toBe(NOW.toISOString());
    expect(completed.projectId).toBeNull();
    expect(completed.version).toBe(2);
  });

  it("moves a project task into Done and back to its prior status", async () => {
    // M3 acceptance scenario 3 (spec 37).
    const inProgress = statusByCategory(seeded.statuses, "in_progress");
    const done = statusByCategory(seeded.statuses, "done");
    const created = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Build the feature",
      projectId: seeded.project.id,
      statusId: inProgress.id,
    });

    const completed = await service.complete(
      seeded.context,
      seeded.workspace.id,
      created.id,
    );
    expect(completed.statusId).toBe(done.id);
    expect(completed.isCompleted).toBe(true);

    const reopened = await service.reopen(
      seeded.context,
      seeded.workspace.id,
      created.id,
    );
    expect(reopened.completedAt).toBeNull();
    expect(reopened.statusId).toBe(inProgress.id);
  });

  it("respects expectedVersion on completion", async () => {
    const created = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Task",
    });

    await expect(
      service.complete(seeded.context, seeded.workspace.id, created.id, 99),
    ).rejects.toMatchObject({ code: "TASK_VERSION_CONFLICT" });
  });
});

describe("TaskService.delete and restore", () => {
  it("soft deletes and restores, keeping the task out of lists while deleted", async () => {
    const created = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Mistake",
    });

    await service.delete(seeded.context, seeded.workspace.id, created.id);
    expect((await service.list(seeded.context, listQuery())).data).toHaveLength(0);
    await expect(
      service.get(seeded.context, seeded.workspace.id, created.id),
    ).rejects.toMatchObject({ code: "TASK_NOT_FOUND" });

    await service.restore(seeded.context, seeded.workspace.id, created.id);
    expect((await service.list(seeded.context, listQuery())).data).toHaveLength(1);
  });
});

describe("TaskService.list", () => {
  it("returns Inbox tasks in rank order", async () => {
    await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "First",
    });
    await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Second",
    });
    await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "In a project",
      projectId: seeded.project.id,
    });

    const inbox = await service.list(seeded.context, listQuery({ inbox: true }));

    expect(inbox.data.map((task) => task.title)).toEqual(["First", "Second"]);
  });

  it("filters by completion state", async () => {
    const created = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Done soon",
    });
    await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Still open",
    });
    await service.complete(seeded.context, seeded.workspace.id, created.id);

    const open = await service.list(seeded.context, listQuery({ isCompleted: false }));
    const completed = await service.list(
      seeded.context,
      listQuery({ isCompleted: true }),
    );

    expect(open.data.map((t) => t.title)).toEqual(["Still open"]);
    expect(completed.data.map((t) => t.title)).toEqual(["Done soon"]);
  });

  it("hides deleted tasks by default and lists only them for Trash", async () => {
    // Trash is a separate view, not a widened list: a deleted task must never appear
    // beside live ones (spec 8.2 invariant 10, 9.7).
    const trashed = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Thrown away",
    });
    await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Kept",
    });
    await service.delete(seeded.context, seeded.workspace.id, trashed.id);

    const live = await service.list(seeded.context, listQuery());
    const trash = await service.list(seeded.context, listQuery({ deleted: true }));

    expect(live.data.map((t) => t.title)).toEqual(["Kept"]);
    expect(trash.data.map((t) => t.title)).toEqual(["Thrown away"]);
    expect(trash.data[0]?.deletedAt).not.toBeNull();
  });

  it("returns a restored task to the normal list", async () => {
    const task = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Deleted by mistake",
    });
    await service.delete(seeded.context, seeded.workspace.id, task.id);
    await service.restore(seeded.context, seeded.workspace.id, task.id);

    const live = await service.list(seeded.context, listQuery());
    const trash = await service.list(seeded.context, listQuery({ deleted: true }));

    expect(live.data.map((t) => t.title)).toEqual(["Deleted by mistake"]);
    expect(trash.data).toHaveLength(0);
  });

  it("paginates with an opaque cursor", async () => {
    for (let i = 0; i < 5; i++) {
      await service.create(seeded.context, {
        workspaceId: seeded.workspace.id,
        title: `Task ${i}`,
      });
    }

    const first = await service.list(seeded.context, listQuery({ limit: 2 }));
    expect(first.data).toHaveLength(2);
    expect(first.page.hasMore).toBe(true);
    expect(first.page.nextCursor).toBeTruthy();

    const second = await service.list(
      seeded.context,
      listQuery({ limit: 2, cursor: first.page.nextCursor }),
    );
    expect(second.data.map((t) => t.title)).toEqual(["Task 2", "Task 3"]);
  });

  it("rejects a forged cursor", async () => {
    await expect(
      service.list(seeded.context, listQuery({ cursor: "forged.signature" })),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("TaskService.get", () => {
  it("resolves a task by its workspace key", async () => {
    const created = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Findable",
    });

    const byKey = await service.get(seeded.context, seeded.workspace.id, "ML-1");
    expect(byKey.id).toBe(created.id);
  });

  it("reports an unknown id as not found", async () => {
    await expect(
      service.get(seeded.context, seeded.workspace.id, uuidv7()),
    ).rejects.toMatchObject({ code: "TASK_NOT_FOUND" });
  });
});

describe("My Day", () => {
  it("adds a task to the workspace's current day and records both event rows", async () => {
    const task = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Plan me",
    });

    const planned = await service.addToDay(
      seeded.context,
      seeded.workspace.id,
      task.id,
    );

    // NOW is 09:00Z, which is the same calendar day in Europe/Berlin.
    expect(planned.dayPlans).toEqual(["2026-08-29"]);
    // The selection is a relation, not a task edit: no version bump (spec 9.2).
    expect(planned.version).toBe(1);
    expect(unitOfWork.data.dayPlans.size).toBe(1);
    const added = unitOfWork.data.activity.filter(
      (event) => event.eventType === "task.day_added",
    );
    expect(added).toHaveLength(1);
    expect(added[0]?.payload).toEqual({
      taskId: task.id,
      planDate: "2026-08-29",
      source: "manual",
    });
    expect(unitOfWork.data.outbox.at(-1)?.eventType).toBe("task.day_added");
  });

  it("is idempotent: adding the same day twice records one plan and one event", async () => {
    const task = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Twice",
    });

    await service.addToDay(seeded.context, seeded.workspace.id, task.id, {
      date: "2026-08-30",
    });
    const again = await service.addToDay(seeded.context, seeded.workspace.id, task.id, {
      date: "2026-08-30",
    });

    expect(again.dayPlans).toEqual(["2026-08-30"]);
    expect(unitOfWork.data.dayPlans.size).toBe(1);
    expect(
      unitOfWork.data.activity.filter((e) => e.eventType === "task.day_added"),
    ).toHaveLength(1);
  });

  it("captures straight into My Day with addToDay on create", async () => {
    const task = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Captured for today",
      addToDay: "2026-08-29",
    });

    expect(task.dayPlans).toEqual(["2026-08-29"]);
    expect(unitOfWork.data.activity.map((event) => event.eventType)).toEqual([
      "task.created",
      "task.day_added",
    ]);
    expect(unitOfWork.data.activity[1]?.payload).toMatchObject({ source: "capture" });
  });

  it("removes a selection and records the removal; removing again changes nothing", async () => {
    const task = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Remove me",
    });
    await service.addToDay(seeded.context, seeded.workspace.id, task.id);

    const removed = await service.removeFromDay(
      seeded.context,
      seeded.workspace.id,
      task.id,
      "2026-08-29",
    );
    await service.removeFromDay(
      seeded.context,
      seeded.workspace.id,
      task.id,
      "2026-08-29",
    );

    expect(removed.dayPlans).toEqual([]);
    expect(unitOfWork.data.dayPlans.size).toBe(0);
    expect(
      unitOfWork.data.activity.filter((e) => e.eventType === "task.day_removed"),
    ).toHaveLength(1);
  });

  it("does not expose past selections on the task", async () => {
    const task = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "History",
    });
    await service.addToDay(seeded.context, seeded.workspace.id, task.id, {
      date: "2026-08-28",
    });

    const fetched = await service.get(seeded.context, seeded.workspace.id, task.key);

    expect(fetched.dayPlans).toEqual([]);
    expect(unitOfWork.data.dayPlans.size).toBe(1);
  });

  it("rejects a deleted task and a date that is not a real calendar date", async () => {
    const task = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Gone",
    });
    await expect(
      service.addToDay(seeded.context, seeded.workspace.id, task.id, {
        date: "2026-02-30",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    await service.delete(seeded.context, seeded.workspace.id, task.id);
    await expect(
      service.addToDay(seeded.context, seeded.workspace.id, task.id),
    ).rejects.toMatchObject({ code: "TASK_NOT_FOUND" });
  });

  it("rolls back the plan and both event rows together when the commit fails", async () => {
    const task = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Doomed plan",
    });
    const activityBefore = unitOfWork.data.activity.length;
    unitOfWork.failNextCommit();

    await expect(
      service.addToDay(seeded.context, seeded.workspace.id, task.id),
    ).rejects.toThrow("simulated commit failure");

    expect(unitOfWork.data.dayPlans.size).toBe(0);
    expect(unitOfWork.data.activity).toHaveLength(activityBefore);
    expect(unitOfWork.data.outbox).toHaveLength(activityBefore);
  });
});
