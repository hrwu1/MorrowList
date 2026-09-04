"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

import { type CacheScope } from "../lib/cache-policy";
import { tellWorker } from "../lib/service-worker";

import { apiClient } from "@/lib/api-client";

/**
 * Who the private caches belong to (spec 25.3).
 *
 * The shell resolves `/me` once per load and announces the user and workspace to the
 * worker. The last known scope is also kept in `localStorage`: `/me` is never cached, so
 * on an offline cold start it is the only way to key an unsent draft to its workspace.
 */

const STORAGE_KEY = "morrowlist.offline.scope";

export const meKeys = { all: ["me"] as const };

let current: CacheScope | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function readStored(): CacheScope | null {
  if (!loaded) {
    loaded = true;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      current = stored ? (JSON.parse(stored) as CacheScope) : null;
    } catch {
      current = null;
    }
  }
  return current;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function notify() {
  for (const listener of listeners) listener();
}

/**
 * Announces the scope and resolves once the worker has it; true when it differs from
 * the one this device last knew.
 */
export async function setCacheScope(scope: CacheScope): Promise<boolean> {
  const known = readStored();
  if (known?.userId === scope.userId && known.workspaceId === scope.workspaceId) {
    await tellWorker({ type: "SET_SCOPE", scope });
    return false;
  }
  current = scope;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scope));
  } catch {
    // Storage is unavailable; the scope still reaches the worker for this session.
  }
  notify();
  await tellWorker({ type: "SET_SCOPE", scope });
  return true;
}

export function clearCacheScope(): void {
  loaded = true;
  current = null;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored.
  }
  notify();
}

/** The last known scope, or null before the first sign-in on this device. */
export function useCacheScope(): CacheScope | null {
  return useSyncExternalStore(subscribe, readStored, () => null);
}

/** Resolves the signed-in identity and keeps the worker's partition in step with it. */
export function useSyncCacheScope(): void {
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: meKeys.all,
    queryFn: () => apiClient.me(),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const userId = me.data?.user.id;
  const workspaceId = me.data?.defaultWorkspaceId;

  useEffect(() => {
    if (!userId || !workspaceId) return;
    // The first sign-in on a device: what loaded before the partition was known was
    // not stored, so the open views are read once more, now that it is.
    void setCacheScope({ userId, workspaceId }).then((changed) => {
      if (!changed) return;
      return queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== meKeys.all[0],
      });
    });
  }, [queryClient, userId, workspaceId]);
}

/**
 * Tells the worker which view is open so its document is stored for a cold offline
 * start: the client router never requests documents, so the worker cannot see them.
 */
export function useWarmCurrentView(): void {
  const pathname = usePathname();
  const scope = useCacheScope();

  useEffect(() => {
    if (!scope) return;
    void tellWorker({ type: "WARM", url: `${window.location.origin}${pathname}` });
  }, [pathname, scope]);
}
