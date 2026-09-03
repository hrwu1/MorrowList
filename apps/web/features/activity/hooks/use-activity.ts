"use client";

import type { ActivityListResponse } from "@morrowlist/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api-client";

/**
 * Activity server state (ACT-001). History is read-only, so there is no optimistic path:
 * the mutation hooks invalidate `activityKeys.all` and the list refetches.
 */

export type ActivitySource =
  | { readonly kind: "task"; readonly idOrKey: string }
  | { readonly kind: "project"; readonly projectId: string };

export const activityKeys = {
  all: ["activity"] as const,
  task: (idOrKey: string) => [...activityKeys.all, "task", idOrKey] as const,
  project: (projectId: string) => [...activityKeys.all, "project", projectId] as const,
};

export const ACTIVITY_PAGE_SIZE = 20;

export function useActivity(source: ActivitySource) {
  return useInfiniteQuery({
    queryKey:
      source.kind === "task"
        ? activityKeys.task(source.idOrKey)
        : activityKeys.project(source.projectId),
    queryFn: ({ pageParam }) => {
      const query = {
        limit: ACTIVITY_PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
      };
      return source.kind === "task"
        ? apiClient.listTaskActivity(source.idOrKey, query)
        : apiClient.listProjectActivity(source.projectId, query);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last: ActivityListResponse) => last.page.nextCursor,
  });
}
