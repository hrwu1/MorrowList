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
  taskKey,
  toLocalDate,
  toLocalTime,
  toPlainTime,
  toReminderOffset,
  toTimezone,
  todaySections,
  uuidv7,
  type Clock,
  type PlainDate,
  type Task,
  type TodaySection,
} from "@morrowlist/domain";
import type { Logger } from "@morrowlist/observability";

import type {
  Notification,
  NotificationPreferences,
  TransactionContext,
  UnitOfWork,
  UserDirectory,
  Workspace,
} from "../ports/index.js";
import {
  SCOPES,
  assertScope,
  assertWorkspaceAccess,
  type ActorContext,
} from "../shared/actor-context.js";
import { decodeCursor, encodeCursor } from "../shared/cursor.js";
import { recordEvent } from "../shared/event-recorder.js";

import type { EmailMessage, EmailSender } from "./email.js";
import {
  defaultPreferences,
  toNotificationDto,
  toPreferencesDto,
  toPushSubscriptionDto,
} from "./mappers.js";

/**
 * Notifications (GAP-13). Two halves: delivery, driven by the worker and acting as the
 * system, and the user-facing queries and commands the API exposes.
 *
 * Delivery claims work inside a transaction, writes the in-app rows and events there, and
 * only sends email after the commit; a reminder is therefore delivered exactly once even
 * with several workers, and a mail failure can never roll back what the user was told.
 */

export interface NotificationServiceOptions {
  readonly unitOfWork: UnitOfWork;
  readonly clock?: Clock;
  readonly cursorSecret: string;
  readonly emailSender: EmailSender;
  readonly userDirectory: UserDirectory;
  /** Base URL for links in email, e.g. `https://morrow.example`. */
  readonly appUrl: string;
  readonly logger?: Logger;
}

/** How many due reminders one claim takes; the worker loops until a claim comes back short. */
export const DELIVERY_BATCH_SIZE = 50;

interface OutgoingEmail {
  readonly userId: string;
  readonly subject: string;
  readonly text: string;
}

const WORKER_ACTOR = { actorKind: "system", actorId: "notification-worker" } as const;

export class NotificationService {
  private readonly unitOfWork: UnitOfWork;
  private readonly clock: Clock;
  private readonly cursorSecret: string;
  private readonly emailSender: EmailSender;
  private readonly userDirectory: UserDirectory;
  private readonly appUrl: string;
  private readonly logger: Logger | undefined;

  constructor(options: NotificationServiceOptions) {
    this.unitOfWork = options.unitOfWork;
    this.clock = options.clock ?? systemClock;
    this.cursorSecret = options.cursorSecret;
    this.emailSender = options.emailSender;
    this.userDirectory = options.userDirectory;
    this.appUrl = options.appUrl.replace(/\/+$/, "");
    this.logger = options.logger;
  }

  /**
   * Deliver every reminder due by `now`. Returns how many were claimed. Safe to call from
   * several processes at once: each claim is `FOR UPDATE SKIP LOCKED`.
   */
  async deliverDue(now: Date = this.clock.now()): Promise<number> {
    let delivered = 0;
    for (;;) {
      const batch = await this.unitOfWork.execute(async (tx) => {
        const claimed = await tx.reminders.claimDue(now, DELIVERY_BATCH_SIZE);
        const emails: OutgoingEmail[] = [];
        for (const reminder of claimed) {
          const task = await tx.tasks.findById(reminder.workspaceId, reminder.taskId);
          const workspace = await tx.workspaces.findById(reminder.workspaceId);
          // The schedule is recomputed by every task command, so this only guards a row
          // the cascade has not caught up with; nothing is sent for a dead task.
          if (!task || !workspace || task.completedAt || task.deletedAt) continue;
          emails.push(
            ...(await this.deliverReminder(tx, workspace, task, reminder, now)),
          );
        }
        return { count: claimed.length, emails };
      });
      await this.sendEmails(batch.emails);
      delivered += batch.count;
      if (batch.count < DELIVERY_BATCH_SIZE) return delivered;
    }
  }

