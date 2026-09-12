import type { SearchQuery } from "@morrowlist/contracts";

export type SearchFilters = Omit<Partial<SearchQuery>, "q" | "cursor" | "limit">;

export const searchKeys = {
  all: ["search"] as const,
  results: (q: string, filters: SearchFilters, limit: number) =>
    [...searchKeys.all, q, filters, limit] as const,
};
