import { fixedClock, uuidv7 } from "@morrowlist/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { SCOPES, type ActorContext } from "../shared/actor-context.js";
import { TagService } from "../tags/service.js";
import {
  buildActorContext,
  buildDefaultWorkflow,
  buildProject,
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

describe("TaskService.create with a parent", () => {
  it("defaults a subtask to its parent's project unless told otherwise", async () => {
    const ready = statusByCategory(seeded.statuses, "ready");
    const parent = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Parent",
      projectId: seeded.project.id,
    });

    const defaulted = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Inherits the project",
      parentTaskId: parent.id,
    });
    expect(defaulted.parentTaskId).toBe(parent.id);
    expect(defaulted.projectId).toBe(seeded.project.id);
    expect(defaulted.statusId).toBe(ready.id);

    const inbox = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Explicitly in the Inbox",
      parentTaskId: parent.id,
      projectId: null,
    });
    expect(inbox.parentTaskId).toBe(parent.id);
    expect(inbox.projectId).toBeNull();

    const fetched = await service.get(seeded.context, seeded.workspace.id, parent.id);
    expect(fetched.subtaskProgress).toEqual({ completed: 0, total: 2 });
  });

  it("rejects a fourth nesting level", async () => {
    const workspaceId = seeded.workspace.id;
    const root = await service.create(seeded.context, { workspaceId, title: "1" });
    const second = await service.create(seeded.context, {
      workspaceId,
      title: "2",
      parentTaskId: root.id,
    });
    const third = await service.create(seeded.context, {
      workspaceId,
      title: "3",
      parentTaskId: second.id,
    });

    await expect(
      service.create(seeded.context, {
        workspaceId,
        title: "4",
        parentTaskId: third.id,
      }),
    ).rejects.toMatchObject({ code: "TASK_NESTING_LIMIT_EXCEEDED" });
    expect(unitOfWork.data.tasks.size).toBe(3);
  });
});

