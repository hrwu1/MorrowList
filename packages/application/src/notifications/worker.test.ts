import { silentLogger } from "@morrowlist/observability";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NotificationService } from "./service.js";
import { startNotificationWorker } from "./worker.js";

/** The polling loop: ticks on its interval, survives a failing tick, and stops cleanly. */

function fakeService() {
  return {
    deliverDue: vi.fn(async () => 2),
    digest: vi.fn(async () => 1),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startNotificationWorker", () => {
  it("delivers on start and again every interval, then stops", async () => {
    const service = fakeService();
    const worker = startNotificationWorker({
      service: service as unknown as NotificationService,
      logger: silentLogger,
      pollIntervalMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(service.deliverDue).toHaveBeenCalledTimes(1);
    expect(service.digest).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2500);
    expect(service.deliverDue).toHaveBeenCalledTimes(3);

    await worker.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(service.deliverDue).toHaveBeenCalledTimes(3);
  });

  it("keeps polling after a tick throws and waits for an in-flight tick on stop", async () => {
    const service = fakeService();
    let release: () => void = () => {};
    service.deliverDue
      .mockRejectedValueOnce(new Error("database away"))
      .mockImplementationOnce(
        () =>
          new Promise<number>((resolve) => {
            release = () => resolve(1);
          }),
      );
    const worker = startNotificationWorker({
      service: service as unknown as NotificationService,
      logger: silentLogger,
      pollIntervalMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(service.digest).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(service.deliverDue).toHaveBeenCalledTimes(2);

    let stopped = false;
    const stopping = worker.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(stopped).toBe(true);
    expect(service.digest).toHaveBeenCalledTimes(1);
  });

  it("serialises a manual tick behind the one in flight", async () => {
    const service = fakeService();
    const order: string[] = [];
    service.deliverDue.mockImplementation(async () => {
      order.push("deliver");
      return 0;
    });
    const worker = startNotificationWorker({
      service: service as unknown as NotificationService,
      logger: silentLogger,
      pollIntervalMs: 60_000,
    });
    const manual = worker.tick();
    await vi.advanceTimersByTimeAsync(0);
    await manual;

    expect(order).toEqual(["deliver", "deliver"]);
    await worker.stop();
  });
});
