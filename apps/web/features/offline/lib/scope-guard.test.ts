import { describe, expect, it, vi } from "vitest";

import { createScopeGuard } from "./scope-guard";

function deferred() {
  let finish!: () => void;
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
}

describe("private cache scope guard", () => {
  it("refuses late network responses after logout or identity change", async () => {
    const guard = createScopeGuard();
    const oldRead = guard.current();
    const purge = vi.fn(async () => {});
    await guard.run(guard.invalidate(), purge);
    const reopenOldPartition = vi.fn(async () => {});
    await guard.run(oldRead, reopenOldPartition);
    expect(purge).toHaveBeenCalledOnce();
    expect(reopenOldPartition).not.toHaveBeenCalled();
  });

  it("drains an already-started cache write before purging, retaining only the new user's writes", async () => {
    const guard = createScopeGuard();
    const old = guard.current();
    const hold = deferred();
    const started = deferred();
    const caches = new Set<string>();
    const writing = guard.run(old, async () => {
      started.finish();
      await hold.promise;
      caches.add("alice");
    });
    await started.promise;
    const next = guard.invalidate();
    const changing = guard.run(next, async () => {
      caches.clear();
      caches.add("bob");
    });
    hold.finish();
    await Promise.all([writing, changing]);
    await guard.run(old, async () => {
      caches.add("alice");
    });
    expect([...caches]).toEqual(["bob"]);
  });

  it("still performs logout cleanup after a Cache API failure", async () => {
    const guard = createScopeGuard();
    await expect(
      guard.run(guard.current(), async () => {
        throw new Error("storage failed");
      }),
    ).rejects.toThrow();
    const purge = vi.fn(async () => {});
    await guard.run(guard.invalidate(), purge);
    expect(purge).toHaveBeenCalledOnce();
  });
});
