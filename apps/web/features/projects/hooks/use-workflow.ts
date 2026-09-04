"use client";

import { ApiClientError } from "@morrowlist/api-client";
import type {
  ArchiveStatusRequest,
  CreateStatusRequest,
  ProjectBoardResponse,
  ProjectDetailDto,
  UpdateStatusRequest,
  WorkflowStatusDto,
} from "@morrowlist/contracts";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import {
  moveStatusInList,
  patchStatusInList,
  type StatusPlacement,
} from "../lib/workflow-view";

import { projectKeys } from "./use-projects";

import { activityKeys } from "@/features/activity/hooks/use-activity";
import { taskKeys } from "@/features/tasks/hooks/use-tasks";
import { workspaceKeys } from "@/features/workspace/hooks/use-workspace";
import { apiClient } from "@/lib/api-client";

/**
 * Workflow column mutations (GAP-05). A column lives in two cached projections, the
 * board and the project detail, so one patch helper keeps both current and every hook
 * below goes through it rather than re-implementing the merge.
 */

interface StatusSnapshot {
  /** Every cached variant of the board (subtasks hidden or shown), keyed as cached. */
  readonly boards: readonly [QueryKey, ProjectBoardResponse | undefined][];
  readonly detail: ProjectDetailDto | undefined;
}

function snapshotStatuses(queryClient: QueryClient, projectId: string): StatusSnapshot {
  return {
    boards: queryClient.getQueriesData<ProjectBoardResponse>({
      queryKey: projectKeys.projectBoards(projectId),
    }),
    detail: queryClient.getQueryData<ProjectDetailDto>(projectKeys.detail(projectId)),
  };
}

function restoreStatuses(
  queryClient: QueryClient,
  projectId: string,
  snapshot: StatusSnapshot,
): void {
  for (const [key, board] of snapshot.boards) {
    queryClient.setQueryData(key, board);
  }
  if (snapshot.detail) {
    queryClient.setQueryData(projectKeys.detail(projectId), snapshot.detail);
  }
}

function mapStatuses(
  queryClient: QueryClient,
  projectId: string,
  transform: (statuses: readonly WorkflowStatusDto[]) => WorkflowStatusDto[],
): void {
  queryClient.setQueriesData<ProjectBoardResponse>(
    { queryKey: projectKeys.projectBoards(projectId) },
    (board) =>
      board
        ? {
            ...board,
            data: { ...board.data, statuses: transform(board.data.statuses) },
          }
        : board,
  );
  queryClient.setQueryData<ProjectDetailDto>(projectKeys.detail(projectId), (detail) =>
    detail ? { ...detail, statuses: transform(detail.statuses) } : detail,
  );
}

/** The one canonical column patch: every projection that lists columns gets it. */
function patchStatusEverywhere(
  queryClient: QueryClient,
  projectId: string,
  status: WorkflowStatusDto,
): void {
  mapStatuses(queryClient, projectId, (statuses) =>
    patchStatusInList(statuses, status),
  );
}

async function cancelStatusQueries(
  queryClient: QueryClient,
  projectId: string,
): Promise<void> {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: projectKeys.projectBoards(projectId) }),
    queryClient.cancelQueries({ queryKey: projectKeys.detail(projectId) }),
  ]);
}

function invalidateStatuses(queryClient: QueryClient, projectId: string): void {
  void queryClient.invalidateQueries({
    queryKey: projectKeys.projectBoards(projectId),
  });
  void queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
}

/** The optimistic shape of a column after a patch; omitted fields stay as they are. */
function applyStatusPatch(
  status: WorkflowStatusDto,
  patch: Omit<UpdateStatusRequest, "expectedVersion">,
): WorkflowStatusDto {
  const category = patch.category ?? status.category;
  return {
    ...status,
    name: patch.name ?? status.name,
    category,
    isTerminal: category === "done",
    colorToken: patch.colorToken ?? status.colorToken,
    wipLimit: patch.wipLimit === undefined ? status.wipLimit : patch.wipLimit,
    isDefault: patch.isDefault ?? status.isDefault,
    policyMd: patch.policyMd === undefined ? status.policyMd : patch.policyMd,
  };
}

export function useCreateStatus(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateStatusRequest) =>
      apiClient.createStatus(projectId, request),
    onSuccess: (status) => {
      patchStatusEverywhere(queryClient, projectId, status);
      invalidateStatuses(queryClient, projectId);
    },
  });
}

export interface UpdateStatusInput {
  readonly status: WorkflowStatusDto;
  readonly patch: Omit<UpdateStatusRequest, "expectedVersion">;
}

/** Rename, recolour, WIP, default, policy, or category, applied optimistically. */
export function useUpdateStatus(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ status, patch }: UpdateStatusInput) =>
      apiClient.updateStatus(status.id, { ...patch, expectedVersion: status.version }),
    onMutate: async ({ status, patch }) => {
      await cancelStatusQueries(queryClient, projectId);
      const previous = snapshotStatuses(queryClient, projectId);
      patchStatusEverywhere(queryClient, projectId, applyStatusPatch(status, patch));
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context) restoreStatuses(queryClient, projectId, context.previous);
    },
    onSuccess: (status) => patchStatusEverywhere(queryClient, projectId, status),
    onSettled: (_status, _error, { patch }) => {
      invalidateStatuses(queryClient, projectId);
      // A category change may have completed or reopened the column's tasks, and it
      // changes what counts as in progress (GAP-20).
      if (patch.category !== undefined) {
        void queryClient.invalidateQueries({ queryKey: taskKeys.all });
        void queryClient.invalidateQueries({ queryKey: activityKeys.all });
        void queryClient.invalidateQueries({ queryKey: workspaceKeys.me() });
      }
    },
  });
}

export interface ReorderStatusInput {
  readonly status: WorkflowStatusDto;
  readonly placement: StatusPlacement;
}

/** One optimistic reorder path for pointer drag, keyboard drag, and the move buttons. */
export function useReorderStatus(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ status, placement }: ReorderStatusInput) =>
      apiClient.reorderStatus(status.id, {
        beforeStatusId: placement.beforeStatusId,
        afterStatusId: placement.afterStatusId,
        expectedVersion: status.version,
      }),
    onMutate: async ({ status, placement }) => {
      await cancelStatusQueries(queryClient, projectId);
      const previous = snapshotStatuses(queryClient, projectId);
      mapStatuses(queryClient, projectId, (statuses) =>
        moveStatusInList(statuses, status.id, placement),
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context) restoreStatuses(queryClient, projectId, context.previous);
    },
    onSuccess: (status) => patchStatusEverywhere(queryClient, projectId, status),
    onSettled: () => invalidateStatuses(queryClient, projectId),
  });
}

export interface ArchiveStatusInput {
  readonly status: WorkflowStatusDto;
  readonly request: Omit<ArchiveStatusRequest, "expectedVersion">;
}

/**
 * Archive is not optimistic: the server moves the tasks and may promote a new default,
 * so the board is simply refetched once it has answered.
 */
export function useArchiveStatus(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ status, request }: ArchiveStatusInput) =>
      apiClient.archiveStatus(status.id, {
        ...request,
        expectedVersion: status.version,
      }),
    onSuccess: (status) => {
      patchStatusEverywhere(queryClient, projectId, status);
      invalidateStatuses(queryClient, projectId);
      // The moved tasks each recorded a task.moved event (spec 19.5).
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
      void queryClient.invalidateQueries({ queryKey: activityKeys.all });
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.me() });
    },
  });
}

/** A human sentence for a failed column edit; the API's message is already user-safe. */
export function describeWorkflowError(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  return "Something went wrong. Please try again.";
}
