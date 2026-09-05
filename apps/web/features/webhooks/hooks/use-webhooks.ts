"use client";

import type { CreateWebhookRequest, UpdateWebhookRequest } from "@morrowlist/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api-client";

/**
 * Webhook server state (GAP-18). Endpoints change rarely, so nothing is optimistic here;
 * the delivery log is polled while its endpoint is open, because a retry lands minutes
 * later without anything happening in this browser.
 */

/** How often an open delivery log asks for news; the retry ladder starts at a minute. */
export const DELIVERY_POLL_MS = 15_000;

export const webhookKeys = {
  all: ["webhooks"] as const,
  list: () => [...webhookKeys.all, "list"] as const,
  deliveries: (id: string) => [...webhookKeys.all, "deliveries", id] as const,
};

export function useWebhooks() {
  return useQuery({
    queryKey: webhookKeys.list(),
    queryFn: () => apiClient.listWebhooks({ limit: 100 }),
  });
}

export function useWebhookDeliveries(id: string | null) {
  return useQuery({
    queryKey: webhookKeys.deliveries(id ?? "none"),
    queryFn: () => apiClient.listWebhookDeliveries(id as string, { limit: 20 }),
    enabled: id !== null,
    refetchInterval: DELIVERY_POLL_MS,
    // The global 30-second staleTime is right for task data, which only changes because
    // of something this browser did. Deliveries change because a worker somewhere sent a
    // POST, so opening the log must ask rather than answer from a cache.
    staleTime: 0,
  });
}

export function useCreateWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateWebhookRequest) => apiClient.createWebhook(request),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: webhookKeys.list() }),
  });
}

export function useUpdateWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; request: UpdateWebhookRequest }) =>
      apiClient.updateWebhook(input.id, input.request),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: webhookKeys.list() }),
  });
}

export function useDeleteWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.deleteWebhook(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: webhookKeys.all }),
  });
}

export function useTestWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.testWebhook(id),
    // The test writes a delivery row, so an open log is immediately behind.
    onSuccess: (_delivery, id) =>
      void queryClient.invalidateQueries({ queryKey: webhookKeys.deliveries(id) }),
  });
}

export function useRetryDelivery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; deliveryId: string }) =>
      apiClient.retryWebhookDelivery(input.id, input.deliveryId),
    onSuccess: (_delivery, input) =>
      void queryClient.invalidateQueries({
        queryKey: webhookKeys.deliveries(input.id),
      }),
  });
}
