import {
  TaskService,
  bootstrapUser,
  type ActorContext,
  type NotificationPreferences,
  type UnitOfWork,
} from "@morrowlist/application";
import { fixedClock, uuidv7, type PlainDate, type Reminder } from "@morrowlist/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseHandle } from "../client.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  truncateAll,
} from "../test-harness.js";
import { createUnitOfWork } from "../unit-of-work.js";

/**
 * Reminder and notification persistence against real PostgreSQL (GAP-13). Migration 0005
 * carries a check constraint, cascading and nulling foreign keys, and the partial index
 * the worker's `FOR UPDATE SKIP LOCKED` claim relies on; none of that can be shown by the
 * in-memory doubles.
 */

const NOW = new Date("2026-09-03T09:00:00.000Z");

let handle: DatabaseHandle;
let unitOfWork: UnitOfWork;
let context: ActorContext;
let userId: string;
let workspaceId: string;
let tasks: TaskService;

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterAll(async () => {
  await teardownTestDatabase();
});

beforeEach(async () => {
  await truncateAll(handle);
  unitOfWork = createUnitOfWork(handle);
  userId = uuidv7();
  const { workspace } = await bootstrapUser(
    { unitOfWork, clock: fixedClock(NOW) },
    {
      userId,
      email: "reminders-integration@example.com",
      displayName: "Reminders Integration",
      timezone: "UTC",
      taskKeyPrefix: "ML",
    },
  );
  workspaceId = workspace.id;
  context = {
    actorKind: "user",
    actorId: userId,
    userId,
    workspaceIds: [workspaceId],
    scopes: new Set(),
    requestId: "req_reminders_integration",
  };
  tasks = new TaskService({
    unitOfWork,
    clock: fixedClock(NOW),
    cursorSecret: "reminders-integration-cursor-secret",
  });
});

async function insertReminder(remindAt: Date): Promise<Reminder> {
  const task = await tasks.create(context, { workspaceId, title: `Due ${remindAt}` });
  const reminder: Reminder = {
    taskId: task.id,
    workspaceId,
    remindAt,
    offsetMinutes: 30,
    deliveredAt: null,
  };
  await unitOfWork.execute((tx) => tx.reminders.upsert(reminder));
  return reminder;
}

