import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { refreshActiveTaskProjections } from "./use-background-task-sync";

describe("background task synchronization", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  function client() {
    const value = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    cleanups.push(() => value.clear());
    return value;
  }

  function observe<T>(value: QueryClient, key: readonly string[], initial: T, next: T) {
    const queryFn = vi.fn(async () => next);
    const observer = new QueryObserver(value, {
      queryKey: key,
      queryFn,
      initialData: initial,
      staleTime: Infinity,
    });
    cleanups.push(observer.subscribe(() => {}));
    return queryFn;
  }

  it("updates visible task views and counts without fetching inactive or unrelated data", async () => {
    const value = client();
    const inbox = observe(value, ["tasks", "list"], ["old"], ["old", "email"]);
    const board = observe(value, ["projects", "board", "p1"], "ready", "done");
    const day = observe(value, ["views", "today", "current"], 0, 1);
    const detail = observe(value, ["tasks", "detail", "t1"], "high", "urgent");
    const calendar = observe(value, ["views", "calendar", "month"], [], ["scheduled"]);
    const count = observe(value, ["workspace", "me"], 1, 0);
    const settings = observe(value, ["webhooks"], [], ["new"]);
    value.setQueryData(["tasks", "list", "inactive"], ["retained"]);

    await refreshActiveTaskProjections(value);

    for (const request of [inbox, board, day, detail, calendar, count]) {
      expect(request).toHaveBeenCalledTimes(1);
    }
    expect(value.getQueryData(["tasks", "list"])).toEqual(["old", "email"]);
    expect(value.getQueryData(["tasks", "detail", "t1"])).toBe("urgent");
    expect(value.getQueryData(["tasks", "list", "inactive"])).toEqual(["retained"]);
    expect(settings).not.toHaveBeenCalled();
  });

  it("retains a deleted task's confirmation instead of fetching its 404 endpoint", async () => {
    const value = client();
    const removed = { deletedAt: "2026-09-07T12:00:00.000Z" };
    const request = observe(value, ["tasks", "detail", "deleted"], removed, removed);
    await refreshActiveTaskProjections(value);
    expect(request).not.toHaveBeenCalled();
    expect(value.getQueryData(["tasks", "detail", "deleted"])).toBe(removed);
  });

  it("waits for pending local mutations before refreshing optimistic data", async () => {
    const value = client();
    const request = observe(value, ["tasks", "detail", "t1"], "optimistic", "saved");
    let finish: (() => void) | undefined;
    const mutation = value.getMutationCache().build(value, {
      mutationFn: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    });
    const running = mutation.execute(undefined);
    await vi.waitFor(() => expect(finish).toBeDefined());
    await refreshActiveTaskProjections(value);
    expect(request).not.toHaveBeenCalled();
    expect(value.getQueryData(["tasks", "detail", "t1"])).toBe("optimistic");
    finish?.();
    await running;
    await refreshActiveTaskProjections(value);
    expect(value.getQueryData(["tasks", "detail", "t1"])).toBe("saved");
  });
});
