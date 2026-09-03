import type { PlainDate, PlainTime, Reminder } from "@morrowlist/domain";

import type { Cursor, Page } from "./tasks.js";

/**
 * Reminder and notification persistence (GAP-13). Implemented by `@morrowlist/database`;
 * the in-memory doubles in `testing/` mirror the same contracts.
 */

export interface ReminderRepository {
  /** Insert the task's one reminder or reschedule it; a rescheduled reminder is pending again. */
  upsert(reminder: Reminder): Promise<void>;
  delete(taskId: string): Promise<void>;
  findByTask(taskId: string): Promise<Reminder | null>;
  /**
   * Atomically mark up to `limit` due, pending reminders as delivered and return them, in
   * firing order. Two concurrent callers never receive the same row (`FOR UPDATE SKIP
   * LOCKED` in SQL), which is what lets several workers run at once.
   */
  claimDue(now: Date, limit: number): Promise<readonly Reminder[]>;
}

export const NOTIFICATION_KINDS = ["reminder", "digest"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface Notification {
  readonly id: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly kind: NotificationKind;
  readonly taskId: string | null;
  readonly title: string;
  readonly body: string;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

export interface NotificationRepository {
  insert(notification: Notification): Promise<void>;
  findById(
    workspaceId: string,
    userId: string,
    notificationId: string,
  ): Promise<Notification | null>;
  /** One user's notifications in a workspace, newest first, keyset-paged on `(createdAt, id)`. */
  list(
    workspaceId: string,
    userId: string,
    cursor: Cursor,
    unreadOnly: boolean,
  ): Promise<Page<Notification>>;
  /** Returns false when the notification is unknown to this user; already-read is a no-op. */
  markRead(
    workspaceId: string,
    userId: string,
    notificationId: string,
    readAt: Date,
  ): Promise<boolean>;
  countUnread(workspaceId: string, userId: string): Promise<number>;
}

export interface NotificationChannels {
  readonly inApp: boolean;
  readonly email: boolean;
  readonly push: boolean;
}

export interface NotificationPreferences {
  readonly userId: string;
  readonly workspaceId: string;
  readonly channels: NotificationChannels;
  /** Wall-clock time of the daily digest in `timezone`; null means no digest. */
  readonly digestTime: PlainTime | null;
  /** Null falls back to the workspace timezone. */
  readonly timezone: string | null;
  /** The offset a newly timed task receives (spec: configurable per workspace). */
  readonly defaultOffsetMinutes: number;
  /** The last local date a digest was claimed for, so it goes out once a day at most. */
  readonly lastDigestDate: PlainDate | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NotificationPreferenceRepository {
  find(userId: string, workspaceId: string): Promise<NotificationPreferences | null>;
  upsert(preferences: NotificationPreferences): Promise<void>;
  /** Every row with a digest time set, across workspaces, for the worker's sweep. */
  listWithDigest(): Promise<readonly NotificationPreferences[]>;
  /**
   * Claim the digest for `date`: true when this caller advanced `lastDigestDate` and must
   * send, false when it was already claimed. Atomic, so two workers never both send.
   */
  claimDigest(userId: string, workspaceId: string, date: PlainDate): Promise<boolean>;
}

export interface PushSubscription {
  readonly userId: string;
  readonly endpoint: string;
  /** Browser-issued keys; credentials, never logged or put in an event payload. */
  readonly keys: { readonly p256dh: string; readonly auth: string };
  readonly createdAt: Date;
}

export interface PushSubscriptionRepository {
  upsert(subscription: PushSubscription): Promise<void>;
  /** Returns false when nothing was registered for that endpoint. */
  delete(userId: string, endpoint: string): Promise<boolean>;
  listForUser(userId: string): Promise<readonly PushSubscription[]>;
}