describe("TaskService.setParent and clearParent", () => {
  async function twoTasks() {
    const workspaceId = seeded.workspace.id;
    const parent = await service.create(seeded.context, {
      workspaceId,
      title: "Parent",
    });
    const child = await service.create(seeded.context, { workspaceId, title: "Child" });
    return { workspaceId, parent, child };
  }

  it("attaches, records the parent-changed event, and detaches again", async () => {
    const { workspaceId, parent, child } = await twoTasks();

    const attached = await service.setParent(seeded.context, workspaceId, child.id, {
      parentTaskId: parent.id,
    });
    expect(attached.parentTaskId).toBe(parent.id);
    expect(attached.version).toBe(2);

    const event = unitOfWork.data.activity.at(-1);
    expect(event?.eventType).toBe("task.parent_changed");
    expect(event?.payload).toEqual({
      taskId: child.id,
      previousParentId: null,
      parentId: parent.id,
    });
    expect(unitOfWork.data.outbox.at(-1)?.eventType).toBe("task.parent_changed");

    const listed = await service.list(seeded.context, listQuery({ inbox: true }));
    expect(listed.data.find((task) => task.id === parent.id)?.subtaskProgress).toEqual({
      completed: 0,
      total: 1,
    });

    const detached = await service.clearParent(seeded.context, workspaceId, child.id);
    expect(detached.parentTaskId).toBeNull();
    expect(detached.version).toBe(3);
    expect(unitOfWork.data.activity.at(-1)?.payload).toEqual({
      taskId: child.id,
      previousParentId: parent.id,
      parentId: null,
    });
    // Detaching a task with no parent is not a change and records nothing.
    const eventCount = unitOfWork.data.activity.length;
    await service.clearParent(seeded.context, workspaceId, child.id);
    expect(unitOfWork.data.activity).toHaveLength(eventCount);
  });

  it("rolls back the parent change with both event rows when the commit fails", async () => {
    const { workspaceId, parent, child } = await twoTasks();
    const eventsBefore = unitOfWork.data.activity.length;
    unitOfWork.failNextCommit();

    await expect(
      service.setParent(seeded.context, workspaceId, child.id, {
        parentTaskId: parent.id,
      }),
    ).rejects.toThrow(/simulated commit failure/);

    expect(unitOfWork.data.tasks.get(child.id)?.parentTaskId).toBeNull();
    expect(unitOfWork.data.tasks.get(child.id)?.version).toBe(1);
    expect(unitOfWork.data.activity).toHaveLength(eventsBefore);
    expect(unitOfWork.data.outbox).toHaveLength(eventsBefore);
  });

  it("rejects a cycle and a tree deeper than three levels", async () => {
    const { workspaceId, parent, child } = await twoTasks();
    const grandchild = await service.create(seeded.context, {
      workspaceId,
      title: "Grandchild",
      parentTaskId: child.id,
    });
    await service.setParent(seeded.context, workspaceId, child.id, {
      parentTaskId: parent.id,
    });

    await expect(
      service.setParent(seeded.context, workspaceId, parent.id, {
        parentTaskId: grandchild.id,
      }),
    ).rejects.toMatchObject({ code: "TASK_RELATION_CYCLE" });

    // Hanging the root under a new task would make the grandchild a fourth level.
    const newRoot = await service.create(seeded.context, {
      workspaceId,
      title: "Root",
    });
    await expect(
      service.setParent(seeded.context, workspaceId, parent.id, {
        parentTaskId: newRoot.id,
      }),
    ).rejects.toMatchObject({ code: "TASK_NESTING_LIMIT_EXCEEDED" });
    expect(unitOfWork.data.tasks.get(parent.id)?.parentTaskId).toBeNull();
  });

  it("honours expectedVersion and hides a foreign parent behind not-found", async () => {
    const { workspaceId, parent, child } = await twoTasks();

    await expect(
      service.setParent(seeded.context, workspaceId, child.id, {
        parentTaskId: parent.id,
        expectedVersion: 7,
      }),
    ).rejects.toMatchObject({ code: "TASK_VERSION_CONFLICT" });

    const other = seedWorkspace(unitOfWork.data, { userId: seeded.userId });
    const foreign = await service.create(other.context, {
      workspaceId: other.workspace.id,
      title: "Elsewhere",
    });
    await expect(
      service.setParent(seeded.context, workspaceId, child.id, {
        parentTaskId: foreign.id,
      }),
    ).rejects.toMatchObject({ code: "TASK_NOT_FOUND" });
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

    const { task: completed } = await service.move(
      seeded.context,
      seeded.workspace.id,
      task.id,
      {
        projectId: seeded.project.id,
        statusId: done.id,
        expectedVersion: task.version,
      },
    );
    expect(completed.statusId).toBe(done.id);
    expect(completed.isCompleted).toBe(true);
    expect(completed.completedAt).toBe(NOW.toISOString());

    const { task: reopened } = await service.move(
      seeded.context,
      seeded.workspace.id,
      task.id,
      {
        projectId: seeded.project.id,
        statusId: ready.id,
        expectedVersion: completed.version,
      },
    );
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

    const { task: moved } = await service.move(
      seeded.context,
      seeded.workspace.id,
      inbox.id,
      {
        projectId: seeded.project.id,
        statusId: inProgress.id,
        beforeTaskId: first.id,
        afterTaskId: last.id,
        expectedVersion: inbox.version,
      },
    );
    expect(moved.rank > first.rank && moved.rank < last.rank).toBe(true);

    const { task: returnedToInbox } = await service.move(
      seeded.context,
      seeded.workspace.id,
      moved.id,
      { projectId: null, expectedVersion: moved.version },
    );
    const { task: defaulted } = await service.move(
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

    const { task: reopened } = await service.reopen(
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
      service.complete(seeded.context, seeded.workspace.id, created.id, {
        expectedVersion: 99,
      }),
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

describe("TaskService tags", () => {
  async function createTag(name: string) {
    const tags = new TagService({ unitOfWork, clock: fixedClock(NOW) });
    return tags.create(seeded.context, seeded.workspace.id, { name });
  }

  it("adds and removes a tag with events and without bumping the version", async () => {
    const task = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Tagged",
    });
    const tag = await createTag("Deep Work");

    const tagged = await service.addTag(
      seeded.context,
      seeded.workspace.id,
      task.id,
      tag.id,
    );
    expect(tagged.tags.map((t) => t.name)).toEqual(["Deep Work"]);
    expect(tagged.version).toBe(task.version);

    const untagged = await service.removeTag(
      seeded.context,
      seeded.workspace.id,
      task.id,
      tag.id,
    );
    expect(untagged.tags).toEqual([]);

    const events = unitOfWork.data.activity
      .filter((event) => event.aggregateId === task.id)
      .map((event) => event.eventType);
    expect(events).toEqual(["task.created", "task.tag_added", "task.tag_removed"]);
    expect(unitOfWork.data.outbox.at(-1)).toMatchObject({
      eventType: "task.tag_removed",
      payload: { taskId: task.id, tagId: tag.id, tagName: "Deep Work" },
    });
  });

  it("orders a task's tags by name regardless of when they were added", async () => {
    const task = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Ordered",
    });
    for (const name of ["zulu", "Alpha", "mike"]) {
      const tag = await createTag(name);
      await service.addTag(seeded.context, seeded.workspace.id, task.id, tag.id);
    }

    const fetched = await service.get(seeded.context, seeded.workspace.id, task.id);
    expect(fetched.tags.map((tag) => tag.name)).toEqual(["Alpha", "mike", "zulu"]);
  });

  it("treats adding a tag twice as a no-op and caps a task at twenty tags", async () => {
    const task = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Crowded",
    });
    const first = await createTag("tag-0");
    await service.addTag(seeded.context, seeded.workspace.id, task.id, first.id);
    await service.addTag(seeded.context, seeded.workspace.id, task.id, first.id);
    expect(
      unitOfWork.data.activity.filter((e) => e.eventType === "task.tag_added"),
    ).toHaveLength(1);

    for (let index = 1; index < 20; index++) {
      const tag = await createTag(`tag-${index}`);
      await service.addTag(seeded.context, seeded.workspace.id, task.id, tag.id);
    }
    const overflow = await createTag("tag-20");
    await expect(
      service.addTag(seeded.context, seeded.workspace.id, task.id, overflow.id),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("reports an unknown tag and a tag from another workspace as not found", async () => {
    const task = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Lonely",
    });
    const other = seedWorkspace(unitOfWork.data);
    const foreign = await new TagService({ unitOfWork, clock: fixedClock(NOW) }).create(
      other.context,
      other.workspace.id,
      { name: "Foreign" },
    );

    await expect(
      service.addTag(seeded.context, seeded.workspace.id, task.id, foreign.id),
    ).rejects.toMatchObject({ code: "TAG_NOT_FOUND" });
    await expect(
      service.removeTag(seeded.context, seeded.workspace.id, task.id, uuidv7()),
    ).rejects.toMatchObject({ code: "TAG_NOT_FOUND" });
  });

  it("keeps tags through moves, completion, deletion, and restore", async () => {
    // Spec 8.5: completing and reopening remove no tags; the same holds for Trash.
    const tag = await createTag("Sticky");
    const task = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Travels",
    });
    await service.addTag(seeded.context, seeded.workspace.id, task.id, tag.id);

    const { task: moved } = await service.move(
      seeded.context,
      seeded.workspace.id,
      task.id,
      {
        projectId: seeded.project.id,
        statusId: statusByCategory(seeded.statuses, "ready").id,
      },
    );
    expect(moved.tags.map((t) => t.name)).toEqual(["Sticky"]);

    const completed = await service.complete(
      seeded.context,
      seeded.workspace.id,
      task.id,
    );
    expect(completed.tags.map((t) => t.name)).toEqual(["Sticky"]);

    await service.delete(seeded.context, seeded.workspace.id, task.id);
    const restored = await service.restore(
      seeded.context,
      seeded.workspace.id,
      task.id,
    );
    expect(restored.tags.map((t) => t.name)).toEqual(["Sticky"]);
  });

  it("filters a list by tag", async () => {
    const tag = await createTag("Errands");
    const tagged = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Buy milk",
    });
    await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Write essay",
    });
    await service.addTag(seeded.context, seeded.workspace.id, tagged.id, tag.id);

    const page = await service.list(seeded.context, listQuery({ tagId: tag.id }));
    expect(page.data.map((task) => task.title)).toEqual(["Buy milk"]);
    expect(page.data[0]?.tags.map((t) => t.name)).toEqual(["Errands"]);
  });

  it("rolls back the association and both event rows together", async () => {
    const tag = await createTag("Doomed");
    const task = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Rolled back",
    });
    const before = unitOfWork.data.activity.length;
    unitOfWork.failNextCommit();

    await expect(
      service.addTag(seeded.context, seeded.workspace.id, task.id, tag.id),
    ).rejects.toThrow(/simulated commit failure/);

    expect(unitOfWork.data.taskTags).toHaveLength(0);
    expect(unitOfWork.data.activity).toHaveLength(before);
    expect(unitOfWork.data.outbox).toHaveLength(before);
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

