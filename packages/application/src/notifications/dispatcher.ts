import { TASK_EVENTS, WORKSPACE_EVENTS } from "@morrowlist/contracts";
import {
  systemClock,
  taskKey,
  toLocalDate,
  toLocalTime,
  todaySections,
  uuidv7,
  type Clock,
  type PlainDate,
  type Task,
  type TodaySection,
} from "@morrowlist/domain";
import type { Logger } from "@morrowlist/observability";

import type {
  NotificationPreferences,
  PushSubscription as PushSubscriptionRecord,
  TransactionContext,
  UnitOfWork,
  UserDirectory,
  Workspace,
} from "../ports/index.js";
import type { ActorContext } from "../shared/actor-context.js";
import { recordEvent } from "../shared/event-recorder.js";

import type { EmailMessage, EmailSender } from "./email.js";
import { loadNotificationPreferences } from "./preferences.js";
import { endpointOrigin, type PushSender } from "./push.js";

/** Claims and records notifications transactionally, then delivers through sender ports. */
export interface NotificationDispatcherOptions {
  readonly unitOfWork: UnitOfWork;
  readonly clock?: Clock;
  readonly emailSender: EmailSender;
  readonly pushSender: PushSender;
  readonly userDirectory: UserDirectory;
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

/**
 * One push, addressed to a user rather than to a device: the devices are read after the
 * transaction commits, so a browser registered a moment ago still gets this notification
 * and one unregistered a moment ago does not.
 */
interface OutgoingPush {
  readonly userId: string;
  readonly title: string;
  readonly body: string;
  readonly url: string;
  /** Collapse key: a replacement for this notification lands on top of it, not beside it. */
  readonly tag: string;
}

/** What one delivery decided to send once its transaction commits. */
interface Outgoing {
  readonly emails: readonly OutgoingEmail[];
  readonly pushes: readonly OutgoingPush[];
}

const WORKER_ACTOR = { actorKind: "system", actorId: "notification-worker" } as const;

export class NotificationDispatcher {
  private readonly unitOfWork: UnitOfWork;
  private readonly clock: Clock;
  private readonly emailSender: EmailSender;
  private readonly pushSender: PushSender;
  private readonly userDirectory: UserDirectory;
  private readonly appUrl: string;
  private readonly logger: Logger | undefined;

  constructor(options: NotificationDispatcherOptions) {
    this.unitOfWork = options.unitOfWork;
    this.clock = options.clock ?? systemClock;
    this.emailSender = options.emailSender;
    this.pushSender = options.pushSender;
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
        const pushes: OutgoingPush[] = [];
        for (const reminder of claimed) {
          const task = await tx.tasks.findById(reminder.workspaceId, reminder.taskId);
          const workspace = await tx.workspaces.findById(reminder.workspaceId);
          // The schedule is recomputed by every task command, so this only guards a row
          // the cascade has not caught up with; nothing is sent for a dead task.
          if (!task || !workspace || task.completedAt || task.deletedAt) continue;
          const outgoing = await this.deliverReminder(
            tx,
            workspace,
            task,
            reminder,
            now,
          );
          emails.push(...outgoing.emails);
          pushes.push(...outgoing.pushes);
        }
        return { count: claimed.length, emails, pushes };
      });
      await this.sendEmails(batch.emails);
      await this.sendPushes(batch.pushes);
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
      const outgoing = await this.unitOfWork.execute(async (tx) => {
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
      if (!outgoing) continue;
      sent += 1;
      await this.sendEmails(outgoing.emails);
      await this.sendPushes(outgoing.pushes);
    }
    return sent;
  }

