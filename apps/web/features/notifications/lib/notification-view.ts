import type { NotificationDto, NotificationListResponse } from "@morrowlist/contracts";

/** Pure presentation and cache rules for notifications (GAP-13). */

/** The reminder choices offered in the task detail, in minutes before the due time. */
export const REMINDER_OPTIONS: readonly { value: number | null; label: string }[] = [
  { value: null, label: "No reminder" },
  { value: 0, label: "At the due time" },
  { value: 5, label: "5 minutes before" },
  { value: 15, label: "15 minutes before" },
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 120, label: "2 hours before" },
  { value: 24 * 60, label: "1 day before" },
  { value: 7 * 24 * 60, label: "1 week before" },
];

export function reminderLabel(minutes: number | null): string {
  const known = REMINDER_OPTIONS.find((option) => option.value === minutes);
  if (known) return known.label;
  return `${minutes} minutes before`;
}

/** A list response with one notification replaced; the unread total follows the read state. */
export function patchNotificationInList(
  response: NotificationListResponse,
  notification: NotificationDto,
): NotificationListResponse {
  const previous = response.data.find((candidate) => candidate.id === notification.id);
  const wasUnread = previous?.readAt === null;
  const isUnread = notification.readAt === null;
  const unreadCount =
    wasUnread && !isUnread
      ? Math.max(0, response.unreadCount - 1)
      : !wasUnread && isUnread && previous
        ? response.unreadCount + 1
        : response.unreadCount;
  return {
    ...response,
    data: response.data.map((candidate) =>
      candidate.id === notification.id ? notification : candidate,
    ),
    unreadCount,
  };
}

/** What the bell shows: nothing for zero, the count, or "99+". */
export function unreadBadge(count: number): string {
  if (count <= 0) return "";
  return count > 99 ? "99+" : String(count);
}