  /**
   * Send the daily Today digest to every user whose digest time has passed in their own
   * timezone and who has not had one for that local date. An empty Today is claimed but
   * sends nothing (spec 15: no notification floods). Returns how many were sent.
   */
  async digest(now: Date = this.clock.now()): Promise<number> {
    const candidates = await this.unitOfWork.execute((tx) =>
      tx.notificationPreferences.listWithDigest(),
    );
    let sent = 0;
    for (const preferences of candidates) {
      if (preferences.digestTime === null) continue;
      const email = await this.unitOfWork.execute(async (tx) => {
        const workspace = await tx.workspaces.findById(preferences.workspaceId);
        if (!workspace) return null;
        const timezone = preferences.timezone ?? workspace.timezone;
        const date = toLocalDate(now, timezone);
        if (toLocalTime(now, timezone) < (preferences.digestTime as string))
          return null;
        if (
          !(await tx.notificationPreferences.claimDigest(
            preferences.userId,
            preferences.workspaceId,
            date,
          ))
        ) {
          return null;
        }
        return this.deliverDigest(tx, workspace, preferences, date, now);
      });
      if (!email) continue;
      sent += 1;
      await this.sendEmails(email === true ? [] : [email]);
    }
    return sent;
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
      toPreferencesDto(await this.loadPreferences(tx, userId, workspaceId)),
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
      const current = await this.loadPreferences(tx, userId, workspaceId);
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

  private async deliverReminder(
    tx: TransactionContext,
    workspace: Workspace,
    task: Task,
    reminder: { remindAt: Date },
    now: Date,
  ): Promise<OutgoingEmail[]> {
    const key = taskKey(workspace.taskKeyPrefix, task.taskNumber);
    const when = `${task.dueDate} at ${task.dueTime} (${task.dueTimezone ?? workspace.timezone})`;
    const title = `Reminder: ${task.title}`;
    const body = `${key} is due ${when}.`;
    const emails: OutgoingEmail[] = [];
    const recipients: string[] = [];
    const channels = new Set<string>();

    for (const member of await tx.workspaces.listMembers(workspace.id)) {
      const preferences = await this.loadPreferences(tx, member.userId, workspace.id);
      if (!preferences.channels.inApp && !preferences.channels.email) continue;
      recipients.push(member.userId);
      if (preferences.channels.inApp) {
        channels.add("inApp");
        await tx.notifications.insert({
          id: uuidv7(),
          workspaceId: workspace.id,
          userId: member.userId,
          kind: "reminder",
          taskId: task.id,
          title,
          body,
          readAt: null,
          createdAt: now,
        });
      }
      if (preferences.channels.email) {
        channels.add("email");
        emails.push({
          userId: member.userId,
          subject: title,
          text: `${body}\n\nOpen it: ${this.appUrl}/tasks/${encodeURIComponent(key)}\n`,
        });
      }
    }

    await recordEvent(tx, this.workerContext(workspace.id), this.clock, {
      workspaceId: workspace.id,
      aggregateType: "task",
      aggregateId: task.id,
      eventType: TASK_EVENTS.reminderSent,
      summary: `Sent reminder for ${key}`,
      payload: {
        taskId: task.id,
        remindAt: reminder.remindAt.toISOString(),
        recipients,
        channels: [...channels].sort(),
      },
    });
    return emails;
  }

  /** Returns the email to send, `true` when only the in-app row was written, or null for an empty day. */
  private async deliverDigest(
    tx: TransactionContext,
    workspace: Workspace,
    preferences: NotificationPreferences,
    date: PlainDate,
    now: Date,
  ): Promise<OutgoingEmail | true | null> {
    const page = await tx.tasks.listToday({ workspaceId: workspace.id, date });
    const plans = await tx.dayPlans.listForTasks(
      page.items.map((task) => task.id),
      date,
    );
    const planned = new Set(
      page.items
        .filter((task) => plans.get(task.id)?.includes(date))
        .map((task) => task.id),
    );
    const sections = todaySections(page.items, planned, date);
    const total = sections.reduce((sum, section) => sum + section.tasks.length, 0);
    if (total === 0) return null;

    const title = `Today: ${total} ${total === 1 ? "task" : "tasks"}`;
    const body = digestBody(sections, workspace.taskKeyPrefix);
    if (preferences.channels.inApp) {
      await tx.notifications.insert({
        id: uuidv7(),
        workspaceId: workspace.id,
        userId: preferences.userId,
        kind: "digest",
        taskId: null,
        title,
        body,
        readAt: null,
        createdAt: now,
      });
    }
    await recordEvent(tx, this.workerContext(workspace.id), this.clock, {
      workspaceId: workspace.id,
      aggregateType: "workspace",
      aggregateId: workspace.id,
      eventType: WORKSPACE_EVENTS.digestSent,
      summary: `Sent Today digest for ${date}`,
      payload: {
        workspaceId: workspace.id,
        userId: preferences.userId,
        date,
        counts: Object.fromEntries(
          sections.map((section) => [section.id, section.tasks.length]),
        ),
      },
    });

    if (!preferences.channels.email) return true;
    return {
      userId: preferences.userId,
      subject: `${title} — MorrowList digest for ${date}`,
      text: `${body}\n\nOpen Today: ${this.appUrl}/today\n`,
    };
  }

  private async sendEmails(emails: readonly OutgoingEmail[]): Promise<void> {
    for (const email of emails) {
      const user = await this.userDirectory.findById(email.userId);
      if (!user) continue;
      const message: EmailMessage = {
        to: user.email,
        subject: email.subject,
        text: email.text,
      };
      try {
        await this.emailSender.send(message);
      } catch (error) {
        // The in-app row is already committed; a mail failure is logged, not retried.
        this.logger?.error("notification email failed", {
          userId: email.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async loadPreferences(
    tx: TransactionContext,
    userId: string,
    workspaceId: string,
  ): Promise<NotificationPreferences> {
    return (
      (await tx.notificationPreferences.find(userId, workspaceId)) ??
      defaultPreferences(userId, workspaceId, this.clock.now())
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

  private workerContext(workspaceId: string): ActorContext {
    return {
      ...WORKER_ACTOR,
      actorDisplayName: "MorrowList",
      workspaceIds: [workspaceId],
      scopes: new Set(),
      requestId: `worker_${uuidv7()}`,
    };
  }
}

function notificationNotFound(notificationId: string): DomainError {
  return new DomainError("NOTIFICATION_NOT_FOUND", "Notification not found.", {
    notificationId,
  });
}

const SECTION_LABELS: Record<TodaySection["id"], string> = {
  overdue: "Overdue",
  due_today: "Due today",
  my_day: "My Day",
};

function digestBody(sections: readonly TodaySection[], prefix: string): string {
  return sections
    .filter((section) => section.tasks.length > 0)
    .map((section) =>
      [
        `${SECTION_LABELS[section.id]} (${section.tasks.length})`,
        ...section.tasks.map(
          ({ task }) =>
            `- ${taskKey(prefix, task.taskNumber)} ${task.title}${task.dueTime ? ` at ${task.dueTime}` : ""}`,
        ),
      ].join("\n"),
    )
    .join("\n\n");
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
