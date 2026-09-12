import type {
  ListNotificationsQuery,
  NotificationDto,
  NotificationListResponse,
  NotificationPreferencesDto,
  PushSubscriptionDto,
  PushSubscriptionRequest,
  UpdateNotificationPreferencesRequest,
} from "@morrowlist/contracts";
import { TASK_EVENTS, WORKSPACE_EVENTS } from "@morrowlist/contracts";
import {
  DomainError,
  SNOOZE_MINUTES,
  systemClock,
  toPlainTime,
  toReminderOffset,
  toTimezone,
  type Clock,
} from "@morrowlist/domain";

import type {
  Notification,
  NotificationPreferences,
  TransactionContext,
  UnitOfWork,
} from "../ports/index.js";
import {
  SCOPES,
  assertScope,
  assertWorkspaceAccess,
  type ActorContext,
} from "../shared/actor-context.js";
import { decodeCursor, encodeCursor } from "../shared/cursor.js";
import { recordEvent } from "../shared/event-recorder.js";

import {
  NotificationDispatcher,
  type NotificationDispatcherOptions,
} from "./dispatcher.js";
import {
  toNotificationDto,
  toPreferencesDto,
  toPushSubscriptionDto,
} from "./mappers.js";
import { loadNotificationPreferences } from "./preferences.js";

/** User-facing inbox, preference and registration use cases. Delivery is delegated. */
export interface NotificationServiceOptions extends NotificationDispatcherOptions {
  readonly cursorSecret: string;
}

export class NotificationService {
  private readonly unitOfWork: UnitOfWork;
  private readonly clock: Clock;
  private readonly cursorSecret: string;
  private readonly dispatcher: NotificationDispatcher;

  constructor(options: NotificationServiceOptions) {
    this.unitOfWork = options.unitOfWork;
    this.clock = options.clock ?? systemClock;
    this.cursorSecret = options.cursorSecret;
    this.dispatcher = new NotificationDispatcher(options);
  }

  /** Retained facade for callers that already drive notification delivery. */
  deliverDue(now: Date = this.clock.now()): Promise<number> {
    return this.dispatcher.deliverDue(now);
  }
  digest(now: Date = this.clock.now()): Promise<number> {
    return this.dispatcher.digest(now);
  }