describe("TaskService relations", () => {
  const workspaceId = () => seeded.workspace.id;
  const create = (title: string) =>
    service.create(seeded.context, { workspaceId: workspaceId(), title });
  const blocks = (source: { id: string }, target: { id: string }) =>
    service.addRelation(seeded.context, workspaceId(), source.id, {
      type: "blocks",
      targetTaskId: target.id,
    });

  it("adds a blocks relation seen from both ends, with history on both tasks", async () => {
    const a = await create("Collect sources");
    const b = await create("Make slides");

    const source = await blocks(a, b);
    expect(source.relations).toEqual([
      expect.objectContaining({
        type: "blocks",
        sourceTaskId: a.id,
        targetTaskId: b.id,
        task: { id: b.id, key: "ML-2", title: "Make slides", isCompleted: false },
      }),
    ]);
    // A relation is not a task column: neither version moves (spec 8.2 invariant 12).
    expect(source.version).toBe(1);
    expect(source.isBlocked).toBe(false);

    const target = await service.get(seeded.context, workspaceId(), b.id);
    expect(target.isBlocked).toBe(true);
    expect(target.relations[0]?.task.key).toBe("ML-1");
    expect(target.version).toBe(1);

    const events = unitOfWork.data.activity.filter(
      (event) => event.eventType === "task.relation_added",
    );
    expect(events.map((event) => [event.aggregateId, event.summary])).toEqual([
      [a.id, "Added relation: blocks ML-2"],
      [b.id, "Added relation: blocked by ML-1"],
    ]);
    expect(
      unitOfWork.data.outbox.filter((e) => e.eventType === "task.relation_added"),
    ).toHaveLength(2);
  });

  it("stores related_to once in canonical order and ignores a duplicate", async () => {
    const a = await create("A");
    const b = await create("B");
    const [low, high] = [a.id, b.id].sort();

    const first = await service.addRelation(seeded.context, workspaceId(), b.id, {
      type: "related_to",
      targetTaskId: a.id,
    });
    expect(first.relations[0]).toMatchObject({
      type: "related_to",
      sourceTaskId: low,
      targetTaskId: high,
    });
    const again = await service.addRelation(seeded.context, workspaceId(), a.id, {
      type: "related_to",
      targetTaskId: b.id,
    });
    expect(again.relations).toHaveLength(1);
    expect(unitOfWork.data.relations.size).toBe(1);
    expect(
      unitOfWork.data.activity.filter((e) => e.eventType === "task.relation_added"),
    ).toHaveLength(2);
  });

  it("rejects a direct and a transitive blocks cycle, and a self relation", async () => {
    const a = await create("A");
    const b = await create("B");
    const c = await create("C");
    await blocks(a, b);

    await expect(blocks(b, a)).rejects.toMatchObject({ code: "TASK_RELATION_CYCLE" });
    await blocks(b, c);
    await expect(blocks(c, a)).rejects.toMatchObject({ code: "TASK_RELATION_CYCLE" });
    await expect(blocks(a, a)).rejects.toMatchObject({ code: "TASK_RELATION_CYCLE" });
    expect(unitOfWork.data.relations.size).toBe(2);
  });

  it("rejects a target in another workspace or in the Trash", async () => {
    const a = await create("A");
    const other = seedWorkspace(unitOfWork.data);
    const foreign = await service.create(other.context, {
      workspaceId: other.workspace.id,
      title: "Foreign",
    });
    const trashed = await create("Trashed");
    await service.delete(seeded.context, workspaceId(), trashed.id);

    await expect(blocks(a, foreign)).rejects.toMatchObject({ code: "TASK_NOT_FOUND" });
    await expect(blocks(a, trashed)).rejects.toMatchObject({ code: "TASK_NOT_FOUND" });
  });

  it("removes a relation from either endpoint and rejects a stranger's id", async () => {
    const a = await create("A");
    const b = await create("B");
    const c = await create("C");
    const withRelation = await blocks(a, b);
    const relationId = withRelation.relations[0]?.id as string;

    await expect(
      service.removeRelation(seeded.context, workspaceId(), c.id, relationId),
    ).rejects.toMatchObject({ code: "TASK_RELATION_NOT_FOUND" });

    const removed = await service.removeRelation(
      seeded.context,
      workspaceId(),
      b.id,
      relationId,
    );
    expect(removed.relations).toEqual([]);
    expect(removed.isBlocked).toBe(false);
    expect(
      unitOfWork.data.activity
        .filter((e) => e.eventType === "task.relation_removed")
        .map((e) => [e.aggregateId, e.summary]),
    ).toEqual([
      [b.id, "Removed relation: blocked by ML-1"],
      [a.id, "Removed relation: blocks ML-2"],
    ]);
  });

  it("rolls back the relation with its events when the commit fails", async () => {
    const a = await create("A");
    const b = await create("B");
    unitOfWork.failNextCommit();

    await expect(blocks(a, b)).rejects.toThrow("simulated commit failure");
    expect(unitOfWork.data.relations.size).toBe(0);
    expect(
      unitOfWork.data.activity.filter((e) => e.eventType === "task.relation_added"),
    ).toHaveLength(0);
  });

  it("clears the blocked projection when the predecessor completes, and hides a trashed one", async () => {
    const a = await create("A");
    const b = await create("B");
    await blocks(a, b);
    expect(
      (await service.list(seeded.context, listQuery({ isBlocked: true }))).data.map(
        (task) => task.title,
      ),
    ).toEqual(["B"]);

    await service.complete(seeded.context, workspaceId(), a.id);
    const freed = await service.get(seeded.context, workspaceId(), b.id);
    expect(freed.isBlocked).toBe(false);
    expect(freed.relations[0]?.task.isCompleted).toBe(true);

    await service.reopen(seeded.context, workspaceId(), a.id);
    await service.delete(seeded.context, workspaceId(), a.id);
    const orphaned = await service.get(seeded.context, workspaceId(), b.id);
    expect(orphaned.isBlocked).toBe(false);
    expect(orphaned.relations).toEqual([]);

    await service.restore(seeded.context, workspaceId(), a.id);
    expect((await service.get(seeded.context, workspaceId(), b.id)).isBlocked).toBe(
      true,
    );
  });

  it("keeps relations across project moves", async () => {
    const a = await create("A");
    const b = await create("B");
    await blocks(a, b);
    const ready = statusByCategory(seeded.statuses, "ready");

    const moved = await service.move(seeded.context, workspaceId(), b.id, {
      projectId: seeded.project.id,
      statusId: ready.id,
    });
    expect(moved.task.relations).toHaveLength(1);
    expect(moved.task.isBlocked).toBe(true);
    const back = await service.move(seeded.context, workspaceId(), b.id, {
      projectId: null,
    });
    expect(back.task.relations).toHaveLength(1);
  });

  it("completes a blocked task only with an acknowledgement", async () => {
    const a = await create("A");
    const b = await create("B");
    await blocks(a, b);

    await expect(
      service.complete(seeded.context, workspaceId(), b.id),
    ).rejects.toMatchObject({ code: "TASK_BLOCKED" });
    expect((await service.get(seeded.context, workspaceId(), b.id)).isCompleted).toBe(
      false,
    );

    const done = await service.complete(seeded.context, workspaceId(), b.id, {
      acknowledgeBlocked: true,
    });
    expect(done.isCompleted).toBe(true);
    expect(done.isBlocked).toBe(false);
    expect(done.relations).toHaveLength(1);
  });
});

