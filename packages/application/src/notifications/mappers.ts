import type {
  NotificationDto,
  NotificationPreferencesDto,
  PushSubscriptionDto,
} from "@morrowlist/contracts";
import { DEFAULT_REMINDER_OFFSET_MINUTES } from "@morrowlist/domain";

import type {
  Notification,
  NotificationPreferences,
  PushSubscription,
} from "../ports/index.js";

/** Domain-to-contract mapping for notifications (GAP-13). */

export function toNotificationDto(notification: Notification): NotificationDto {
  return {
    id: notification.id,
    workspaceId: notification.workspaceId,
    kind: notification.kind,
    taskId: notification.taskId,
    title: notification.title,
    body: notification.body,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  };
}

/**
 * What a user gets before they have chosen anything: in-app reminders only, no digest.
 * Email and push are opt-in so nobody is mailed by a workspace they never configured.
 */
export function defaultPreferences(
  userId: string,
  workspaceId: string,
  now: Date,
): NotificationPreferences {
  return {
    userId,
    workspaceId,
    channels: { inApp: true, email: false, push: false },
    digestTime: null,
    timezone: null,
    defaultOffsetMinutes: DEFAULT_REMINDER_OFFSET_MINUTES,
    lastDigestDate: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function toPreferencesDto(
  preferences: NotificationPreferences,
): NotificationPreferencesDto {
  return {
    workspaceId: preferences.workspaceId,
    channels: preferences.channels,
    digestTime: preferences.digestTime,
    timezone: preferences.timezone,
    defaultOffsetMinutes: preferences.defaultOffsetMinutes,
  };
}

export function toPushSubscriptionDto(
  subscription: PushSubscription,
): PushSubscriptionDto {
  return {
    endpoint: subscription.endpoint,
    createdAt: subscription.createdAt.toISOString(),
  };
}
