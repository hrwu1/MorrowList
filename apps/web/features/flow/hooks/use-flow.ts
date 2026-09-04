"use client";

import type { FlowRange } from "@morrowlist/contracts";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api-client";

/**
 * Flow metrics server state (GAP-17). Read-only: every task mutation invalidates
 * `flowKeys.all` and the summary refetches.
 */
export const flowKeys = {
  all: ["flow"] as const,
  project: (projectId: string, range: FlowRange) =>
    [...flowKeys.all, "project", projectId, range] as const,
};

export function useProjectFlow(projectId: string, range: FlowRange = "90") {
  return useQuery({
    queryKey: flowKeys.project(projectId, range),
    queryFn: () => apiClient.getProjectFlow(projectId, { range }),
  });
}