describe("TaskService blocked flag", () => {
  it("flags with a reason, keeps the status, filters, and clears with events", async () => {
    const ready = statusByCategory(seeded.statuses, "ready");
    const task = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Waiting on vendor",
      projectId: seeded.project.id,
      statusId: ready.id,
    });
    await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Free",
    });

    const flagged = await service.setBlocked(
      seeded.context,
      seeded.workspace.id,
      task.id,
      { reason: "  waiting on   vendor " },
    );
    expect(flagged.blocked).toEqual({
      reason: "waiting on vendor",
      since: NOW.toISOString(),
    });
    expect(flagged.isBlocked).toBe(true);
    expect(flagged.statusId).toBe(ready.id);
    expect(flagged.version).toBe(2);
    expect(unitOfWork.data.activity.at(-1)).toMatchObject({
      eventType: "task.blocked",
      summary: "Marked task blocked: waiting on vendor",
      payload: {
        taskId: task.id,
        reason: "waiting on vendor",
        since: NOW.toISOString(),
      },
    });

    const blockedOnly = await service.list(
      seeded.context,
      listQuery({ isBlocked: true }),
    );
    expect(blockedOnly.data.map((item) => item.title)).toEqual(["Waiting on vendor"]);
    const openOnly = await service.list(
      seeded.context,
      listQuery({ isBlocked: false }),
    );
    expect(openOnly.data.map((item) => item.title)).toEqual(["Free"]);

    // Completing a flagged task needs the acknowledgement; the flag then survives.
    await expect(
      service.complete(seeded.context, seeded.workspace.id, task.id),
    ).rejects.toMatchObject({ code: "TASK_BLOCKED" });

    const cleared = await service.clearBlocked(
      seeded.context,
      seeded.workspace.id,
      task.id,
      flagged.version,
    );
    expect(cleared.blocked).toBeNull();
    expect(cleared.isBlocked).toBe(false);
    expect(cleared.version).toBe(3);
    expect(unitOfWork.data.activity.at(-1)).toMatchObject({
      eventType: "task.unblocked",
      payload: {
        taskId: task.id,
        reason: "waiting on vendor",
        since: NOW.toISOString(),
        clearedAt: NOW.toISOString(),
      },
    });
    // Clearing again changes nothing and records nothing.
    const count = unitOfWork.data.activity.length;
    await service.clearBlocked(seeded.context, seeded.workspace.id, task.id);
    expect(unitOfWork.data.activity).toHaveLength(count);
  });

  it("rejects a stale version and a blank reason without recording anything", async () => {
    const task = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Task",
    });

    await expect(
      service.setBlocked(seeded.context, seeded.workspace.id, task.id, {
        reason: "x",
        expectedVersion: 5,
      }),
    ).rejects.toMatchObject({ code: "TASK_VERSION_CONFLICT" });
    await expect(
      service.setBlocked(seeded.context, seeded.workspace.id, task.id, {
        reason: "   ",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(unitOfWork.data.activity).toHaveLength(1);
  });
});

