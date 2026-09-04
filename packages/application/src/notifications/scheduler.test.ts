import { fixedClock } from "@morrowlist/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { TaskService } from "../tasks/service.js";
import {
  createInMemoryUnitOfWork,
  emptyData,
  seedWorkspace,
  statusByCategory,
  type InMemoryUnitOfWork,
  type SeededWorkspace,
} from "../testing/index.js";

/**
 * The reminder schedule follows the task through every command (GAP-13): it is written
 * in the command's transaction, moves with the due instant, and disappears when the task
 * is done or trashed.
 */

const NOW = new Date("2026-09-03T09:00:00.000Z");

let unitOfWork: InMemoryUnitOfWork;
let seeded: SeededWorkspace;
let tasks: TaskService;

beforeEach(() => {
  unitOfWork = createInMemoryUnitOfWork(emptyData());
  // Berlin is UTC+2 in September: 12:00 local is 10:00Z.
  seeded = seedWorkspace(unitOfWork.data, { workspace: { timezone: "Europe/Berlin" } });
  tasks = new TaskService({
    unitOfWork,
    clock: fixedClock(NOW),
    cursorSecret: "test-cursor-secret",
  });
});

function timed(overrides: Record<string, unknown> = {}) {
  return tasks.create(seeded.context, {
    workspaceId: seeded.workspace.id,
    title: "Call the bank",
    dueDate: "2026-09-03",
    dueTime: "12:00",
    ...overrides,
  });
}

function reminderOf(taskId: string) {
  return unitOfWork.data.reminders.get(taskId) ?? null;
}

describe("reminder scheduling through the task commands", () => {
  it("schedules the default 30 minutes before a timed task's due instant", async () => {
    const task = await timed();

    expect(task.reminderOffsetMinutes).toBe(30);
    expect(reminderOf(task.id)).toMatchObject({
      workspaceId: seeded.workspace.id,
      remindAt: new Date("2026-09-03T09:30:00.000Z"),
      offsetMinutes: 30,
      deliveredAt: null,
    });
  });

  it("uses the user's workspace default and honours an explicit offset or none", async () => {
    unitOfWork.data.notificationPreferences.set(
      `${seeded.userId}:${seeded.workspace.id}`,
      {
        userId: seeded.userId,
        workspaceId: seeded.workspace.id,
        channels: { inApp: true, email: false, push: false },
        digestTime: null,
        timezone: null,
        defaultOffsetMinutes: 10,
        lastDigestDate: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    );

    const preferred = await timed();
    expect(preferred.reminderOffsetMinutes).toBe(10);
    expect(reminderOf(preferred.id)?.remindAt).toEqual(
      new Date("2026-09-03T09:50:00.000Z"),
    );

    const explicit = await timed({ reminderOffsetMinutes: 5 });
    expect(reminderOf(explicit.id)?.remindAt).toEqual(
      new Date("2026-09-03T09:55:00.000Z"),
    );

    const silent = await timed({ reminderOffsetMinutes: null });
    expect(silent.reminderOffsetMinutes).toBeNull();
    expect(reminderOf(silent.id)).toBeNull();

    const undated = await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "No date",
    });
    expect(reminderOf(undated.id)).toBeNull();
  });

  it("does not schedule a reminder whose moment has already passed", async () => {
    const task = await timed({ dueTime: "09:15" });

    expect(task.reminderOffsetMinutes).toBe(30);
    expect(reminderOf(task.id)).toBeNull();
  });

  it("moves the reminder with the due time and the offset, and drops it with the time", async () => {
    const task = await timed();
    const workspaceId = seeded.workspace.id;

    const later = await tasks.update(seeded.context, workspaceId, task.id, {
      dueTime: "15:00",
    });
    expect(reminderOf(task.id)?.remindAt).toEqual(new Date("2026-09-03T12:30:00.000Z"));

    const hour = await tasks.update(seeded.context, workspaceId, task.id, {
      reminderOffsetMinutes: 60,
      expectedVersion: later.version,
    });
    expect(reminderOf(task.id)).toMatchObject({
      remindAt: new Date("2026-09-03T12:00:00.000Z"),
      offsetMinutes: 60,
    });
    expect(unitOfWork.data.activity.at(-1)?.payload).toMatchObject({
      changes: { reminderOffsetMinutes: { from: 30, to: 60 } },
    });

    await tasks.update(seeded.context, workspaceId, task.id, {
      dueTime: null,
      expectedVersion: hour.version,
    });
    expect(reminderOf(task.id)).toBeNull();
  });

  it("cancels the reminder on completion and trashing, and restores it after", async () => {
    const workspaceId = seeded.workspace.id;
    const ready = statusByCategory(seeded.statuses, "ready");
    const task = await timed({ projectId: seeded.project.id, statusId: ready.id });
    expect(reminderOf(task.id)).not.toBeNull();

    await tasks.complete(seeded.context, workspaceId, task.id);
    expect(reminderOf(task.id)).toBeNull();
    await tasks.reopen(seeded.context, workspaceId, task.id);
    expect(reminderOf(task.id)).not.toBeNull();

    await tasks.delete(seeded.context, workspaceId, task.id);
    expect(reminderOf(task.id)).toBeNull();
    await tasks.restore(seeded.context, workspaceId, task.id);
    expect(reminderOf(task.id)).not.toBeNull();
  });

  it("keeps a delivered reminder delivered when an unrelated field changes", async () => {
    const task = await timed();
    unitOfWork.data.reminders.set(task.id, {
      ...unitOfWork.data.reminders.get(task.id)!,
      deliveredAt: NOW,
    });

    await tasks.update(seeded.context, seeded.workspace.id, task.id, {
      title: "Call the bank again",
    });

    expect(reminderOf(task.id)?.deliveredAt).toEqual(NOW);
  });

  it("rolls the reminder back with the task and its events when the commit fails", async () => {
    unitOfWork.failNextCommit();

    await expect(timed()).rejects.toThrow(/simulated commit failure/);

    expect(unitOfWork.data.tasks.size).toBe(0);
    expect(unitOfWork.data.reminders.size).toBe(0);
    expect(unitOfWork.data.activity).toHaveLength(0);
    expect(unitOfWork.data.outbox).toHaveLength(0);
  });

  it("refuses an offset on a task without a due time", async () => {
    const task = await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "No date",
    });

    await expect(
      tasks.update(seeded.context, seeded.workspace.id, task.id, {
        reminderOffsetMinutes: 15,
      }),
    ).resolves.toMatchObject({ reminderOffsetMinutes: null });
  });
});
