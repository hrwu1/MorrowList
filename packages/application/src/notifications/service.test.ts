import { TASK_EVENTS, WORKSPACE_EVENTS } from "@morrowlist/contracts";
import { fixedClock, uuidv7 } from "@morrowlist/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { TaskService } from "../tasks/service.js";
import {
  createInMemoryUnitOfWork,
  emptyData,
  seedWorkspace,
  type InMemoryUnitOfWork,
  type SeededWorkspace,
} from "../testing/index.js";

import { createRecordingEmailSender } from "./email.js";
import { createRecordingPushSender, type PushResult } from "./push.js";
import { NotificationService } from "./service.js";

/**
 * Delivery and the user-facing notification commands (GAP-13). Delivery is exercised
 * against the in-memory doubles; the once-only claim under real row locks is proven in
 * the database integration suite.
 */

const NOW = new Date("2026-09-03T09:00:00.000Z");
const CURSOR_SECRET = "test-cursor-secret";

let unitOfWork: InMemoryUnitOfWork;
let seeded: SeededWorkspace;
let tasks: TaskService;
let emails: ReturnType<typeof createRecordingEmailSender>;
let pushes: ReturnType<typeof createRecordingPushSender>;
let notifications: NotificationService;

function service(clock = fixedClock(NOW)) {
  return new NotificationService({
    unitOfWork,
    clock,
    cursorSecret: CURSOR_SECRET,
    emailSender: emails,
    pushSender: pushes,
    userDirectory: {
      findById: async (id) =>
        id === seeded.userId ? { id, email: "alex@example.com", name: "Alex" } : null,
    },
    appUrl: "https://morrow.example/",
  });
}

beforeEach(() => {
  unitOfWork = createInMemoryUnitOfWork(emptyData());
  seeded = seedWorkspace(unitOfWork.data, { workspace: { timezone: "Europe/Berlin" } });
  tasks = new TaskService({
    unitOfWork,
    clock: fixedClock(NOW),
    cursorSecret: CURSOR_SECRET,
  });
  emails = createRecordingEmailSender();
  pushes = createRecordingPushSender();
  notifications = service();
});

/** A task due 12:00 Berlin (10:00Z) with the default 30-minute reminder (09:30Z). */
function timed(title = "Call the bank") {
  return tasks.create(seeded.context, {
    workspaceId: seeded.workspace.id,
    title,
    dueDate: "2026-09-03",
    dueTime: "12:00",
  });
}

const FIRES_AT = new Date("2026-09-03T09:30:00.000Z");

