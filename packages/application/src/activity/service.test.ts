import { TASK_EVENTS, type TaskDto } from "@morrowlist/contracts";
import { fixedClock, uuidv7 } from "@morrowlist/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { ProjectService } from "../projects/service.js";
import { TaskService } from "../tasks/service.js";
import {
  createInMemoryUnitOfWork,
  emptyData,
  seedWorkspace,
  statusByCategory,
  type InMemoryUnitOfWork,
  type SeededWorkspace,
} from "../testing/index.js";

import { ActivityService } from "./service.js";

const NOW = new Date("2026-08-29T09:00:00.000Z");
const CURSOR_SECRET = "test-cursor-secret";

let unitOfWork: InMemoryUnitOfWork;
let seeded: SeededWorkspace;
let tasks: TaskService;
let projects: ProjectService;
let activity: ActivityService;

const query = (overrides: { limit?: number; cursor?: string } = {}) => ({
  limit: 50,
  ...overrides,
});

beforeEach(() => {
  unitOfWork = createInMemoryUnitOfWork(emptyData());
  seeded = seedWorkspace(unitOfWork.data);
  tasks = new TaskService({
    unitOfWork,
    clock: fixedClock(NOW),
    cursorSecret: CURSOR_SECRET,
  });
  projects = new ProjectService({ unitOfWork, clock: fixedClock(NOW) });
  activity = new ActivityService({ unitOfWork, cursorSecret: CURSOR_SECRET });
});

/** Drive a task through every command so each catalogued event type is recorded once. */
async function taskWithFullHistory(): Promise<TaskDto> {
  const workspaceId = seeded.workspace.id;
  const ready = statusByCategory(seeded.statuses, "ready");
  let task = await tasks.create(seeded.context, { workspaceId, title: "Original" });
  task = await tasks.update(seeded.context, workspaceId, task.id, {
    title: "Renamed",
    priority: "high",
  });
  task = await tasks.move(seeded.context, workspaceId, task.id, {
    projectId: seeded.project.id,
    statusId: ready.id,
  });
  const sibling = await tasks.create(seeded.context, {
    workspaceId,
    title: "Sibling",
    projectId: seeded.project.id,
    statusId: ready.id,
  });
  task = await tasks.reorder(seeded.context, workspaceId, task.id, {
    beforeTaskId: sibling.id,
  });
  task = await tasks.complete(seeded.context, workspaceId, task.id);
  task = await tasks.reopen(seeded.context, workspaceId, task.id);
  task = await tasks.delete(seeded.context, workspaceId, task.id);
  return tasks.restore(seeded.context, workspaceId, task.id);
}

describe("ActivityService.listForTask", () => {
  it("returns every catalogued event type with its summary, newest first", async () => {
    const task = await taskWithFullHistory();

    const { data, page } = await activity.listForTask(
      seeded.context,
      seeded.workspace.id,
      task.key,
      query(),
    );

    expect(data.map((entry) => entry.eventType)).toEqual([
      TASK_EVENTS.restored,
      TASK_EVENTS.deleted,
      TASK_EVENTS.reopened,
      TASK_EVENTS.completed,
      TASK_EVENTS.reordered,
      TASK_EVENTS.moved,
      TASK_EVENTS.updated,
      TASK_EVENTS.created,
    ]);
    expect(new Set(data.map((entry) => entry.eventType))).toEqual(
      new Set(Object.values(TASK_EVENTS)),
    );
    for (const entry of data) {
      expect(entry.summary.length).toBeGreaterThan(0);
      expect(entry.actorDisplayName).toBe("Test User");
      expect(entry.actorKind).toBe("user");
    }
    expect(page).toEqual({ hasMore: false, nextCursor: null });
  });

  it("derives readable changes only where a field a person edits changed", async () => {
    const task = await taskWithFullHistory();

    const { data } = await activity.listForTask(
      seeded.context,
      seeded.workspace.id,
      task.id,
      query(),
    );
    const byType = new Map(data.map((entry) => [entry.eventType, entry]));

    expect(byType.get(TASK_EVENTS.updated)?.changes).toEqual([
      { field: "title", from: "Original", to: "Renamed" },
      { field: "priority", from: "none", to: "high" },
    ]);
    // A move changes ids and rank; none of those is a readable diff.
    expect(byType.get(TASK_EVENTS.moved)?.changes).toEqual([]);
    expect(byType.get(TASK_EVENTS.reordered)?.changes).toEqual([]);
    expect(byType.get(TASK_EVENTS.created)?.changes).toEqual([]);
  });

  it("pages through history with a signed cursor and rejects a forged one", async () => {
    const task = await taskWithFullHistory();

    const first = await activity.listForTask(
      seeded.context,
      seeded.workspace.id,
      task.key,
      query({ limit: 3 }),
    );
    expect(first.data).toHaveLength(3);
    expect(first.page.hasMore).toBe(true);
    expect(first.page.nextCursor).not.toBeNull();

    const seen = [...first.data];
    let cursor = first.page.nextCursor;
    while (cursor) {
      const next = await activity.listForTask(
        seeded.context,
        seeded.workspace.id,
        task.key,
        query({ limit: 3, cursor }),
      );
      seen.push(...next.data);
      cursor = next.page.nextCursor;
    }
    expect(seen).toHaveLength(8);
    expect(new Set(seen.map((entry) => entry.id)).size).toBe(8);

    const [body] = (first.page.nextCursor as string).split(".");
    await expect(
      activity.listForTask(
        seeded.context,
        seeded.workspace.id,
        task.key,
        query({ cursor: `${body}.forged` }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("still answers for a task in the Trash", async () => {
    const task = await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Doomed",
    });
    await tasks.delete(seeded.context, seeded.workspace.id, task.id);

    const { data } = await activity.listForTask(
      seeded.context,
      seeded.workspace.id,
      task.key,
      query(),
    );

    expect(data.map((entry) => entry.eventType)).toEqual([
      TASK_EVENTS.deleted,
      TASK_EVENTS.created,
    ]);
  });

  it("reports an unknown task and an unreachable workspace as not found", async () => {
    await expect(
      activity.listForTask(seeded.context, seeded.workspace.id, "ML-999", query()),
    ).rejects.toMatchObject({ code: "TASK_NOT_FOUND" });

    await expect(
      activity.listForTask(seeded.context, uuidv7(), "ML-1", query()),
    ).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
  });
});

describe("ActivityService.listForProject", () => {
  it("lists the project's events with those of its tasks and nothing else", async () => {
    const workspaceId = seeded.workspace.id;
    const detail = await projects.create(seeded.context, {
      workspaceId,
      name: "Launch",
    });
    const inside = await tasks.create(seeded.context, {
      workspaceId,
      title: "Inside",
      projectId: detail.project.id,
    });
    await tasks.update(seeded.context, workspaceId, inside.id, { title: "Inside!" });
    await tasks.create(seeded.context, { workspaceId, title: "Inbox task" });

    const { data } = await activity.listForProject(
      seeded.context,
      workspaceId,
      detail.project.id,
      query(),
    );

    expect(data.map((entry) => [entry.eventType, entry.aggregateId])).toEqual([
      [TASK_EVENTS.updated, inside.id],
      [TASK_EVENTS.created, inside.id],
      ["project.created", detail.project.id],
    ]);
  });

  it("reports an unknown project as not found", async () => {
    await expect(
      activity.listForProject(seeded.context, seeded.workspace.id, uuidv7(), query()),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });
});