describe("cross-project in-progress limit (GAP-20)", () => {
  function setLimit(limit: number | null) {
    const workspace = unitOfWork.data.workspaces.get(seeded.workspace.id);
    if (!workspace) throw new Error("workspace vanished");
    unitOfWork.data.workspaces.set(seeded.workspace.id, {
      ...workspace,
      inProgressLimit: limit,
    });
  }

  function seedSecondProject() {
    const project = buildProject(seeded.workspace.id, {
      name: "Second",
      slug: "second",
    });
    const statuses = buildDefaultWorkflow(project.id);
    unitOfWork.data.projects.set(project.id, project);
    for (const status of statuses) unitOfWork.data.statuses.set(status.id, status);
    return { project, statuses };
  }

  it("warns without blocking when a move starts more work than the limit, naming every started task", async () => {
    setLimit(1);
    const second = seedSecondProject();
    const here = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      projectId: seeded.project.id,
      statusId: statusByCategory(seeded.statuses, "ready").id,
      title: "Here",
    });
    const there = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      projectId: second.project.id,
      statusId: statusByCategory(second.statuses, "ready").id,
      title: "There",
    });

    const first = await service.move(seeded.context, seeded.workspace.id, here.id, {
      projectId: seeded.project.id,
      statusId: statusByCategory(seeded.statuses, "in_progress").id,
    });
    expect(first.warnings).toEqual([]);

    const crossed = await service.move(seeded.context, seeded.workspace.id, there.id, {
      projectId: second.project.id,
      statusId: statusByCategory(second.statuses, "in_progress").id,
    });
    expect(crossed.task.statusId).toBe(
      statusByCategory(second.statuses, "in_progress").id,
    );
    expect(crossed.warnings).toEqual([
      {
        code: "IN_PROGRESS_LIMIT_EXCEEDED",
        limit: 1,
        count: 2,
        message: "2 tasks are in progress across your projects; the limit is 1.",
        tasks: [
          { id: here.id, key: "ML-1", title: "Here", projectId: seeded.project.id },
          { id: there.id, key: "ML-2", title: "There", projectId: second.project.id },
        ],
      },
    ]);
    expect(unitOfWork.data.activity.at(-1)?.eventType).toBe("task.moved");
  });

  it("stays silent without a limit, within it, when reordering, or between two in-progress columns", async () => {
    const doing = statusByCategory(seeded.statuses, "in_progress");
    const doingToo = {
      ...doing,
      id: "0198f0a0-0000-7000-8000-00000000d0d0",
      name: "Doing too",
      rank: `${doing.rank}z`,
      isDefault: false,
    };
    unitOfWork.data.statuses.set(doingToo.id, doingToo);
    const one = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      projectId: seeded.project.id,
      statusId: doing.id,
      title: "One",
    });
    const two = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      projectId: seeded.project.id,
      statusId: statusByCategory(seeded.statuses, "ready").id,
      title: "Two",
    });

    const unlimited = await service.move(seeded.context, seeded.workspace.id, two.id, {
      projectId: seeded.project.id,
      statusId: doing.id,
    });
    expect(unlimited.warnings).toEqual([]);

    setLimit(2);
    const reordered = await service.reorder(
      seeded.context,
      seeded.workspace.id,
      two.id,
      {
        beforeTaskId: one.id,
      },
    );
    expect(reordered.statusId).toBe(doing.id);
    const sideways = await service.move(seeded.context, seeded.workspace.id, two.id, {
      projectId: seeded.project.id,
      statusId: doingToo.id,
    });
    expect(sideways.warnings).toEqual([]);

    setLimit(1);
    const stillSideways = await service.move(
      seeded.context,
      seeded.workspace.id,
      two.id,
      {
        projectId: seeded.project.id,
        statusId: doing.id,
      },
    );
    expect(stillSideways.warnings).toEqual([]);
    const backOut = await service.move(seeded.context, seeded.workspace.id, two.id, {
      projectId: seeded.project.id,
      statusId: statusByCategory(seeded.statuses, "ready").id,
    });
    expect(backOut.warnings).toEqual([]);
  });

  it("warns when reopening lands a task back in progress over the limit", async () => {
    setLimit(1);
    const doing = statusByCategory(seeded.statuses, "in_progress");
    const paused = await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      projectId: seeded.project.id,
      statusId: doing.id,
      title: "Paused",
    });
    await service.complete(seeded.context, seeded.workspace.id, paused.id);
    await service.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      projectId: seeded.project.id,
      statusId: doing.id,
      title: "Active",
    });

    const reopened = await service.reopen(
      seeded.context,
      seeded.workspace.id,
      paused.id,
    );
    expect(reopened.task.statusId).toBe(doing.id);
    expect(reopened.warnings).toHaveLength(1);
    // Reopening appends to the column, so the reopened task lists last.
    expect(reopened.warnings[0]?.tasks.map((task) => task.title)).toEqual([
      "Active",
      "Paused",
    ]);
  });
});
