/// <reference lib="webworker" />

import {
  CACHED_AT_HEADER,
  MAX_ENTRIES,
  META_CACHE,
  cachePolicyFor,
  hashScope,
  isExpired,
  isPartitionCache,
  isStaleCache,
  partitionCacheName,
  shellCacheName,
  type CacheScope,
} from "../features/offline/lib/cache-policy";

/**
 * MorrowList service worker (spec 25). Bundled by `scripts/build-sw.mjs` into
 * `public/sw.js`; `__SW_VERSION__` is replaced with a hash of the bundle.
 *
 * Online-first (ADR-008): every runtime request goes to the network and the cached copy
 * is only a fallback, so the worker never serves stale task data while connected and
 * `next dev` never serves a stale chunk. Private responses live in a cache named after
 * the signed-in user and workspace, which the page announces after `/me` resolves; the
 * worker remembers that partition in a meta cache so it can still answer a navigation
 * before any page script has run.
 */

declare const __SW_VERSION__: string;

const worker = self as unknown as ServiceWorkerGlobalScope;
const VERSION = __SW_VERSION__;
const SHELL_CACHE = shellCacheName(VERSION);
const SCOPE_KEY = "/__morrowlist-scope";
const PRECACHE = [
  "/offline",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

type WorkerMessage =
  | { readonly type: "SKIP_WAITING" }
  | { readonly type: "SET_SCOPE"; readonly scope: CacheScope }
  | { readonly type: "CLEAR_SCOPE" };

worker.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE)));
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => isStaleCache(name, VERSION))
          .map((name) => caches.delete(name)),
      );
      await worker.clients.claim();
    })(),
  );
});

worker.addEventListener("message", (event) => {
  const message = event.data as WorkerMessage | undefined;
  const acknowledge = () => event.ports[0]?.postMessage({ type: "DONE" });
  switch (message?.type) {
    case "SKIP_WAITING":
      void worker.skipWaiting();
      return;
    case "SET_SCOPE":
      event.waitUntil(setScope(message.scope).then(acknowledge));
      return;
    case "CLEAR_SCOPE":
      event.waitUntil(clearScope().then(acknowledge));
      return;
    default:
      return;
  }
});

worker.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const policy = cachePolicyFor(
    new URL(request.url),
    request.mode,
    worker.location.origin,
  );
  if (policy === "none") return;
  event.respondWith(
    policy === "shell" ? networkFirst(event, SHELL_CACHE) : partitioned(event),
  );
});

let scopeHash: string | null | undefined;

async function readScopeHash(): Promise<string | null> {
  if (scopeHash !== undefined) return scopeHash;
  const meta = await caches.open(META_CACHE);
  const stored = await meta.match(SCOPE_KEY);
  scopeHash = stored ? await stored.text() : null;
  return scopeHash;
}

/** A different signed-in identity drops every partition, not only the previous one. */
async function setScope(scope: CacheScope): Promise<void> {
  const hash = await hashScope(scope);
  if ((await readScopeHash()) === hash) return;
  await deletePartitions();
  const meta = await caches.open(META_CACHE);
  await meta.put(SCOPE_KEY, new Response(hash));
  scopeHash = hash;
}

/** Logout (spec 25.3): forget the partition and remove everything private. */
async function clearScope(): Promise<void> {
  await deletePartitions();
  const meta = await caches.open(META_CACHE);
  await meta.delete(SCOPE_KEY);
  scopeHash = null;
}

async function deletePartitions(): Promise<void> {
  const names = await caches.keys();
  await Promise.all(names.filter(isPartitionCache).map((name) => caches.delete(name)));
}

async function partitioned(event: FetchEvent): Promise<Response> {
  const hash = await readScopeHash();
  if (hash) return networkFirst(event, partitionCacheName(VERSION, hash));
  // Nobody is known to be signed in: nothing is stored and nothing is served.
  try {
    return await fetch(event.request);
  } catch (error) {
    if (event.request.mode === "navigate") return offlineFallback();
    throw error;
  }
}

async function networkFirst(event: FetchEvent, cacheName: string): Promise<Response> {
  const { request } = event;
  try {
    const response = await fetch(request);
    if (response.ok) event.waitUntil(store(cacheName, request, response.clone()));
    return response;
  } catch (error) {
    const cached = await readFresh(cacheName, request);
    if (cached) return cached;
    if (request.mode === "navigate") return offlineFallback();
    throw error;
  }
}

async function store(cacheName: string, request: Request, response: Response) {
  const cache = await caches.open(cacheName);
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT_HEADER, String(Date.now()));
  await cache.put(
    request.url,
    new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
  );
  const keys = await cache.keys();
  await Promise.all(
    keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES)).map((k) => cache.delete(k)),
  );
}

async function readFresh(
  cacheName: string,
  request: Request,
): Promise<Response | undefined> {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request.url, { ignoreVary: true });
  if (!cached) return undefined;
  if (isExpired(cached.headers.get(CACHED_AT_HEADER), Date.now())) {
    await cache.delete(request.url);
    return undefined;
  }
  return cached;
}

async function offlineFallback(): Promise<Response> {
  const shell = await caches.open(SHELL_CACHE);
  const page = await shell.match("/offline");
  return (
    page ??
    new Response("You are offline and this page has not been saved for offline use.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    })
  );
}
