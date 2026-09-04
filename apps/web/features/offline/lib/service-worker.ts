import { isPartitionCache, type CacheScope } from "./cache-policy";
import { clearAllDrafts } from "./drafts";

/**
 * The page's side of the service worker protocol (spec 25.3). The worker itself lives in
 * `sw/sw.ts`; this module registers it, tells it who is signed in, and removes every
 * private cache on sign-out.
 */

export type WorkerMessage =
  | { readonly type: "SKIP_WAITING" }
  | { readonly type: "SET_SCOPE"; readonly scope: CacheScope }
  | { readonly type: "CLEAR_SCOPE" }
  | { readonly type: "WARM"; readonly url: string };

const ACK_TIMEOUT_MS = 2_000;

export function serviceWorkerSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!serviceWorkerSupported()) return null;
  try {
    // The browser's HTTP cache must never hold back a new worker (spec 25.3, updates).
    return await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
  } catch {
    return null;
  }
}

async function activeWorker(): Promise<ServiceWorker | null> {
  if (!serviceWorkerSupported()) return null;
  const ready = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ACK_TIMEOUT_MS)),
  ]);
  return ready?.active ?? navigator.serviceWorker.controller;
}

/**
 * Posts a message and resolves once the worker acknowledges it, or after a short timeout
 * so a missing or hung worker never blocks sign-out.
 */
export async function tellWorker(message: WorkerMessage): Promise<void> {
  const target = await activeWorker();
  if (!target) return;
  await new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(resolve, ACK_TIMEOUT_MS);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      resolve();
    };
    target.postMessage(message, [channel.port2]);
  });
}

/**
 * Sign-out cleanup (spec 25.3): the page deletes the partitioned caches itself, so the
 * purge does not depend on a worker being alive, then tells the worker to forget the
 * partition, and drops any unsent local drafts.
 */
export async function purgeOfflineCaches(): Promise<void> {
  if (typeof caches !== "undefined") {
    const names = await caches.keys();
    await Promise.all(
      names.filter(isPartitionCache).map((name) => caches.delete(name)),
    );
  }
  await tellWorker({ type: "CLEAR_SCOPE" });
  clearAllDrafts();
}
