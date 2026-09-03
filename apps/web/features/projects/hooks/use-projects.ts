"use client";

import type { CreateProjectRequest } from "@morrowlist/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api-client";

export const projectKeys = {
  all: ["projects"] as const,
  list: () => [...projectKeys.all, "list"] as const,
  detail: (projectId: string) => [...projectKeys.all, "detail", projectId] as const,
  boards: () => [...projectKeys.all, "board"] as const,
  /** Every cached variant of one project's board, whichever subtask view it shows. */
  projectBoards: (projectId: string) =>
    [...projectKeys.all, "board", projectId] as const,
  board: (projectId: string, includeSubtasks: boolean) =>
    [...projectKeys.projectBoards(projectId), { includeSubtasks }] as const,
};

export function useProjects() {
  return useQuery({
    queryKey: projectKeys.list(),
    queryFn: () => apiClient.listProjects(),
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: CreateProjectRequest) => apiClient.createProject(request),
    onSuccess: (detail) => {
      queryClient.setQueryData(projectKeys.detail(detail.project.id), detail);
      void queryClient.invalidateQueries({ queryKey: projectKeys.list() });
    },
  });
}
