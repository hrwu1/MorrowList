import type {
  Notification,
  NotificationChannels,
  NotificationKind,
  NotificationPreferenceRepository,
  NotificationPreferences,
  NotificationRepository,
  PushSubscription,
  PushSubscriptionRepository,
  ReminderRepository,
} from "@morrowlist/application";
import type { PlainDate, PlainTime, Reminder } from "@morrowlist/domain";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";

import type { Database } from "../client.js";
import {
  notificationPreferences,
  notifications,
  pushSubscriptions,
  taskReminders,
} from "../schema/index.js";

/** Reminder, notification, preference, and push-subscription persistence (GAP-13). */

type ReminderRow = typeof taskReminders.$inferSelect;
type NotificationRow = typeof notifications.$inferSelect;
type PreferenceRow = typeof notificationPreferences.$inferSelect;
type PushRow = typeof pushSubscriptions.$inferSelect;

function toReminder(row: ReminderRow): Reminder {
  return {
    taskId: row.taskId,
    workspaceId: row.workspaceId,
    remindAt: row.remindAt,
    offsetMinutes: row.offsetMinutes,
    deliveredAt: row.deliveredAt,
  };
}

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    kind: row.kind as NotificationKind,
    taskId: row.taskId,
    title: row.title,
    body: row.body,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

function toPreferences(row: PreferenceRow): NotificationPreferences {
  return {
    userId: row.userId,
    workspaceId: row.workspaceId,
    channels: row.channels as NotificationChannels,
    // PostgreSQL returns `time` as HH:mm:ss; the domain models HH:mm.
    digestTime: (row.digestTime
      ? row.digestTime.slice(0, 5)
      : null) as PlainTime | null,
    timezone: row.timezone,
    defaultOffsetMinutes: row.defaultOffsetMinutes,
    lastDigestDate: row.lastDigestDate as PlainDate | null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toPushSubscription(row: PushRow): PushSubscription {
  return {
    userId: row.userId,
    endpoint: row.endpoint,
    keys: row.keys as PushSubscription["keys"],
    createdAt: row.createdAt,
  };
}

export function createReminderRepository(db: Database): ReminderRepository {
  return {
    async upsert(reminder) {
      const now = new Date();
      await db
        .insert(taskReminders)
        .values({
          taskId: reminder.taskId,
          workspaceId: reminder.workspaceId,
          remindAt: reminder.remindAt,
          offsetMinutes: reminder.offsetMinutes,
          deliveredAt: reminder.deliveredAt,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: taskReminders.taskId,
          set: {
            remindAt: reminder.remindAt,
            offsetMinutes: reminder.offsetMinutes,
            deliveredAt: reminder.deliveredAt,
            updatedAt: now,
          },
        });
    },

    async delete(taskId) {
      await db.delete(taskReminders).where(eq(taskReminders.taskId, taskId));
    },

    async findByTask(taskId) {
      const [row] = await db
        .select()
        .from(taskReminders)
        .where(eq(taskReminders.taskId, taskId))
        .limit(1);
      return row ? toReminder(row) : null;
    },

    async claimDue(now, limit) {
      // The subquery locks the rows it selects and skips any another transaction holds,
      // so concurrent workers partition the due set instead of racing for it.
      const due = db
        .select({ taskId: taskReminders.taskId })
        .from(taskReminders)
        .where(and(isNull(taskReminders.deliveredAt), lte(taskReminders.remindAt, now)))
        .orderBy(asc(taskReminders.remindAt), asc(taskReminders.taskId))
        .limit(limit)
        .for("update", { skipLocked: true });

      const rows = await db
        .update(taskReminders)
        .set({ deliveredAt: now, updatedAt: now })
        .where(inArray(taskReminders.taskId, due))
        .returning();
      return rows
        .map(toReminder)
        .sort((a, b) => a.remindAt.getTime() - b.remindAt.getTime());
    },
  };
}

export function createNotificationRepository(db: Database): NotificationRepository {
  return {
    async insert(notification) {
      await db.insert(notifications).values({
        id: notification.id,
        workspaceId: notification.workspaceId,
        userId: notification.userId,
        kind: notification.kind,
        taskId: notification.taskId,
        title: notification.title,
        body: notification.body,
        readAt: notification.readAt,
        createdAt: notification.createdAt,
      });
    },

    async findById(workspaceId, userId, notificationId) {
      const [row] = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.id, notificationId),
            eq(notifications.workspaceId, workspaceId),
            eq(notifications.userId, userId),
          ),
        )
        .limit(1);
      return row ? toNotification(row) : null;
    },

    async list(workspaceId, userId, cursor, unreadOnly) {
      const conditions = [
        eq(notifications.workspaceId, workspaceId),
        eq(notifications.userId, userId),
        unreadOnly ? isNull(notifications.readAt) : undefined,
      ];
      if (cursor.after) {
        const [anchor] = await db
          .select({ id: notifications.id, createdAt: notifications.createdAt })
          .from(notifications)
          .where(eq(notifications.id, cursor.after))
          .limit(1);
        if (anchor) {
          conditions.push(
            sql`(${notifications.createdAt}, ${notifications.id}) < (${anchor.createdAt.toISOString()}::timestamptz, ${anchor.id}::uuid)`,
          );
        }
      }

      const rows = await db
        .select()
        .from(notifications)
        .where(and(...conditions))
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(cursor.limit + 1);
      return {
        items: rows.slice(0, cursor.limit).map(toNotification),
        hasMore: rows.length > cursor.limit,
        nextCursor: null,
      };
    },

    async markRead(workspaceId, userId, notificationId, readAt) {
      const rows = await db
        .update(notifications)
        .set({ readAt })
        .where(
          and(
            eq(notifications.id, notificationId),
            eq(notifications.workspaceId, workspaceId),
            eq(notifications.userId, userId),
            isNull(notifications.readAt),
          ),
        )
        .returning({ id: notifications.id });
      if (rows.length === 1) return true;
      // Already read is still a success; only an unknown id is not.
      const [existing] = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.id, notificationId),
            eq(notifications.workspaceId, workspaceId),
            eq(notifications.userId, userId),
          ),
        )
        .limit(1);
      return existing !== undefined;
    },

    async countUnread(workspaceId, userId) {
      const [row] = await db
        .select({ total: count() })
        .from(notifications)
        .where(
          and(
            eq(notifications.workspaceId, workspaceId),
            eq(notifications.userId, userId),
            isNull(notifications.readAt),
          ),
        );
      return Number(row?.total ?? 0);
    },
  };
}

