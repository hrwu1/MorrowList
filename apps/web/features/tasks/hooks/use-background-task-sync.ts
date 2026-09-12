"use client";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

import { isTaskProjection } from "../lib/task-cache";

const REFRESH_INTERVAL_MS = 5_000;

/** Incoming mail and rule actions share the same task projections as local edits. */
export async function refreshActiveTaskProjections(client: QueryClient): Promise<void> {
  if (client.isMutating() > 0) return;
  await client.refetchQueries(
    {
      type: "active",
      predicate: (query) =>
        query.state.fetchStatus === "idle" &&
        isTaskProjection(query.queryKey, query.state.data),
    },
    { cancelRefetch: false },
  );
}

/**
 * No socket or second cache: refresh only mounted views in the authenticated shell.
 * A focused editor keeps its draft until focus leaves it; local optimistic mutations
 * cancel these same queries through the existing shared task mutation path.
 */
export function useBackgroundTaskSync(): () => void {
  const queryClient = useQueryClient();
  const cleanup = useRef<(() => void) | null>(null);
  const stop = useCallback(() => {
    cleanup.current?.();
    cleanup.current = null;
  }, []);
  useEffect(() => {
    let pointerDown = false;
    const beginPointer = () => {
      pointerDown = true;
    };
    const endPointer = () => {
      pointerDown = false;
    };
    window.addEventListener("pointerdown", beginPointer, true);
    window.addEventListener("pointerup", endPointer, true);
    window.addEventListener("pointercancel", endPointer, true);
    window.addEventListener("blur", endPointer);
    const timer = window.setInterval(() => {
      if (
        pointerDown ||
        !navigator.onLine ||
        document.visibilityState !== "visible" ||
        document.querySelector('[data-dragging="true"]')
      )
        return;
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
    cleanup.current = () => {
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", beginPointer, true);
      window.removeEventListener("pointerup", endPointer, true);
      window.removeEventListener("pointercancel", endPointer, true);
      window.removeEventListener("blur", endPointer);
    };
    return stop;
  }, [queryClient, stop]);
  return stop;
}