  private async deliverReminder(
    tx: TransactionContext,
    workspace: Workspace,
    task: Task,
    reminder: { remindAt: Date },
    now: Date,
  ): Promise<Outgoing> {
    const key = taskKey(workspace.taskKeyPrefix, task.taskNumber);
    const when = `${task.dueDate} at ${task.dueTime} (${task.dueTimezone ?? workspace.timezone})`;
    const title = `Reminder: ${task.title}`;
    const body = `${key} is due ${when}.`;
    const url = `${this.appUrl}/tasks/${encodeURIComponent(key)}`;
    const emails: OutgoingEmail[] = [];
    const pushes: OutgoingPush[] = [];
    const recipients: string[] = [];
    const channels = new Set<string>();

    for (const member of await tx.workspaces.listMembers(workspace.id)) {
      const preferences = await loadNotificationPreferences(
        tx,
        member.userId,
        workspace.id,
        this.clock.now(),
      );
      if (
        !preferences.channels.inApp &&
        !preferences.channels.email &&
        !preferences.channels.push
      ) {
        continue;
      }
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
          text: `${body}\n\nOpen it: ${url}\n`,
        });
      }
      if (preferences.channels.push) {
        channels.add("push");
        // Tagged by the task, so a snoozed reminder replaces the one it follows rather
        // than leaving two notifications for the same task on the lock screen.
        pushes.push({
          userId: member.userId,
          title,
          body,
          url,
          tag: `reminder:${task.id}`,
        });
      }
    }

    await recordEvent(tx, this.workerContext(workspace.id), this.clock, {
      workspaceId: workspace.id,
      aggregateType: "task",
      aggregateId: task.id,
      eventType: TASK_EVENTS.reminderSent,
      // Like `task.created`, this entry hangs off the task itself, so naming its key
      // would only add something that goes stale when the prefix is renamed.
      summary: "Sent reminder",
      payload: {
        taskId: task.id,
        remindAt: reminder.remindAt.toISOString(),
        recipients,
        channels: [...channels].sort(),
      },
    });
    return { emails, pushes };
  }

  /** What to send after the claim commits, or null for an empty day: nothing is sent then. */
  private async deliverDigest(
    tx: TransactionContext,
    workspace: Workspace,
    preferences: NotificationPreferences,
    date: PlainDate,
    now: Date,
  ): Promise<Outgoing | null> {
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

    return {
      emails: preferences.channels.email
        ? [
            {
              userId: preferences.userId,
              subject: `${title} — MorrowList digest for ${date}`,
              text: `${body}\n\nOpen Today: ${this.appUrl}/today\n`,
            },
          ]
        : [],
      pushes: preferences.channels.push
        ? [
            {
              userId: preferences.userId,
              title,
              // A lock screen has no room for the whole list; the count is the point.
              body: `Open Today to see what you planned for ${date}.`,
              url: `${this.appUrl}/today`,
              tag: `digest:${date}`,
            },
          ]
        : [],
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

  /**
   * Deliver every push this batch decided on, after its transaction has committed.
   *
   * A device the push service reports gone is deleted, so a browser the user cleared
   * stops being retried on every reminder; every other failure is logged and dropped,
   * exactly as a failed email is — the in-app row is already committed and the user has
   * been told, so there is nothing to roll back and nothing to retry.
   */
  private async sendPushes(pushes: readonly OutgoingPush[]): Promise<void> {
    if (pushes.length === 0) return;

    const devices = new Map<string, readonly PushSubscriptionRecord[]>();
    const gone: PushSubscriptionRecord[] = [];

    for (const push of pushes) {
      let subscriptions = devices.get(push.userId);
      if (!subscriptions) {
        subscriptions = await this.unitOfWork.execute((tx) =>
          tx.pushSubscriptions.listForUser(push.userId),
        );
        devices.set(push.userId, subscriptions);
      }

      for (const subscription of subscriptions) {
        try {
          const result = await this.pushSender.send({
            subscription,
            title: push.title,
            body: push.body,
            url: push.url,
            tag: push.tag,
          });
          if (result.ok) continue;
          if (result.gone) gone.push(subscription);
          else {
            this.logger?.warn("notification push failed", {
              userId: push.userId,
              endpoint: endpointOrigin(subscription.endpoint),
              error: result.error,
            });
          }
        } catch (error) {
          this.logger?.error("notification push failed", {
            userId: push.userId,
            endpoint: endpointOrigin(subscription.endpoint),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    for (const subscription of gone) {
      await this.unitOfWork.execute((tx) =>
        tx.pushSubscriptions.delete(subscription.userId, subscription.endpoint),
      );
      this.logger?.info("removed a push subscription the service reported gone", {
        userId: subscription.userId,
        endpoint: endpointOrigin(subscription.endpoint),
      });
    }
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
