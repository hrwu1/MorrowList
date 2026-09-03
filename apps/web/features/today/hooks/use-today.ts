"use client";

import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api-client";

/**
 * Today server state (spec 23.2). The key carries the requested date so "open yesterday"
 * is its own cache entry; the current day is keyed as "current" because the browser does
 * not know the workspace's calendar date until the response says so.
 */
export const todayKeys = {
  all: ["views", "today"] as const,
  view: (date?: string | undefined) => [...todayKeys.all, date ?? "current"] as const,
};

export function useTodayView(date?: string | undefined) {
  return useQuery({
    queryKey: todayKeys.view(date),
    queryFn: () => apiClient.getTodayView(date ? { date } : {}),
  });
}