describe("NotificationService.deliverDue", () => {
  it("writes an in-app notification and records the delivery once", async () => {
    const task = await timed();

    expect(await notifications.deliverDue(new Date("2026-09-03T09:29:59.000Z"))).toBe(
      0,
    );
    expect(await notifications.deliverDue(FIRES_AT)).toBe(1);
    expect(await notifications.deliverDue(FIRES_AT)).toBe(0);

    const inbox = await notifications.list(seeded.context, seeded.workspace.id, {
      limit: 50,
    });
    expect(inbox.unreadCount).toBe(1);
    expect(inbox.data).toEqual([
      expect.objectContaining({
        kind: "reminder",
        taskId: task.id,
        title: "Reminder: Call the bank",
        body: "ML-000001 is due 2026-09-03 at 12:00 (Europe/Berlin).",
        readAt: null,
      }),
    ]);
    const sent = unitOfWork.data.activity.filter(
      (event) => event.eventType === TASK_EVENTS.reminderSent,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      aggregateId: task.id,
      actorKind: "system",
      summary: "Sent reminder",
      payload: {
        taskId: task.id,
        remindAt: FIRES_AT.toISOString(),
        recipients: [seeded.userId],
        channels: ["inApp"],
      },
    });
    expect(unitOfWork.data.outbox.map((event) => event.eventType)).toContain(
      TASK_EVENTS.reminderSent,
    );
    expect(emails.sent).toHaveLength(0);
  });

  it("emails the recipient after the commit when the email channel is on", async () => {
    await notifications.updatePreferences(seeded.context, seeded.workspace.id, {
      channels: { email: true },
    });
    await timed();

    await notifications.deliverDue(FIRES_AT);

    expect(emails.sent).toEqual([
      {
        to: "alex@example.com",
        subject: "Reminder: Call the bank",
        text: expect.stringContaining("https://morrow.example/tasks/ML-000001"),
      },
    ]);
  });

  it("pushes to every registered device after the commit when the push channel is on", async () => {
    await notifications.updatePreferences(seeded.context, seeded.workspace.id, {
      channels: { push: true },
    });
    for (const endpoint of [
      "https://push.example/laptop",
      "https://push.example/phone",
    ]) {
      await notifications.addPushSubscription(seeded.context, {
        endpoint,
        keys: { p256dh: "p", auth: "a" },
      });
    }
    const task = await timed();

    await notifications.deliverDue(FIRES_AT);

    expect(pushes.sent.map((push) => push.subscription.endpoint)).toEqual([
      "https://push.example/laptop",
      "https://push.example/phone",
    ]);
    expect(pushes.sent[0]).toMatchObject({
      title: "Reminder: Call the bank",
      body: "ML-000001 is due 2026-09-03 at 12:00 (Europe/Berlin).",
      url: "https://morrow.example/tasks/ML-000001",
      // Tagged by the task, so a snooze replaces this rather than stacking beside it.
      tag: `reminder:${task.id}`,
    });
    // The channel is recorded like any other, so the history says how it was delivered.
    expect(
      unitOfWork.data.activity.find((e) => e.eventType === TASK_EVENTS.reminderSent)
        ?.payload,
    ).toMatchObject({ channels: ["inApp", "push"] });
  });

  it("sends no push when the channel is off, however many devices are registered", async () => {
    await notifications.addPushSubscription(seeded.context, {
      endpoint: "https://push.example/laptop",
      keys: { p256dh: "p", auth: "a" },
    });
    await timed();

    await notifications.deliverDue(FIRES_AT);

    expect(pushes.sent).toHaveLength(0);
  });

  it("removes a device the push service reports gone, and keeps one that merely failed", async () => {
    pushes = createRecordingPushSender(
      new Map<string, PushResult>([
        ["https://push.example/cleared", { ok: false, gone: true, error: "410" }],
        ["https://push.example/offline", { ok: false, error: "timeout" }],
      ]),
    );
    notifications = service();
    await notifications.updatePreferences(seeded.context, seeded.workspace.id, {
      channels: { push: true },
    });
    for (const endpoint of [
      "https://push.example/cleared",
      "https://push.example/offline",
    ]) {
      await notifications.addPushSubscription(seeded.context, {
        endpoint,
        keys: { p256dh: "p", auth: "a" },
      });
    }
    await timed();

    await notifications.deliverDue(FIRES_AT);

    expect(
      [...unitOfWork.data.pushSubscriptions.values()].map((s) => s.endpoint),
    ).toEqual(["https://push.example/offline"]);
    // A failed push never rolls back what the user was already told in the app.
    const inbox = await notifications.list(seeded.context, seeded.workspace.id, {
      limit: 50,
    });
    expect(inbox.data).toHaveLength(1);
  });

  it("sends nothing to a member who turned every channel off", async () => {
    await notifications.updatePreferences(seeded.context, seeded.workspace.id, {
      channels: { inApp: false },
    });
    await timed();

    await notifications.deliverDue(FIRES_AT);

    const inbox = await notifications.list(seeded.context, seeded.workspace.id, {
      limit: 50,
    });
    expect(inbox.data).toHaveLength(0);
    expect(
      unitOfWork.data.activity.find((e) => e.eventType === TASK_EVENTS.reminderSent)
        ?.payload,
    ).toMatchObject({ recipients: [], channels: [] });
  });

  it("does not deliver for a task completed after the reminder was scheduled", async () => {
    const task = await timed();
    // Completion cancels the schedule; a stale row is guarded at delivery time too.
    await tasks.complete(seeded.context, seeded.workspace.id, task.id);
    expect(unitOfWork.data.reminders.size).toBe(0);
    unitOfWork.data.reminders.set(task.id, {
      taskId: task.id,
      workspaceId: seeded.workspace.id,
      remindAt: FIRES_AT,
      offsetMinutes: 30,
      deliveredAt: null,
    });

    await notifications.deliverDue(FIRES_AT);

    const inbox = await notifications.list(seeded.context, seeded.workspace.id, {
      limit: 50,
    });
    expect(inbox.data).toHaveLength(0);
  });
});