  async list(
    context: ActorContext,
    workspaceId: string,
    query: ListNotificationsQuery,
  ): Promise<NotificationListResponse> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksRead);
    const userId = this.requireUser(context);

    return this.unitOfWork.execute(async (tx) => {
      const after = query.cursor
        ? decodeCursor(query.cursor, this.cursorSecret).i
        : undefined;
      const [page, unreadCount] = await Promise.all([
        tx.notifications.list(
          workspaceId,
          userId,
          { limit: query.limit, after },
          query.unread ?? false,
        ),
        tx.notifications.countUnread(workspaceId, userId),
      ]);
      const last = page.items.at(-1);
      return {
        data: page.items.map(toNotificationDto),
        page: {
          hasMore: page.hasMore,
          nextCursor:
            page.hasMore && last
              ? encodeCursor(
                  { k: last.createdAt.toISOString(), i: last.id },
                  this.cursorSecret,
                )
              : null,
        },
        unreadCount,
      };
    });
  }

  /** Mark one notification read. Reading is per-user view state and records no event. */
  async markRead(
    context: ActorContext,
    workspaceId: string,
    notificationId: string,
  ): Promise<NotificationDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksWrite);
    const userId = this.requireUser(context);

    return this.unitOfWork.execute(async (tx) => {
      const found = await tx.notifications.markRead(
        workspaceId,
        userId,
        notificationId,
        this.clock.now(),
      );
      if (!found) throw notificationNotFound(notificationId);
      return this.requireNotification(tx, workspaceId, userId, notificationId);
    });
  }

  /**
   * "Remind me in an hour": the notification is read and the task's reminder is armed
   * again one hour from now. Only a reminder for a live task can be snoozed.
   */
  async snooze(
    context: ActorContext,
    workspaceId: string,
    notificationId: string,
  ): Promise<NotificationDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksWrite);
    const userId = this.requireUser(context);

    return this.unitOfWork.execute(async (tx) => {
      const notification = await this.requireNotification(
        tx,
        workspaceId,
        userId,
        notificationId,
      );
      const task = notification.taskId
        ? await tx.tasks.findById(workspaceId, notification.taskId)
        : null;
      if (
        notification.kind !== "reminder" ||
        !task ||
        task.completedAt ||
        task.deletedAt ||
        task.reminderOffsetMinutes === null
      ) {
        throw new DomainError(
          "VALIDATION_FAILED",
          "Only a reminder for an open task can be snoozed.",
          { notificationId },
        );
      }

      const now = this.clock.now();
      const remindAt = new Date(now.getTime() + SNOOZE_MINUTES * 60_000);
      await tx.reminders.upsert({
        taskId: task.id,
        workspaceId,
        remindAt,
        offsetMinutes: task.reminderOffsetMinutes,
        deliveredAt: null,
      });
      await tx.notifications.markRead(workspaceId, userId, notificationId, now);
      await recordEvent(tx, context, this.clock, {
        workspaceId,
        aggregateType: "task",
        aggregateId: task.id,
        eventType: TASK_EVENTS.reminderSnoozed,
        summary: `Snoozed reminder for ${SNOOZE_MINUTES} minutes`,
        payload: { taskId: task.id, notificationId, remindAt: remindAt.toISOString() },
      });
      return this.requireNotification(tx, workspaceId, userId, notificationId);
    });
  }

  async getPreferences(
    context: ActorContext,
    workspaceId: string,
  ): Promise<NotificationPreferencesDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksRead);
    const userId = this.requireUser(context);

    return this.unitOfWork.execute(async (tx) =>
      toPreferencesDto(
        await loadNotificationPreferences(tx, userId, workspaceId, this.clock.now()),
      ),
    );
  }

  async updatePreferences(
    context: ActorContext,
    workspaceId: string,
    request: UpdateNotificationPreferencesRequest,
  ): Promise<NotificationPreferencesDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksWrite);
    const userId = this.requireUser(context);

    return this.unitOfWork.execute(async (tx) => {
      const current = await loadNotificationPreferences(
        tx,
        userId,
        workspaceId,
        this.clock.now(),
      );
      const next: NotificationPreferences = {
        ...current,
        channels: {
          inApp: request.channels?.inApp ?? current.channels.inApp,
          email: request.channels?.email ?? current.channels.email,
          push: request.channels?.push ?? current.channels.push,
        },
        digestTime:
          request.digestTime === undefined
            ? current.digestTime
            : request.digestTime === null
              ? null
              : toPlainTime(request.digestTime, "digestTime"),
        timezone:
          request.timezone === undefined
            ? current.timezone
            : request.timezone === null
              ? null
              : toTimezone(request.timezone),
        defaultOffsetMinutes:
          request.defaultOffsetMinutes === undefined
            ? current.defaultOffsetMinutes
            : toReminderOffset(request.defaultOffsetMinutes, "defaultOffsetMinutes"),
        updatedAt: this.clock.now(),
      };
      const changes = preferenceChanges(next, current);
      if (Object.keys(changes).length === 0) return toPreferencesDto(current);

      await tx.notificationPreferences.upsert(next);
      await recordEvent(tx, context, this.clock, {
        workspaceId,
        aggregateType: "workspace",
        aggregateId: workspaceId,
        eventType: WORKSPACE_EVENTS.notificationPreferencesUpdated,
        summary: "Updated notification preferences",
        payload: { workspaceId, userId, changes },
      });
      return toPreferencesDto(next);
    });
  }

  /** Register a browser for push. The keys are stored, never logged or recorded in events. */
  async addPushSubscription(
    context: ActorContext,
    request: PushSubscriptionRequest,
  ): Promise<PushSubscriptionDto> {
    const userId = this.requireUser(context);
    return this.unitOfWork.execute(async (tx) => {
      const subscription = {
        userId,
        endpoint: request.endpoint,
        keys: request.keys,
        createdAt: this.clock.now(),
      };
      await tx.pushSubscriptions.upsert(subscription);
      return toPushSubscriptionDto(subscription);
    });
  }

  /** Removing an unknown endpoint is a no-op: the browser may have forgotten it first. */
  async removePushSubscription(context: ActorContext, endpoint: string): Promise<void> {
    const userId = this.requireUser(context);
    await this.unitOfWork.execute((tx) =>
      tx.pushSubscriptions.delete(userId, endpoint),
    );
  }

  private async requireNotification(
    tx: TransactionContext,
    workspaceId: string,
    userId: string,
    notificationId: string,
  ): Promise<NotificationDto> {
    const notification = await tx.notifications.findById(
      workspaceId,
      userId,
      notificationId,
    );
    if (!notification) throw notificationNotFound(notificationId);
    return toNotificationDto(notification);
  }

  private requireUser(context: ActorContext): string {
    if (!context.userId) {
      throw new DomainError(
        "AUTH_FORBIDDEN",
        "Notifications belong to a user; this credential is not tied to one.",
      );
    }
    return context.userId;
  }
}

function notificationNotFound(notificationId: string): DomainError {
  return new DomainError("NOTIFICATION_NOT_FOUND", "Notification not found.", {
    notificationId,
  });
}

function preferenceChanges(
  next: NotificationPreferences,
  previous: NotificationPreferences,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of ["digestTime", "timezone", "defaultOffsetMinutes"] as const) {
    if (next[field] !== previous[field]) {
      changes[field] = { from: previous[field], to: next[field] };
    }
  }
  for (const channel of ["inApp", "email", "push"] as const) {
    if (next.channels[channel] !== previous.channels[channel]) {
      changes[`channels.${channel}`] = {
        from: previous.channels[channel],
        to: next.channels[channel],
      };
    }
  }
  return changes;
}

export type { Notification };
