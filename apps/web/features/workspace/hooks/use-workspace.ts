"use client";

import type { MeResponse, UpdateWorkspaceRequest } from "@morrowlist/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api-client";

/**
 * The caller's workspaces (GAP-20). `/me` carries each workspace's in-progress limit and
 * the current count, so the shell counter and the settings page share one query; every
 * task mutation invalidates it, which keeps the count right after any move, complete,
 * or reopen.
 */
export const workspaceKeys = {
  all: ["workspace"] as const,
  me: () => [...workspaceKeys.all, "me"] as const,
};

export function useMe() {
  return useQuery({ queryKey: workspaceKeys.me(), queryFn: () => apiClient.me() });
}

export type MeWorkspace = MeResponse["data"]["workspaces"][number];

/** The default workspace's summary, or undefined until `/me` has answered. */
export function useDefaultWorkspace(): MeWorkspace | undefined {
  const me = useMe();
  return me.data?.workspaces.find(
    (workspace) => workspace.id === me.data?.defaultWorkspaceId,
  );
}

export function useUpdateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceId,
      request,
    }: {
      readonly workspaceId: string;
      readonly request: UpdateWorkspaceRequest;
    }) => apiClient.updateWorkspace(workspaceId, request),
    onSuccess: (workspace) => {
      queryClient.setQueryData<MeResponse["data"]>(workspaceKeys.me(), (me) =>
        me
          ? {
              ...me,
              workspaces: me.workspaces.map((candidate) =>
                candidate.id === workspace.id
                  ? { ...candidate, ...workspace }
                  : candidate,
              ),
            }
          : me,
      );
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.me() });
    },
  });
}
