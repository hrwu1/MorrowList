"use client";

import type { SearchQuery } from "@morrowlist/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api-client";

/**
 * Search server state (spec 9.8). Pages accumulate under one key so "Load more" extends
 * the list rather than replacing it; task mutations invalidate `searchKeys.all` because
 * a hit's title or state may have changed.
 */

export type SearchFilters = Omit<Partial<SearchQuery>, "q" | "cursor" | "limit">;

export const searchKeys = {
  all: ["search"] as const,
  results: (q: string, filters: SearchFilters, limit: number) =>
    [...searchKeys.all, q, filters, limit] as const,
};

export function useSearch(
  q: string,
  filters: SearchFilters = {},
  options: { readonly enabled?: boolean; readonly limit?: number } = {},
) {
  const limit = options.limit ?? 20;
  return useInfiniteQuery({
    queryKey: searchKeys.results(q, filters, limit),
    queryFn: ({ pageParam }) =>
      apiClient.search({
        q,
        ...filters,
        limit,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: "",
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
    enabled: (options.enabled ?? true) && q.trim().length > 0,
    // A 422 for a half-typed operator is not worth retrying; the next keystroke fixes it.
    retry: false,
  });
}
