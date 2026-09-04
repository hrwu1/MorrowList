"use client";

import type {
  CreateSavedViewRequest,
  SavedViewDto,
  SavedViewListResponse,
  UpdateSavedViewRequest,
} from "@morrowlist/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api-client";

/**
 * Saved-view server state. Views are personal and few, so the list is the one query;
 * every mutation refreshes it, and a reorder is applied optimistically because the
 * sidebar should move the moment the button is pressed (spec 23.3).
 */

export const savedViewKeys = {
  all: ["savedViews"] as const,
  list: () => [...savedViewKeys.all, "list"] as const,
};

export function useSavedViews() {
  return useQuery({
    queryKey: savedViewKeys.list(),
    queryFn: () => apiClient.listSavedViews(),
  });
}

export function useCreateSavedView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateSavedViewRequest) => apiClient.createSavedView(request),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: savedViewKeys.all }),
  });
}

export function useUpdateSavedView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      view,
      patch,
    }: {
      view: SavedViewDto;
      patch: UpdateSavedViewRequest;
    }) => apiClient.updateSavedView(view.id, patch),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: savedViewKeys.all }),
  });
}

export function useDeleteSavedView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (view: SavedViewDto) => apiClient.deleteSavedView(view.id),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: savedViewKeys.all }),
  });
}

export interface ReorderSavedViewInput {
  readonly view: SavedViewDto;
  readonly direction: "up" | "down";
}

/** Move a view one place in the sidebar; the server computes the rank (spec 24.2). */
export function useReorderSavedView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ view, direction }: ReorderSavedViewInput) => {
      // The cache has already been swapped optimistically by then, so the neighbours
      // come from the server's order: the views either side of the target slot.
      const { data: order } = await apiClient.listSavedViews();
      const index = order.findIndex((candidate) => candidate.id === view.id);
      const target = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= order.length) return view;
      const others = order.filter((candidate) => candidate.id !== view.id);
      return apiClient.reorderSavedView(view.id, {
        beforeViewId: others[target - 1]?.id ?? null,
        afterViewId: others[target]?.id ?? null,
      });
    },
    onMutate: async ({ view, direction }) => {
      await queryClient.cancelQueries({ queryKey: savedViewKeys.all });
      const previous = queryClient.getQueryData<SavedViewListResponse>(
        savedViewKeys.list(),
      );
      if (previous) {
        const order = [...previous.data];
        const index = order.findIndex((candidate) => candidate.id === view.id);
        const target = direction === "up" ? index - 1 : index + 1;
        if (index >= 0 && target >= 0 && target < order.length) {
          [order[index], order[target]] = [order[target] as SavedViewDto, view];
          queryClient.setQueryData<SavedViewListResponse>(savedViewKeys.list(), {
            data: order,
          });
        }
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(savedViewKeys.list(), context.previous);
      }
    },
    onSettled: () =>
      void queryClient.invalidateQueries({ queryKey: savedViewKeys.all }),
  });
}
