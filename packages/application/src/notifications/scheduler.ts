import {
  DEFAULT_REMINDER_OFFSET_MINUTES,
  scheduleReminder,
  type Task,
} from "@morrowlist/domain";

import type { TransactionContext } from "../ports/index.js";
import type { ActorContext } from "../shared/actor-context.js";

/**
 * Reminder schedule maintenance (GAP-13). Runs inside the task command's transaction, so
 * the schedule can never disagree with the task it was derived from: a due-time edit,
 * completion, trashing, or restore rewrites or removes the one reminder row together
 * with the task row and its events.
 */
export async function recomputeReminder(
  tx: TransactionContext,
  task: Task,
  workspaceTimezone: string,
  now: Date,
): Promise<void> {
  const remindAt = scheduleReminder(task, workspaceTimezone, now);
  if (remindAt === null || task.reminderOffsetMinutes === null) {
    await tx.reminders.delete(task.id);
    return;
  }

  // An unchanged schedule keeps its delivered state; a moved one is pending again so the
  // user hears about the new time exactly once.
  const existing = await tx.reminders.findByTask(task.id);
  if (
    existing &&
    existing.remindAt.getTime() === remindAt.getTime() &&
    existing.offsetMinutes === task.reminderOffsetMinutes
  ) {
    return;
  }
  await tx.reminders.upsert({
    taskId: task.id,
    workspaceId: task.workspaceId,
    remindAt,
    offsetMinutes: task.reminderOffsetMinutes,
    deliveredAt: null,
  });
}

/** The offset a newly timed task receives: the user's workspace preference, else 30. */
export async function defaultReminderOffset(
  tx: TransactionContext,
  context: ActorContext,
  workspaceId: string,
): Promise<number> {
  if (!context.userId) return DEFAULT_REMINDER_OFFSET_MINUTES;
  const preferences = await tx.notificationPreferences.find(
    context.userId,
    workspaceId,
  );
  return preferences?.defaultOffsetMinutes ?? DEFAULT_REMINDER_OFFSET_MINUTES;
}
