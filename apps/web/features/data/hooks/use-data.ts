"use client";

import type {
  ExportActivityScope,
  ImportResultDto,
  ImportSource,
} from "@morrowlist/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { projectKeys } from "@/features/projects/hooks/use-projects";
import { tagKeys } from "@/features/tags/hooks/use-tags";
import { taskKeys } from "@/features/tasks/hooks/use-tasks";
import { workspaceKeys } from "@/features/workspace/hooks/use-workspace";
import { apiClient } from "@/lib/api-client";

/**
 * Export downloads and imports (GAP-07).
 *
 * An export is a plain link to the API, not a fetch: the browser streams it straight to
 * disk and a ten-thousand-task archive never becomes a string in the page. Only the
 * import goes through the client, because its answer is a preview the page renders.
 */

export function exportWorkspaceHref(
  workspaceId: string,
  activity: ExportActivityScope,
): string {
  const params = new URLSearchParams({ workspaceId, activity });
  return `/api/v1/exports/workspace.json?${params.toString()}`;
}

export function exportTasksCsvHref(workspaceId: string): string {
  const params = new URLSearchParams({ workspaceId });
  return `/api/v1/exports/tasks.csv?${params.toString()}`;
}

export interface ImportInput {
  readonly source: ImportSource;
  readonly content: string;
  readonly projectName?: string | undefined;
  readonly dryRun?: boolean | undefined;
}

/** The dry run: nothing is written, so nothing is invalidated. */
export function usePreviewImport() {
  return useMutation<ImportResultDto, Error, ImportInput>({
    mutationFn: ({ source, content, projectName }) =>
      apiClient.importData(source, {
        content,
        ...(projectName ? { projectName } : {}),
        dryRun: true,
      }),
  });
}

/** The real import: a new project with tasks and tags, so every projection is stale. */
export function useApplyImport() {
  const queryClient = useQueryClient();
  return useMutation<ImportResultDto, Error, ImportInput>({
    mutationFn: ({ source, content, projectName }) =>
      apiClient.importData(source, {
        content,
        ...(projectName ? { projectName } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
      void queryClient.invalidateQueries({ queryKey: tagKeys.all });
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.me() });
    },
  });
}
