/**
 * Cache naming and eligibility rules shared by the service worker and the page (spec 25.3).
 *
 * Pure on purpose: no DOM and no worker globals, so the rules are unit-tested in Node and
 * bundled into the worker unchanged. Everything private is partitioned by a hash of the
 * signed-in user and workspace; everything the worker owns carries its version so a new
 * worker can drop what the previous one left behind.
 */

const PREFIX = "morrowlist";

/** Holds the current partition hash so a cold worker can serve a navigation. */
export const META_CACHE = `${PREFIX}-meta`;

/** A cached entry older than this is never served (spec 25.1, bounded expiration). */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Entries per partition; the oldest go first. */
export const MAX_ENTRIES = 200;

/** Stamped on every stored response so expiry does not depend on server headers. */
export const CACHED_AT_HEADER = "x-morrowlist-cached-at";

export interface CacheScope {
  readonly userId: string;
  readonly workspaceId: string;
}

/** Where a request's response may live: the shared shell, a private partition, or nowhere. */
export type CachePolicy = "shell" | "partition" | "none";

/** Read-only API prefixes whose responses may be kept for offline reading. */
const CACHEABLE_API_PREFIXES = [
  "/api/v1/views/",
  "/api/v1/tasks",
  "/api/v1/projects",
  "/api/v1/tags",
] as const;

/** Routes whose pages are never stored: the auth forms and the fallback itself. */
const UNCACHED_PAGES = new Set(["/sign-in", "/sign-up", "/offline"]);

export async function hashScope(scope: CacheScope): Promise<string> {
  const bytes = new TextEncoder().encode(`${scope.userId}:${scope.workspaceId}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  )
    .join("")
    .slice(0, 16);
}

export function shellCacheName(version: string): string {
  return `${PREFIX}-shell-${version}`;
}

export function partitionCacheName(version: string, scopeHash: string): string {
  return `${PREFIX}-data-${version}-${scopeHash}`;
}

export function isPartitionCache(name: string): boolean {
  return name.startsWith(`${PREFIX}-data-`);
}

/** A cache this worker owns but a different version created. The meta cache is kept. */
export function isStaleCache(name: string, version: string): boolean {
  if (!name.startsWith(`${PREFIX}-`) || name === META_CACHE) return false;
  return (
    !name.startsWith(shellCacheName(version)) &&
    !name.startsWith(`${PREFIX}-data-${version}-`)
  );
}

export function cachePolicyFor(url: URL, mode: string, origin: string): CachePolicy {
  if (url.origin !== origin) return "none";
  const path = url.pathname;

  if (
    path.startsWith("/_next/static/") ||
    path.startsWith("/icons/") ||
    path === "/manifest.webmanifest"
  ) {
    return "shell";
  }

  if (mode === "navigate") {
    if (path.startsWith("/api/") || UNCACHED_PAGES.has(path)) return "none";
    return "partition";
  }

  if (path.startsWith("/api/v1/")) {
    return CACHEABLE_API_PREFIXES.some((prefix) => path.startsWith(prefix))
      ? "partition"
      : "none";
  }

  return "none";
}

export function isExpired(cachedAt: string | null, now: number): boolean {
  const stamp = cachedAt === null ? Number.NaN : Number(cachedAt);
  return !Number.isFinite(stamp) || now - stamp > MAX_AGE_MS;
}
