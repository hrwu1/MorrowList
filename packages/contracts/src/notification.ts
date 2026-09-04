import { z } from "zod";

import {
  paginated,
  paginationQuerySchema,
  plainTimeSchema,
  timezoneSchema,
  uuidSchema,
} from "./common.js";
import { reminderOffsetSchema } from "./task.js";

/** Notification transport schemas (GAP-13, spec 20.3 `/notifications`, `/me/*`). */

export const notificationKindSchema = z.enum(["reminder", "digest"]);

export const notificationSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  kind: notificationKindSchema,
  /** Null for a digest, or once the task has been permanently removed. */
  taskId: uuidSchema.nullable(),
  title: z.string(),
  body: z.string(),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export const listNotificationsQuerySchema = paginationQuerySchema.extend({
  /** Only notifications not yet read. */
  unread: z.stringbool().optional(),
});

export const notificationListResponseSchema = paginated(notificationSchema).extend({
  /** Unread across the whole workspace, not just this page: what the bell shows. */
  unreadCount: z.number().int().nonnegative(),
});

export const notificationResponseSchema = z.object({ data: notificationSchema });

export const notificationChannelsSchema = z.object({
  inApp: z.boolean(),
  email: z.boolean(),
  push: z.boolean(),
});

export const notificationPreferencesSchema = z.object({
  workspaceId: uuidSchema,
  channels: notificationChannelsSchema,
  /** Local time of the daily Today digest; null means no digest. */
  digestTime: plainTimeSchema.nullable(),
  /** Null follows the workspace timezone. */
  timezone: timezoneSchema.nullable(),
  /** The reminder offset a newly timed task gets. */
  defaultOffsetMinutes: reminderOffsetSchema,
});

export const updateNotificationPreferencesRequestSchema = z
  .object({
    channels: notificationChannelsSchema.partial().optional(),
    digestTime: plainTimeSchema.nullable().optional(),
    timezone: timezoneSchema.nullable().optional(),
    defaultOffsetMinutes: reminderOffsetSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "at least one field must be supplied",
  });

export const notificationPreferencesResponseSchema = z.object({
  data: notificationPreferencesSchema,
});

/** The browser's `PushSubscription.toJSON()` shape. */
export const pushSubscriptionRequestSchema = z.object({
  endpoint: z.url().max(2000),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

/** Keys are credentials and are never echoed back. */
export const pushSubscriptionSchema = z.object({
  endpoint: z.string(),
  createdAt: z.iso.datetime(),
});

export const pushSubscriptionResponseSchema = z.object({
  data: pushSubscriptionSchema,
});

export type NotificationKind = z.infer<typeof notificationKindSchema>;
export type NotificationDto = z.infer<typeof notificationSchema>;
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;
export type NotificationChannelsDto = z.infer<typeof notificationChannelsSchema>;
export type NotificationPreferencesDto = z.infer<typeof notificationPreferencesSchema>;
export type UpdateNotificationPreferencesRequest = z.infer<
  typeof updateNotificationPreferencesRequestSchema
>;
export type PushSubscriptionRequest = z.infer<typeof pushSubscriptionRequestSchema>;
export type PushSubscriptionDto = z.infer<typeof pushSubscriptionSchema>;
