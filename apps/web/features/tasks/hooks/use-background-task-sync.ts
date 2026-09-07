"use client";

import type { TaskDto } from "@morrowlist/contracts";
import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect } from "react";

import { activityKeys } from "../../activity/hooks/use-activity";
import { boardViewKeys } from "../../board/lib/board-keys";
import { flowKeys } from "../../flow/hooks/use-flow";
import { projectKeys } from "../../projects/hooks/use-projects";
import { searchKeys } from "../../search/hooks/use-search";
import { todayKeys } from "../../today/hooks/use-today";
import { upcomingKeys } from "../../upcoming/hooks/use-upcoming";
import { workspaceKeys } from "../../workspace/hooks/use-workspace";

import { taskKeys } from "./use-tasks";

const REFRESH_INTERVAL_MS = 5_000;
const projectionKeys: readonly QueryKey[] = [
  taskKeys.all,
  projectKeys.boards(),
  boardViewKeys.all,
  todayKeys.all,
  upcomingKeys.all,
  activityKeys.all,
  flowKeys.all,
  searchKeys.all,
  workspaceKeys.me(),
];

/** Incoming mail and rule actions share the same task projections as local edits. */
export async function refreshActiveTaskProjections(client: QueryClient): Promise<void> {
  if (client.isMutating() > 0) return;
  await client.refetchQueries(
    {
      type: "active",
      predicate: (query) => {
        if (query.state.fetchStatus !== "idle") return false;
        const key = query.queryKey;
        if (
          !projectionKeys.some((prefix) =>
            prefix.every((part, index) => key[index] === part),
          )
        ) {
          return false;
        }
        // Deletion leaves a usable confirmation in the drawer; its read endpoint 404s.
        if (key[0] === taskKeys.all[0] && key[1] === "detail") {
          const task = query.state.data as TaskDto | undefined;
          if (task?.deletedAt) return false;
        }
        return true;
      },
    },
    { cancelRefetch: false },
  );
}

/**
 * No socket or second cache: refresh only mounted views in the authenticated shell.
 * A focused editor keeps its draft until focus leaves it; local optimistic mutations
 * cancel these same queries through the existing shared task mutation path.
 */
export function useBackgroundTaskSync(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!navigator.onLine || document.visibilityState !== "visible") return;
      const focused = document.activeElement;
      if (
        focused?.matches(
          'textarea, select, input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), [contenteditable="true"]',
        )
      ) {
        return;
      }
      void refreshActiveTaskProjections(queryClient);
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [queryClient]);
}