describe("NotificationService.digest", () => {
  async function enableDigest(overrides: Record<string, unknown> = {}) {
    await notifications.updatePreferences(seeded.context, seeded.workspace.id, {
      digestTime: "08:00",
      ...overrides,
    });
  }

  it("sends nothing before the digest time in the user's zone, then once for the day", async () => {
    await enableDigest({ timezone: "America/New_York" });
    await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Overdue",
      dueDate: "2026-09-01",
    });

    // 09:00Z is 05:00 in New York: too early.
    expect(await notifications.digest(NOW)).toBe(0);
    // 12:30Z is 08:30 in New York.
    const later = new Date("2026-09-03T12:30:00.000Z");
    expect(await notifications.digest(later)).toBe(1);
    expect(await notifications.digest(later)).toBe(0);
    expect(await notifications.digest(new Date("2026-09-03T20:00:00.000Z"))).toBe(0);
    // The next local day sends again.
    expect(await notifications.digest(new Date("2026-09-04T12:30:00.000Z"))).toBe(1);

    const inbox = await notifications.list(seeded.context, seeded.workspace.id, {
      limit: 50,
    });
    expect(inbox.data.map((n) => n.title)).toEqual(["Today: 1 task", "Today: 1 task"]);
    expect(inbox.data[1]?.body).toBe("Overdue (1)\n- ML-000001 Overdue");
    const events = unitOfWork.data.activity.filter(
      (e) => e.eventType === WORKSPACE_EVENTS.digestSent,
    );
    expect(events[0]?.payload).toMatchObject({
      userId: seeded.userId,
      date: "2026-09-03",
      counts: { overdue: 1, due_today: 0, my_day: 0 },
    });
  });

  it("claims the day but sends nothing when Today is empty", async () => {
    await enableDigest();

    expect(await notifications.digest(NOW)).toBe(0);
    expect(unitOfWork.data.notifications.size).toBe(0);
    expect(
      unitOfWork.data.notificationPreferences.get(
        `${seeded.userId}:${seeded.workspace.id}`,
      )?.lastDigestDate,
    ).toBe("2026-09-03");

    // Work that appears later the same day waits for tomorrow's digest.
    await timed();
    expect(await notifications.digest(new Date("2026-09-03T09:10:00.000Z"))).toBe(0);
  });

  it("pushes a short digest that points at Today rather than listing it", async () => {
    await enableDigest({ channels: { push: true }, timezone: "UTC" });
    await notifications.addPushSubscription(seeded.context, {
      endpoint: "https://push.example/phone",
      keys: { p256dh: "p", auth: "a" },
    });
    await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Overdue",
      dueDate: "2026-09-01",
    });

    expect(await notifications.digest(NOW)).toBe(1);

    expect(pushes.sent).toEqual([
      expect.objectContaining({
        title: "Today: 1 task",
        // A lock screen has no room for the list the in-app row and the email carry.
        body: "Open Today to see what you planned for 2026-09-03.",
        url: "https://morrow.example/today",
        tag: "digest:2026-09-03",
      }),
    ]);
  });

  it("groups the digest by Today section and emails it when enabled", async () => {
    await enableDigest({ channels: { email: true }, timezone: "UTC" });
    const chosen = await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Chosen",
      addToDay: "2026-09-03",
    });
    await timed("Due at noon");

    expect(await notifications.digest(NOW)).toBe(1);

    expect(emails.sent).toHaveLength(1);
    expect(emails.sent[0]?.subject).toBe(
      "Today: 2 tasks — MorrowList digest for 2026-09-03",
    );
    expect(emails.sent[0]?.text).toBe(
      `Due today (1)\n- ML-000002 Due at noon at 12:00\n\nMy Day (1)\n- ML-000001 Chosen\n\nOpen Today: https://morrow.example/today\n`,
    );
    expect(chosen.dayPlans).toEqual(["2026-09-03"]);
  });
});

