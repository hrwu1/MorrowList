"use client";

import type {
  CreateTagRequest,
  TagDto,
  TaskDto,
  UpdateTagRequest,
} from "@morrowlist/contracts";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { sortTags } from "../lib/tags";

import { projectKeys } from "@/features/projects/hooks/use-projects";
import { taskKeys, useTaskAction } from "@/features/tasks/hooks/use-tasks";
import { apiClient } from "@/lib/api-client";

/**
 * Tag server state. A tag's name and colour are embedded in every cached task, so a
 * tag mutation refreshes the task projections as well as the tag list.
 */

export const tagKeys = {
  all: ["tags"] as const,
  list: () => [...tagKeys.all, "list"] as const,
};

function invalidateTagProjections(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: tagKeys.all });
  void queryClient.invalidateQueries({ queryKey: taskKeys.all });
  void queryClient.invalidateQueries({ queryKey: projectKeys.boards() });
}

export function useTags() {
  return useQuery({
    queryKey: tagKeys.list(),
    queryFn: () => apiClient.listTags(),
  });
}

export function useCreateTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateTagRequest) => apiClient.createTag(request),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: tagKeys.all }),
  });
}

export function useUpdateTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tag, patch }: { tag: TagDto; patch: UpdateTagRequest }) =>
      apiClient.updateTag(tag.id, patch),
    onSuccess: () => invalidateTagProjections(queryClient),
  });
}

export function useDeleteTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tag: TagDto) => apiClient.deleteTag(tag.id),
    onSuccess: () => invalidateTagProjections(queryClient),
  });
}

export interface TaskTagInput {
  readonly task: TaskDto;
  readonly tag: TagDto;
}

/** Optimistically add a tag through the shared task patch, keeping the server's order. */
export function useAddTaskTag() {
  return useTaskAction<TaskTagInput>(
    ({ task, tag }) => apiClient.addTaskTag(task.id, tag.id),
    ({ task, tag }) => ({
      ...task,
      tags: sortTags([...task.tags.filter((current) => current.id !== tag.id), tag]),
    }),
    [tagKeys.all],
  );
}

export function useRemoveTaskTag() {
  return useTaskAction<TaskTagInput>(
    ({ task, tag }) => apiClient.removeTaskTag(task.id, tag.id),
    ({ task, tag }) => ({
      ...task,
      tags: task.tags.filter((current) => current.id !== tag.id),
    }),
    [tagKeys.all],
  );
}
