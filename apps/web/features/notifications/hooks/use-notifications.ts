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
import {
  currentSubscription,
  pushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "../lib/push";

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
  push: () => [...notificationKeys.all, "push"] as const,
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

/**
 * Whether this deployment can send push and whether this browser is registered (GAP-13).
 *
 * Server configuration and browser state are one query on purpose: the settings page
 * needs both before it can say anything truthful about the control, and asking for them
 * separately would render a checkbox that flips as the second answer arrives.
 */
export function usePushRegistration() {
  return useQuery({
    queryKey: notificationKeys.push(),
    queryFn: async () => {
      const config = await apiClient.getPushConfig();
      const supported = pushSupported();
      return {
        configured: config.enabled,
        publicKey: config.publicKey,
        supported,
        permission: supported ? Notification.permission : null,
        subscribed: supported ? (await currentSubscription()) !== null : false,
      };
    },
    // Permission can be revoked in browser settings while the page is open, so this is
    // re-read on focus rather than cached for the session.
    refetchOnWindowFocus: true,
  });
}

/**
 * Turn the push channel on or off for this browser. Registration and the preference move
 * together: the channel is never on without a device behind it, and turning it off
 * unregisters rather than leaving the server pushing into a device that ignores it.
 */
export function useSetPushEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      enabled,
      publicKey,
    }: {
      enabled: boolean;
      publicKey: string | null;
    }) => {
      if (enabled) {
        if (!publicKey) throw new Error("This server has no push key configured.");
        const subscription = await subscribeToPush(publicKey);
        // The user dismissed or refused the permission prompt: nothing changes.
        if (!subscription) return false;
        await apiClient.addPushSubscription(subscription);
        await apiClient.updateNotificationPreferences({ channels: { push: true } });
        return true;
      }

      const endpoint = await unsubscribeFromPush();
      if (endpoint) await apiClient.removePushSubscription(endpoint);
      await apiClient.updateNotificationPreferences({ channels: { push: false } });
      return true;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.push() });
      void queryClient.invalidateQueries({ queryKey: notificationKeys.preferences() });
    },
  });
}
