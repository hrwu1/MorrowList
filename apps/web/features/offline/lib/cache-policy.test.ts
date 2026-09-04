import { describe, expect, it } from "vitest";

import {
  MAX_AGE_MS,
  META_CACHE,
  cachePolicyFor,
  hashScope,
  isExpired,
  isPartitionCache,
  isStaleCache,
  partitionCacheName,
  shellCacheName,
} from "./cache-policy";

const ORIGIN = "https://app.example";

function policy(path: string, mode = "cors") {
  return cachePolicyFor(new URL(path, ORIGIN), mode, ORIGIN);
}

describe("cache partitioning (spec 25.3)", () => {
  it("hashes user and workspace together so neither alone selects a partition", async () => {
    const a = await hashScope({ userId: "u1", workspaceId: "w1" });
    const sameUserOtherWorkspace = await hashScope({ userId: "u1", workspaceId: "w2" });
    const otherUserSameWorkspace = await hashScope({ userId: "u2", workspaceId: "w1" });

    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toBe(sameUserOtherWorkspace);
    expect(a).not.toBe(otherUserSameWorkspace);
    expect(await hashScope({ userId: "u1", workspaceId: "w1" })).toBe(a);
  });

  it("does not expose the identifiers in the cache name", async () => {
    const hash = await hashScope({ userId: "user-123", workspaceId: "ws-456" });
    const name = partitionCacheName("v1", hash);

    expect(name).not.toContain("user-123");
    expect(name).not.toContain("ws-456");
    expect(isPartitionCache(name)).toBe(true);
    expect(isPartitionCache(shellCacheName("v1"))).toBe(false);
  });

  it("marks every cache of another version stale except the meta cache", () => {
    expect(isStaleCache(shellCacheName("old"), "new")).toBe(true);
    expect(isStaleCache(partitionCacheName("old", "abc"), "new")).toBe(true);
    expect(isStaleCache(shellCacheName("new"), "new")).toBe(false);
    expect(isStaleCache(partitionCacheName("new", "abc"), "new")).toBe(false);
    expect(isStaleCache(META_CACHE, "new")).toBe(false);
    expect(isStaleCache("someone-elses-cache", "new")).toBe(false);
  });
});

describe("cache policy", () => {
  it("never stores auth, session, or key material", () => {
    expect(policy("/api/auth/get-session")).toBe("none");
    expect(policy("/api/auth/sign-in/email")).toBe("none");
    expect(policy("/api/v1/me")).toBe("none");
    expect(policy("/api/v1/workspace")).toBe("none");
    expect(policy("/api/v1/workspaces/w1")).toBe("none");
    // Search results are transient and never make up a view of their own.
    expect(policy("/api/v1/search?q=plan")).toBe("none");
    // Notifications and their preferences are per user and time-sensitive (GAP-13).
    expect(policy("/api/v1/notifications?unread=true")).toBe("none");
    expect(policy("/api/v1/notifications")).toBe("none");
    expect(policy("/api/v1/me/notification-preferences")).toBe("none");
    expect(policy("/api/v1/health")).toBe("none");
    expect(policy("/sign-in", "navigate")).toBe("none");
    expect(policy("/sign-up", "navigate")).toBe("none");
  });

  it("partitions read projections and page navigations", () => {
    expect(policy("/api/v1/views/today")).toBe("partition");
    expect(policy("/api/v1/views/upcoming?days=14")).toBe("partition");
    // Saved views are owner-scoped, which the user-and-workspace partition already is.
    expect(policy("/api/v1/views/saved")).toBe("partition");
    expect(policy("/api/v1/tasks?inbox=true")).toBe("partition");
    expect(policy("/api/v1/tasks/ML-1")).toBe("partition");
    expect(policy("/api/v1/projects/p1/board")).toBe("partition");
    expect(policy("/api/v1/projects/p1/flow")).toBe("partition");
    expect(policy("/api/v1/projects/p1/activity")).toBe("partition");
    expect(policy("/api/v1/projects/p1/statuses")).toBe("partition");
    expect(policy("/api/v1/tasks/ML-1/activity")).toBe("partition");
    expect(policy("/api/v1/tags")).toBe("partition");
    expect(policy("/inbox", "navigate")).toBe("partition");
    expect(policy("/projects/p1/board", "navigate")).toBe("partition");
    expect(policy("/projects/p1/flow", "navigate")).toBe("partition");
    expect(policy("/views/v1", "navigate")).toBe("partition");
  });

  it("keeps static assets and the precached shell in the shared cache", () => {
    expect(policy("/_next/static/chunks/main.js")).toBe("shell");
    expect(policy("/icons/icon-192.png")).toBe("shell");
    expect(policy("/manifest.webmanifest")).toBe("shell");
    expect(policy("/offline", "navigate")).toBe("none");
  });

  it("leaves other origins and non-navigation page fetches alone", () => {
    expect(cachePolicyFor(new URL("https://cdn.example/x.js"), "cors", ORIGIN)).toBe(
      "none",
    );
    // A client-side router payload for /inbox is not the page and is not stored.
    expect(policy("/inbox?_rsc=abc")).toBe("none");
    expect(policy("/favicon.ico")).toBe("none");
  });
});

describe("expiry", () => {
  it("expires after the bounded age and treats a missing stamp as expired", () => {
    const now = 1_700_000_000_000;
    expect(isExpired(String(now - MAX_AGE_MS + 1), now)).toBe(false);
    expect(isExpired(String(now - MAX_AGE_MS - 1), now)).toBe(true);
    expect(isExpired(null, now)).toBe(true);
    expect(isExpired("not a number", now)).toBe(true);
  });
});
