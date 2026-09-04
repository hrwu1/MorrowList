"use client";

import type { NotificationDto } from "@morrowlist/contracts";
import { Alert, Button, EmptyState, Spinner } from "@morrowlist/ui";
import Link from "next/link";
import { useState } from "react";

import {
  useMarkNotificationRead,
  useNotifications,
  useSnoozeNotification,
} from "../hooks/use-notifications";

import { absoluteTime, relativeTime } from "@/features/activity/lib/activity-view";

/** The in-app inbox (GAP-13): reminders and digests, newest first, with read and snooze. */
export function NotificationListPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const notifications = useNotifications(unreadOnly);

  return (
    <div className="notifications stack">
      <header className="page-header notifications__header">
        <div>
          <h1>Notifications</h1>
          <p className="page-header__subtitle">
            Reminders before a due time and your daily Today digest.{" "}
            <Link href="/settings/notifications">Change what you receive</Link>.
          </p>
        </div>
        <label className="notifications__filter">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(event) => setUnreadOnly(event.target.checked)}
          />
          Unread only
        </label>
      </header>

      {notifications.isPending ? (
        <div className="task-list__status">
          <Spinner label="Loading notifications" />
        </div>
      ) : notifications.isError ? (
        <Alert tone="error" title="Notifications could not be loaded">
          <p>
            {notifications.error instanceof Error
              ? notifications.error.message
              : "Something went wrong."}
          </p>
          <Button onClick={() => void notifications.refetch()}>Try again</Button>
        </Alert>
      ) : notifications.data.data.length === 0 ? (
        <EmptyState
          title={unreadOnly ? "Nothing unread" : "No notifications yet"}
          description="Give a task a due time and a reminder will land here before it is due."
        />
      ) : (
        <ul className="notifications__list" aria-label="Notifications">
          {notifications.data.data.map((notification) => (
            <NotificationRow key={notification.id} notification={notification} />
          ))}
        </ul>
      )}
    </div>
  );
}

function NotificationRow({ notification }: { readonly notification: NotificationDto }) {
  const markRead = useMarkNotificationRead();
  const snooze = useSnoozeNotification();
  const unread = notification.readAt === null;
  const busy = markRead.isPending || snooze.isPending;

  return (
    <li className="notification" data-unread={unread || undefined}>
      <div className="notification__body">
        <p className="notification__title">
          {unread ? <span className="notification__dot" aria-label="Unread" /> : null}
          {notification.taskId ? (
            <Link href={`/tasks/${encodeURIComponent(notification.taskId)}`}>
              {notification.title}
            </Link>
          ) : (
            notification.title
          )}
        </p>
        <p className="notification__text">{notification.body}</p>
        <time
          className="task-detail__hint"
          dateTime={notification.createdAt}
          title={absoluteTime(notification.createdAt)}
        >
          {relativeTime(notification.createdAt, Date.now())}
        </time>
      </div>
      <div className="notification__actions">
        {unread ? (
          <Button
            variant="ghost"
            loading={markRead.isPending}
            disabled={busy}
            aria-label={`Mark ${notification.title} read`}
            onClick={() => markRead.mutate(notification)}
          >
            Mark read
          </Button>
        ) : null}
        {notification.kind === "reminder" && notification.taskId ? (
          <Button
            variant="ghost"
            loading={snooze.isPending}
            disabled={busy}
            aria-label={`Snooze ${notification.title} for an hour`}
            onClick={() => snooze.mutate(notification)}
          >
            Remind in 1 hour
          </Button>
        ) : null}
      </div>
      {markRead.isError || snooze.isError ? (
        <div className="notification__error">
          <Alert tone="error">
            {(markRead.error ?? snooze.error) instanceof Error
              ? (markRead.error ?? snooze.error)?.message
              : "That did not work. Try again."}
          </Alert>
        </div>
      ) : null}
    </li>
  );
}