function preferences(
  overrides: Partial<NotificationPreferences> = {},
): NotificationPreferences {
  return {
    userId,
    workspaceId,
    channels: { inApp: true, email: false, push: false },
    digestTime: null,
    timezone: null,
    defaultOffsetMinutes: 30,
    lastDigestDate: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("migration 0005", () => {
  it("refuses a reminder offset on a task without a due time", async () => {
    const task = await tasks.create(context, { workspaceId, title: "Undated" });

    await expect(
      handle.pool.query("update tasks set reminder_offset_minutes = 30 where id = $1", [
        task.id,
      ]),
    ).rejects.toThrow(/tasks_reminder_requires_due_time/);
  });

  it("removes a task's reminder with the task and only unlinks its notifications", async () => {
    const reminder = await insertReminder(NOW);
    await unitOfWork.execute((tx) =>
      tx.notifications.insert({
        id: uuidv7(),
        workspaceId,
        userId,
        kind: "reminder",
        taskId: reminder.taskId,
        title: "Due soon",
        body: "Body",
        readAt: null,
        createdAt: NOW,
      }),
    );

    await handle.pool.query("delete from tasks where id = $1", [reminder.taskId]);

    const reminders = await handle.pool.query("select 1 from task_reminders");
    expect(reminders.rowCount).toBe(0);
    const notifications = await handle.pool.query(
      "select task_id, title from notifications",
    );
    expect(notifications.rows).toEqual([{ task_id: null, title: "Due soon" }]);
  });
});

describe("reminder claims", () => {
  it("gives each of two concurrent workers a disjoint share of the due reminders", async () => {
    const remindAts = [1, 2, 3, 4, 5].map(
      (minutes) => new Date(NOW.getTime() - minutes * 60_000),
    );
    for (const remindAt of remindAts) await insertReminder(remindAt);
    await insertReminder(new Date(NOW.getTime() + 60_000)); // not due yet

    // Worker A claims three and holds its transaction open; worker B must skip those.
    let releaseA: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let claimedByA: readonly Reminder[] = [];
    const workerA = unitOfWork.execute(async (tx) => {
      claimedByA = await tx.reminders.claimDue(NOW, 3);
      await held;
    });
    // Give A time to take its locks before B starts.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const claimedByB = await unitOfWork.execute((tx) => tx.reminders.claimDue(NOW, 10));
    releaseA();
    await workerA;

    expect(claimedByA).toHaveLength(3);
    expect(claimedByB).toHaveLength(2);
    const all = [...claimedByA, ...claimedByB];
    expect(new Set(all.map((r) => r.taskId)).size).toBe(5);
    expect(all.every((r) => r.deliveredAt?.getTime() === NOW.getTime())).toBe(true);
    expect(claimedByA.map((r) => r.remindAt)).toEqual(remindAts.slice(2).reverse());

    // Nothing is left to claim, and the future reminder is untouched.
    const again = await unitOfWork.execute((tx) => tx.reminders.claimDue(NOW, 10));
    expect(again).toHaveLength(0);
    const pending = await handle.pool.query(
      "select count(*)::int as n from task_reminders where delivered_at is null",
    );
    expect(pending.rows[0]).toEqual({ n: 1 });
  });

  it("reschedules a delivered reminder back to pending on upsert", async () => {
    const reminder = await insertReminder(new Date(NOW.getTime() - 60_000));
    const [claimed] = await unitOfWork.execute((tx) => tx.reminders.claimDue(NOW, 1));
    expect(claimed?.taskId).toBe(reminder.taskId);

    const later = new Date(NOW.getTime() + 3_600_000);
    await unitOfWork.execute((tx) =>
      tx.reminders.upsert({ ...reminder, remindAt: later, deliveredAt: null }),
    );

    await expect(
      unitOfWork.execute((tx) => tx.reminders.findByTask(reminder.taskId)),
    ).resolves.toMatchObject({ remindAt: later, deliveredAt: null });
  });
});

describe("digest claims", () => {
  it("lets exactly one of two concurrent claims win, once per day", async () => {
    await unitOfWork.execute((tx) =>
      tx.notificationPreferences.upsert(preferences({ digestTime: "08:00" as never })),
    );
    const date = "2026-09-03" as PlainDate;

    const results = await Promise.all([
      unitOfWork.execute((tx) =>
        tx.notificationPreferences.claimDigest(userId, workspaceId, date),
      ),
      unitOfWork.execute((tx) =>
        tx.notificationPreferences.claimDigest(userId, workspaceId, date),
      ),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);

    await expect(
      unitOfWork.execute((tx) =>
        tx.notificationPreferences.claimDigest(userId, workspaceId, date),
      ),
    ).resolves.toBe(false);
    await expect(
      unitOfWork.execute((tx) =>
        tx.notificationPreferences.claimDigest(
          userId,
          workspaceId,
          "2026-09-04" as PlainDate,
        ),
      ),
    ).resolves.toBe(true);
    await expect(
      unitOfWork.execute((tx) => tx.notificationPreferences.find(userId, workspaceId)),
    ).resolves.toMatchObject({ digestTime: "08:00", lastDigestDate: "2026-09-04" });
  });
});

describe("notifications", () => {
  it("pages newest first without repeating across a page boundary and counts unread", async () => {
    for (let index = 0; index < 5; index++) {
      await unitOfWork.execute((tx) =>
        tx.notifications.insert({
          id: uuidv7(),
          workspaceId,
          userId,
          kind: "reminder",
          taskId: null,
          title: `Notification ${index}`,
          body: "",
          readAt: null,
          createdAt: new Date(NOW.getTime() + index * 1000),
        }),
      );
    }

    const first = await unitOfWork.execute((tx) =>
      tx.notifications.list(workspaceId, userId, { limit: 2 }, false),
    );
    expect(first.items.map((n) => n.title)).toEqual([
      "Notification 4",
      "Notification 3",
    ]);
    expect(first.hasMore).toBe(true);
    const second = await unitOfWork.execute((tx) =>
      tx.notifications.list(
        workspaceId,
        userId,
        { limit: 2, after: first.items[1]?.id },
        false,
      ),
    );
    expect(second.items.map((n) => n.title)).toEqual([
      "Notification 2",
      "Notification 1",
    ]);

    const target = first.items[0]!;
    await expect(
      unitOfWork.execute((tx) =>
        tx.notifications.markRead(workspaceId, userId, target.id, NOW),
      ),
    ).resolves.toBe(true);
    await expect(
      unitOfWork.execute((tx) =>
        tx.notifications.markRead(workspaceId, userId, target.id, NOW),
      ),
    ).resolves.toBe(true);
    await expect(
      unitOfWork.execute((tx) =>
        tx.notifications.markRead(workspaceId, uuidv7(), target.id, NOW),
      ),
    ).resolves.toBe(false);
    await expect(
      unitOfWork.execute((tx) => tx.notifications.countUnread(workspaceId, userId)),
    ).resolves.toBe(4);
    const unread = await unitOfWork.execute((tx) =>
      tx.notifications.list(workspaceId, userId, { limit: 10 }, true),
    );
    expect(unread.items).toHaveLength(4);
  });

  it("stores push subscriptions per user and endpoint", async () => {
    const subscription = {
      userId,
      endpoint: "https://push.example.com/abc",
      keys: { p256dh: "p", auth: "a" },
      createdAt: NOW,
    };
    await unitOfWork.execute((tx) => tx.pushSubscriptions.upsert(subscription));
    await unitOfWork.execute((tx) =>
      tx.pushSubscriptions.upsert({
        ...subscription,
        keys: { p256dh: "p2", auth: "a2" },
      }),
    );

    await expect(
      unitOfWork.execute((tx) => tx.pushSubscriptions.listForUser(userId)),
    ).resolves.toEqual([{ ...subscription, keys: { p256dh: "p2", auth: "a2" } }]);
    await expect(
      unitOfWork.execute((tx) =>
        tx.pushSubscriptions.delete(userId, subscription.endpoint),
      ),
    ).resolves.toBe(true);
    await expect(
      unitOfWork.execute((tx) =>
        tx.pushSubscriptions.delete(userId, subscription.endpoint),
      ),
    ).resolves.toBe(false);
  });
});
