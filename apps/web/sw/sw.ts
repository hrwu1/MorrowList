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
  | { readonly type: "CLEAR_SCOPE" }
  | { readonly type: "WARM"; readonly url: string };

/** A view warmed this recently is not fetched again. */
const WARM_INTERVAL_MS = 5 * 60 * 1000;

worker.addEventListener("install", (event) => {
  event.waitUntil(precacheShell());
});

/**
 * The fallback page must render on a device that has never loaded the app, so its own
 * scripts and stylesheets are precached with it. Their hashed names are only known once
 * the page is fetched, hence the second pass.
 */
async function precacheShell(): Promise<void> {
  const cache = await caches.open(SHELL_CACHE);
  await cache.addAll(PRECACHE);
  const page = await cache.match("/offline");
  if (page) await storeAssetsOf(await page.text());
}

/**
 * Stores the static assets a document references that the shell does not hold yet — a
 * chunk the client router loaded before this worker took control, for instance.
 */
async function storeAssetsOf(html: string): Promise<void> {
  const cache = await caches.open(SHELL_CACHE);
  const missing: string[] = [];
  for (const match of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) {
    const url = match[1]!.replaceAll("&amp;", "&");
    if (!(await cache.match(url, { ignoreSearch: true }))) missing.push(url);
  }
  await Promise.all(
    missing.map(async (url) => {
      const response = await fetch(url);
      if (response.ok) await cache.put(url, response);
    }),
  );
}

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

// Messages are handled one at a time, in the order they were posted: the page announces
// the partition and then the view it opened, and warming must see the partition.
let inbox: Promise<void> = Promise.resolve();

worker.addEventListener("message", (event) => {
  const message = event.data as WorkerMessage | undefined;
  const acknowledge = () => event.ports[0]?.postMessage({ type: "DONE" });
  if (message?.type === "SKIP_WAITING") {
    void worker.skipWaiting();
    return;
  }
  inbox = inbox.then(async () => {
    switch (message?.type) {
      case "SET_SCOPE":
        await setScope(message.scope);
        break;
      case "CLEAR_SCOPE":
        await clearScope();
        break;
      case "WARM":
        await warm(message.url);
        break;
      default:
        return;
    }
    acknowledge();
  });
  event.waitUntil(inbox);
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

/**
 * The client router moves between views without ever requesting their documents, so the
 * page announces each view it opens and the worker stores the document itself. That is
 * what lets a cold start while offline land on a recently opened view (spec 25.1).
 */
async function warm(href: string): Promise<void> {
  const url = new URL(href, worker.location.origin);
  url.search = "";
  if (cachePolicyFor(url, "navigate", worker.location.origin) !== "partition") return;
  const hash = await readScopeHash();
  if (!hash) return;
  const cacheName = partitionCacheName(VERSION, hash);
  const cache = await caches.open(cacheName);
  const existing = await cache.match(url.href, { ignoreVary: true });
  const cachedAt = Number(existing?.headers.get(CACHED_AT_HEADER));
  if (existing && Date.now() - cachedAt < WARM_INTERVAL_MS) return;
  try {
    const response = await fetch(url.href, { headers: { accept: "text/html" } });
    if (response.ok && response.headers.get("content-type")?.includes("text/html")) {
      const html = await response.clone().text();
      await store(cacheName, new Request(url.href), response);
      await storeAssetsOf(html);
    }
  } catch {
    // Offline or the view no longer exists; there is nothing to warm.
  }
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
    const cached =
      (await readFresh(cacheName, request.url)) ??
      // A view opened with a query (a task panel, a filter) falls back to the view itself.
      (request.mode === "navigate"
        ? await readFresh(cacheName, request.url.split("?")[0]!)
        : undefined);
    if (cached) return cached;
    if (request.mode === "navigate") return offlineFallback();
    throw error;
  }
}

/**
 * Expiry and the entry cap apply to private partitions only: the shell cache holds the
 * precached fallback (which carries no stamp) and immutable hashed assets, and is
 * replaced wholesale when the worker's version changes.
 */
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
  if (!isPartitionCache(cacheName)) return;
  const keys = await cache.keys();
  await Promise.all(
    keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES)).map((k) => cache.delete(k)),
  );
}

async function readFresh(
  cacheName: string,
  url: string,
): Promise<Response | undefined> {
  const cache = await caches.open(cacheName);
  // Shell assets are content-addressed by path; `next dev` adds a build stamp as a
  // query, which must not separate a stored chunk from the same chunk requested later.
  const cached = await cache.match(url, {
    ignoreVary: true,
    ignoreSearch: !isPartitionCache(cacheName),
  });
  if (!cached) return undefined;
  if (
    isPartitionCache(cacheName) &&
    isExpired(cached.headers.get(CACHED_AT_HEADER), Date.now())
  ) {
    await cache.delete(url);
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
