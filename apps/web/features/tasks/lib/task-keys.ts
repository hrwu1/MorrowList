import type { ListTasksQuery } from "@morrowlist/contracts";
import type { QueryKey } from "@tanstack/react-query";

export const taskKeys = {
  all: ["tasks"] as const,
  lists: () => [...taskKeys.all, "list"] as const,
  list: (filters: Partial<ListTasksQuery>) =>
    [...taskKeys.lists(), filters] as const satisfies QueryKey,
  details: () => [...taskKeys.all, "detail"] as const,
  detail: (idOrKey: string) => [...taskKeys.details(), idOrKey] as const,
};