describe("NotificationService user commands", () => {
  it("marks a notification read and refuses another user's", async () => {
    await timed();
    await notifications.deliverDue(FIRES_AT);
    const [notification] = (
      await notifications.list(seeded.context, seeded.workspace.id, { limit: 1 })
    ).data;

    const read = await notifications.markRead(
      seeded.context,
      seeded.workspace.id,
      notification!.id,
    );
    expect(read.readAt).toBe(NOW.toISOString());
    expect(
      (await notifications.list(seeded.context, seeded.workspace.id, { limit: 1 }))
        .unreadCount,
    ).toBe(0);

    const stranger = seedWorkspace(unitOfWork.data);
    await expect(
      notifications.markRead(stranger.context, stranger.workspace.id, notification!.id),
    ).rejects.toMatchObject({ code: "NOTIFICATION_NOT_FOUND" });
    await expect(
      notifications.markRead(seeded.context, seeded.workspace.id, uuidv7()),
    ).rejects.toMatchObject({ code: "NOTIFICATION_NOT_FOUND" });
  });

  it("snoozes a reminder for an hour and records it", async () => {
    const task = await timed();
    await notifications.deliverDue(FIRES_AT);
    const [notification] = (
      await notifications.list(seeded.context, seeded.workspace.id, { limit: 1 })
    ).data;
    const snoozeClock = fixedClock(new Date("2026-09-03T09:31:00.000Z"));

    const snoozed = await service(snoozeClock).snooze(
      seeded.context,
      seeded.workspace.id,
      notification!.id,
    );

    expect(snoozed.readAt).not.toBeNull();
    expect(unitOfWork.data.reminders.get(task.id)).toMatchObject({
      remindAt: new Date("2026-09-03T10:31:00.000Z"),
      deliveredAt: null,
    });
    expect(unitOfWork.data.activity.at(-1)).toMatchObject({
      eventType: TASK_EVENTS.reminderSnoozed,
      aggregateId: task.id,
      summary: "Snoozed reminder for 60 minutes",
    });

    // It fires again an hour later, as a second notification.
    await notifications.deliverDue(new Date("2026-09-03T10:31:00.000Z"));
    expect(
      (await notifications.list(seeded.context, seeded.workspace.id, { limit: 10 }))
        .unreadCount,
    ).toBe(1);

    await tasks.complete(seeded.context, seeded.workspace.id, task.id);
    await expect(
      notifications.snooze(seeded.context, seeded.workspace.id, notification!.id),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("pages notifications newest first with a signed cursor", async () => {
    for (const title of ["a", "b", "c"]) {
      await tasks.create(seeded.context, {
        workspaceId: seeded.workspace.id,
        title,
        dueDate: "2026-09-03",
        dueTime: "12:00",
      });
    }
    const listClock = { now: () => new Date(FIRES_AT.getTime() + counter++ * 1000) };
    let counter = 0;
    await service(listClock).deliverDue(FIRES_AT);

    const first = await notifications.list(seeded.context, seeded.workspace.id, {
      limit: 2,
    });
    expect(first.page.hasMore).toBe(true);
    const second = await notifications.list(seeded.context, seeded.workspace.id, {
      limit: 2,
      cursor: first.page.nextCursor!,
    });
    expect(second.page.hasMore).toBe(false);
    expect([...first.data, ...second.data].map((n) => n.title)).toEqual([
      "Reminder: c",
      "Reminder: b",
      "Reminder: a",
    ]);
    const unread = await notifications.list(seeded.context, seeded.workspace.id, {
      limit: 10,
      unread: true,
    });
    expect(unread.data).toHaveLength(3);
  });

  it("returns default preferences, updates them with an event, and rolls back on failure", async () => {
    const defaults = await notifications.getPreferences(
      seeded.context,
      seeded.workspace.id,
    );
    expect(defaults).toEqual({
      workspaceId: seeded.workspace.id,
      channels: { inApp: true, email: false, push: false },
      digestTime: null,
      timezone: null,
      defaultOffsetMinutes: 30,
    });

    const updated = await notifications.updatePreferences(
      seeded.context,
      seeded.workspace.id,
      { digestTime: "07:30", defaultOffsetMinutes: 60, channels: { email: true } },
    );
    expect(updated).toMatchObject({
      digestTime: "07:30",
      defaultOffsetMinutes: 60,
      channels: { inApp: true, email: true, push: false },
    });
    expect(unitOfWork.data.activity.at(-1)).toMatchObject({
      eventType: WORKSPACE_EVENTS.notificationPreferencesUpdated,
      aggregateType: "workspace",
      payload: {
        userId: seeded.userId,
        changes: {
          digestTime: { from: null, to: "07:30" },
          defaultOffsetMinutes: { from: 30, to: 60 },
          "channels.email": { from: false, to: true },
        },
      },
    });
    // No change, no event.
    const before = unitOfWork.data.activity.length;
    await notifications.updatePreferences(seeded.context, seeded.workspace.id, {
      digestTime: "07:30",
    });
    expect(unitOfWork.data.activity).toHaveLength(before);

    await expect(
      notifications.updatePreferences(seeded.context, seeded.workspace.id, {
        timezone: "Mars/Olympus",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    unitOfWork.failNextCommit();
    await expect(
      notifications.updatePreferences(seeded.context, seeded.workspace.id, {
        digestTime: null,
      }),
    ).rejects.toThrow(/simulated commit failure/);
    expect(
      (await notifications.getPreferences(seeded.context, seeded.workspace.id))
        .digestTime,
    ).toBe("07:30");
  });

  it("stores and removes push subscriptions without recording their keys anywhere", async () => {
    const before = unitOfWork.data.activity.length;
    const added = await notifications.addPushSubscription(seeded.context, {
      endpoint: "https://push.example/abc",
      keys: { p256dh: "p", auth: "a" },
    });
    expect(added).toEqual({
      endpoint: "https://push.example/abc",
      createdAt: NOW.toISOString(),
    });
    expect(unitOfWork.data.pushSubscriptions.size).toBe(1);
    expect(unitOfWork.data.activity).toHaveLength(before);

    await notifications.removePushSubscription(
      seeded.context,
      "https://push.example/abc",
    );
    await notifications.removePushSubscription(
      seeded.context,
      "https://push.example/abc",
    );
    expect(unitOfWork.data.pushSubscriptions.size).toBe(0);
  });

  it("refuses a credential that is not a user", async () => {
    const key = { ...seeded.context, userId: undefined, actorKind: "api_key" as const };
    await expect(
      notifications.list(key, seeded.workspace.id, { limit: 10 }),
    ).rejects.toMatchObject({ code: "AUTH_FORBIDDEN" });
  });
});
