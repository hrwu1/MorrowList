"use client";

import type {
  CreateFieldRequest,
  FieldDefinitionDto,
  UpdateFieldRequest,
} from "@morrowlist/contracts";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { projectKeys } from "@/features/projects/hooks/use-projects";
import { taskKeys } from "@/features/tasks/hooks/use-tasks";
import { apiClient } from "@/lib/api-client";

/**
 * Typed custom-field server state (GAP-24). A definition's name and card flag are read by
 * every task projection, and deleting one rewrites the values on tasks, so a field
 * mutation refreshes the task caches as well as the field list.
 */

export const fieldKeys = {
  all: ["fields"] as const,
  list: () => [...fieldKeys.all, "list"] as const,
};

function invalidateFieldProjections(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: fieldKeys.all });
  void queryClient.invalidateQueries({ queryKey: taskKeys.all });
  void queryClient.invalidateQueries({ queryKey: projectKeys.boards() });
}

export function useFields() {
  return useQuery({
    queryKey: fieldKeys.list(),
    queryFn: () => apiClient.listFields(),
    // Definitions change rarely and every mutation invalidates them, so the list is read
    // once per session rather than on every remount of a row, a card or a filter panel.
    staleTime: 5 * 60_000,
  });
}

export function useCreateField() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateFieldRequest) => apiClient.createField(request),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: fieldKeys.all }),
  });
}

export function useUpdateField() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      field,
      patch,
    }: {
      field: FieldDefinitionDto;
      patch: UpdateFieldRequest;
    }) => apiClient.updateField(field.id, patch),
    onSuccess: () => invalidateFieldProjections(queryClient),
  });
}

export function useDeleteField() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (field: FieldDefinitionDto) => apiClient.deleteField(field.id),
    onSuccess: () => invalidateFieldProjections(queryClient),
  });
}
