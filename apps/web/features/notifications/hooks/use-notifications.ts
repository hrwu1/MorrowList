"use client";

import type {
  NotificationDto,
  NotificationListResponse,
  UpdateNotificationPreferencesRequest,
} from "@morrowlist/contracts";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { patchNotificationInList } from "../lib/notification-view";

import { activityKeys } from "@/features/activity/hooks/use-activity";
import { apiClient } from "@/lib/api-client";

/**
 * Notification server state (GAP-13). The list is polled, because reminders arrive from
 * the worker rather than from anything this browser did; reads and snoozes are applied
 * optimistically to every cached list through one patch.
 */

/** How often the bell and the list ask for news; a reminder is never more than this late. */
export const NOTIFICATION_POLL_MS = 30_000;

export const notificationKeys = {
  all: ["notifications"] as const,
  lists: () => [...notificationKeys.all, "list"] as const,
  list: (unread: boolean) => [...notificationKeys.lists(), { unread }] as const,
  badge: () => [...notificationKeys.all, "badge"] as const,
  preferences: () => [...notificationKeys.all, "preferences"] as const,
};

export function useNotifications(unread: boolean) {
  return useQuery({
    queryKey: notificationKeys.list(unread),
    queryFn: () => apiClient.listNotifications({ unread, limit: 100 }),
    refetchInterval: NOTIFICATION_POLL_MS,
  });
}

/** The unread total for the bell: the smallest list request carries it. */
export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.badge(),
    queryFn: async () => (await apiClient.listNotifications({ limit: 1 })).unreadCount,
    refetchInterval: NOTIFICATION_POLL_MS,
  });
}

function patchEverywhere(
  queryClient: QueryClient,
  notification: NotificationDto,
): void {
  for (const [key, current] of queryClient.getQueriesData<NotificationListResponse>({
    queryKey: notificationKeys.lists(),
  })) {
    if (current)
      queryClient.setQueryData(key, patchNotificationInList(current, notification));
  }
}

function invalidate(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
  // A snooze records task history, so any open activity list is behind.
  void queryClient.invalidateQueries({ queryKey: activityKeys.all });
}

function useNotificationAction(
  send: (notification: NotificationDto) => Promise<NotificationDto>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: send,
    onMutate: async (notification) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.all });
      const previous = queryClient.getQueriesData<NotificationListResponse>({
        queryKey: notificationKeys.lists(),
      });
      patchEverywhere(queryClient, {
        ...notification,
        readAt: notification.readAt ?? new Date().toISOString(),
      });
      queryClient.setQueryData<number>(notificationKeys.badge(), (count) =>
        notification.readAt === null && count ? count - 1 : count,
      );
      return { previous };
    },
    onError: (_error, _notification, context) => {
      for (const [key, value] of context?.previous ?? []) {
        queryClient.setQueryData(key, value);
      }
    },
    onSuccess: (updated) => patchEverywhere(queryClient, updated),
    onSettled: () => invalidate(queryClient),
  });
}

export function useMarkNotificationRead() {
  return useNotificationAction((notification) =>
    apiClient.markNotificationRead(notification.id),
  );
}

export function useSnoozeNotification() {
  return useNotificationAction((notification) =>
    apiClient.snoozeNotification(notification.id),
  );
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: notificationKeys.preferences(),
    queryFn: () => apiClient.getNotificationPreferences(),
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateNotificationPreferencesRequest) =>
      apiClient.updateNotificationPreferences(patch),
    onSuccess: (updated) =>
      queryClient.setQueryData(notificationKeys.preferences(), updated),
    onSettled: () =>
      void queryClient.invalidateQueries({ queryKey: notificationKeys.preferences() }),
  });
}
