"use client";

import type {
  BoardSwimlane,
  CreateProjectRequest,
  ListProjectsQuery,
  ProjectBoardResponse,
  ProjectDetailDto,
  ProjectDto,
  UpdateProjectRequest,
} from "@morrowlist/contracts";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { apiClient } from "@/lib/api-client";

/**
 * The board variants a project can be cached as: subtasks and deferred tasks shown or
 * hidden, and the swimlane it is pivoted by (GAP-19), because the lanes come back with
 * the projection rather than being derived in the browser.
 */
export interface BoardViewOptions {
  readonly includeSubtasks: boolean;
  readonly includeDeferred: boolean;
  readonly swimlaneBy?: BoardSwimlane;
}

export const projectKeys = {
  all: ["projects"] as const,
  lists: () => [...projectKeys.all, "list"] as const,
  list: (filters: Partial<ListProjectsQuery> = {}) =>
    [...projectKeys.lists(), filters] as const,
  detail: (projectId: string) => [...projectKeys.all, "detail", projectId] as const,
  boards: () => [...projectKeys.all, "board"] as const,
  /** Every cached variant of one project's board, whichever subtask view it shows. */
  projectBoards: (projectId: string) =>
    [...projectKeys.all, "board", projectId] as const,
  board: (projectId: string, view: BoardViewOptions) =>
    [...projectKeys.projectBoards(projectId), view] as const,
};

export function useProjects(filters: Partial<ListProjectsQuery> = {}) {
  return useQuery({
    queryKey: projectKeys.list(filters),
    queryFn: () => apiClient.listProjects(filters),
  });
}

export function useProjectDetail(projectId: string) {
  return useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => apiClient.getProject(projectId),
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: CreateProjectRequest) => apiClient.createProject(request),
    onSuccess: (detail) => {
      queryClient.setQueryData(projectKeys.detail(detail.project.id), detail);
      void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}

/** Apply one authoritative project to the detail and board caches that embed it. */
function patchProjectEverywhere(queryClient: QueryClient, project: ProjectDto): void {
  queryClient.setQueryData<ProjectDetailDto>(
    projectKeys.detail(project.id),
    (detail) => (detail ? { ...detail, project } : detail),
  );
  queryClient.setQueriesData<ProjectBoardResponse>(
    { queryKey: projectKeys.projectBoards(project.id) },
    (board) => (board ? { ...board, data: { ...board.data, project } } : board),
  );
  void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
}

export function useUpdateProject(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: UpdateProjectRequest) =>
      apiClient.updateProject(projectId, request),
    onSuccess: (project) => patchProjectEverywhere(queryClient, project),
  });
}

/** Archived projects leave navigation and their board answers not-found (spec 8.6). */
export function useArchiveProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => apiClient.archiveProject(projectId),
    onSuccess: (project) => {
      queryClient.removeQueries({ queryKey: projectKeys.detail(project.id) });
      queryClient.removeQueries({ queryKey: projectKeys.projectBoards(project.id) });
      void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}

export function useRestoreProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => apiClient.restoreProject(projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}
