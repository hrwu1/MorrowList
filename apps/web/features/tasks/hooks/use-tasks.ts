"use client";

import type { CreateTaskRequest, TaskDto } from "@morrowlist/contracts";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import { apiClient } from "@/lib/api-client";

/**
 * Task server state (spec 23.2, 23.3).
 *
 * Query keys are structured so one mutation can invalidate every projection that shows a
 * task, without a component needing to know which other views exist.
 */

export const taskKeys = {
  all: ["tasks"] as const,
  lists: () => [...taskKeys.all, "list"] as const,
  list: (filters: Record<string, unknown>) =>
    [...taskKeys.lists(), filters] as const satisfies QueryKey,
  detail: (id: string) => [...taskKeys.all, "detail", id] as const,
};

export function useInboxTasks() {
  const filters = { inbox: true, isCompleted: false };
  return useQuery({
    queryKey: taskKeys.list(filters),
    queryFn: () => apiClient.listTasks(filters),
  });
}

export function useCompletedTasks() {
  const filters = { isCompleted: true };
  return useQuery({
    queryKey: taskKeys.list(filters),
    queryFn: () => apiClient.listTasks(filters),
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateTaskRequest) => apiClient.createTask(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}

/**
 * Completion is applied optimistically and rolled back on failure (spec 23.3). The
 * server's `version` is authoritative, so a conflict surfaces rather than being
 * overwritten by the local guess.
 */
export function useCompleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (task: TaskDto) => apiClient.completeTask(task.id, task.version),
    onMutate: async (task) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.lists() });
      const previous = queryClient.getQueriesData({ queryKey: taskKeys.lists() });

      queryClient.setQueriesData<{ data: TaskDto[] }>(
        { queryKey: taskKeys.lists() },
        (current) =>
          current
            ? { ...current, data: current.data.filter((t) => t.id !== task.id) }
            : current,
      );

      return { previous };
    },
    onError: (_error, _task, context) => {
      for (const [key, value] of context?.previous ?? []) {
        queryClient.setQueryData(key, value);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}

export function useReopenTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (task: TaskDto) => apiClient.reopenTask(task.id, task.version),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (task: TaskDto) => apiClient.deleteTask(task.id),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}