export function createNotificationPreferenceRepository(
  db: Database,
): NotificationPreferenceRepository {
  return {
    async find(userId, workspaceId) {
      const [row] = await db
        .select()
        .from(notificationPreferences)
        .where(
          and(
            eq(notificationPreferences.userId, userId),
            eq(notificationPreferences.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      return row ? toPreferences(row) : null;
    },

    async upsert(preferences) {
      const values = {
        userId: preferences.userId,
        workspaceId: preferences.workspaceId,
        channels: preferences.channels,
        digestTime: preferences.digestTime,
        timezone: preferences.timezone,
        defaultOffsetMinutes: preferences.defaultOffsetMinutes,
        lastDigestDate: preferences.lastDigestDate,
        createdAt: preferences.createdAt,
        updatedAt: preferences.updatedAt,
      };
      await db
        .insert(notificationPreferences)
        .values(values)
        .onConflictDoUpdate({
          target: [notificationPreferences.userId, notificationPreferences.workspaceId],
          set: {
            channels: values.channels,
            digestTime: values.digestTime,
            timezone: values.timezone,
            defaultOffsetMinutes: values.defaultOffsetMinutes,
            lastDigestDate: values.lastDigestDate,
            updatedAt: values.updatedAt,
          },
        });
    },

    async listWithDigest() {
      const rows = await db
        .select()
        .from(notificationPreferences)
        .where(isNotNull(notificationPreferences.digestTime))
        .orderBy(
          asc(notificationPreferences.workspaceId),
          asc(notificationPreferences.userId),
        );
      return rows.map(toPreferences);
    },

    async claimDigest(userId, workspaceId, date) {
      // A conditional update is the claim: whoever advances the date sends the digest.
      const rows = await db
        .update(notificationPreferences)
        .set({ lastDigestDate: date, updatedAt: new Date() })
        .where(
          and(
            eq(notificationPreferences.userId, userId),
            eq(notificationPreferences.workspaceId, workspaceId),
            or(
              isNull(notificationPreferences.lastDigestDate),
              lt(notificationPreferences.lastDigestDate, date),
            ),
          ),
        )
        .returning({ userId: notificationPreferences.userId });
      return rows.length === 1;
    },
  };
}

export function createPushSubscriptionRepository(
  db: Database,
): PushSubscriptionRepository {
  return {
    async upsert(subscription) {
      await db
        .insert(pushSubscriptions)
        .values({
          userId: subscription.userId,
          endpoint: subscription.endpoint,
          keys: subscription.keys,
          createdAt: subscription.createdAt,
        })
        .onConflictDoUpdate({
          target: [pushSubscriptions.userId, pushSubscriptions.endpoint],
          set: { keys: subscription.keys },
        });
    },

    async delete(userId, endpoint) {
      const rows = await db
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.userId, userId),
            eq(pushSubscriptions.endpoint, endpoint),
          ),
        )
        .returning({ endpoint: pushSubscriptions.endpoint });
      return rows.length === 1;
    },

    async listForUser(userId) {
      const rows = await db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId))
        .orderBy(asc(pushSubscriptions.createdAt));
      return rows.map(toPushSubscription);
    },
  };
}
