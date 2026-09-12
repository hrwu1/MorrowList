import { createECDH, randomBytes } from "node:crypto";

import { TaskService, WebhookService } from "@morrowlist/application";
import {
  createInMemoryUnitOfWork,
  seedWorkspace,
} from "@morrowlist/application/testing";
import { fixedClock } from "@morrowlist/domain";
import { silentLogger } from "@morrowlist/observability";
import { describe, expect, it } from "vitest";

import { createWorkerServices } from "./worker-services.js";

const NOW = new Date("2026-09-12T10:00:00Z");
const cursorSecret = "worker-test-cursor-secret";

describe("shared worker service composition", () => {
  it("delivers notification and webhook work with the injected dependencies", async () => {
    const unitOfWork = createInMemoryUnitOfWork();
    const { context, workspace } = seedWorkspace(unitOfWork.data, {
      workspace: { timezone: "UTC" },
    });
    const requests: string[] = [];
    const runtime = createWorkerServices({
      unitOfWork,
      cursorSecret,
      appUrl: "https://morrow.example",
      logger: silentLogger,
      clock: fixedClock(NOW),
      userDirectory: { findById: async () => null },
      fetch: async (url) => {
        requests.push(String(url));
        return new Response(null, { status: 204 });
      },
    });
    await new WebhookService({
      unitOfWork,
      clock: fixedClock(NOW),
      cursorSecret,
      sender: runtime.webhookSender,
    }).create(context, workspace.id, {
      url: "https://receiver.example/hook",
      eventTypes: ["task.created"],
    });
    await new TaskService({ unitOfWork, clock: fixedClock(NOW), cursorSecret }).create(
      context,
      {
        workspaceId: workspace.id,
        title: "Shared worker task",
        dueDate: "2026-09-12",
        dueTime: "11:00",
        dueTimezone: "UTC",
      },
    );
    expect(
      await runtime.notificationService.deliverDue(new Date("2026-09-12T10:30:00Z")),
    ).toBe(1);
    expect((await runtime.webhookDispatcher.tick(NOW)).delivered).toBe(1);
    expect(await runtime.ruleEngine.tick(NOW)).toBe(0);
    expect(requests).toEqual(["https://receiver.example/hook"]);
    expect(
      (await runtime.notificationService.list(context, workspace.id, { limit: 50 }))
        .data,
    ).toHaveLength(1);
    expect(runtime.pushPublicKey).toBeNull();
  });

  it("preserves the browser registration after a server VAPID configuration failure", async () => {
    const unitOfWork = createInMemoryUnitOfWork();
    const { context, workspace } = seedWorkspace(unitOfWork.data, {
      workspace: { timezone: "UTC" },
    });
    const browser = createECDH("prime256v1");
    const publicKey = browser.generateKeys().toString("base64url");
    const runtime = createWorkerServices({
      unitOfWork,
      cursorSecret,
      appUrl: "https://morrow.example",
      logger: silentLogger,
      clock: fixedClock(NOW),
      userDirectory: { findById: async () => null },
      vapidKeys: {
        publicKey,
        privateKey: "invalid",
        subject: "mailto:ops@morrow.example",
      },
      fetch: async () => {
        throw new Error("unexpected network request");
      },
    });
    await runtime.notificationService.updatePreferences(context, workspace.id, {
      channels: { push: true },
    });
    const endpoint = "https://push.example/healthy-browser";
    await runtime.notificationService.addPushSubscription(context, {
      endpoint,
      keys: { p256dh: publicKey, auth: randomBytes(16).toString("base64url") },
    });
    await new TaskService({ unitOfWork, clock: fixedClock(NOW), cursorSecret }).create(
      context,
      {
        workspaceId: workspace.id,
        title: "Still registered",
        dueDate: "2026-09-12",
        dueTime: "11:00",
        dueTimezone: "UTC",
      },
    );
    expect(
      await runtime.notificationService.deliverDue(new Date("2026-09-12T10:30:00Z")),
    ).toBe(1);
    const registrations = await unitOfWork.execute((tx) =>
      tx.pushSubscriptions.listForUser(context.userId!),
    );
    expect(registrations.map((registration) => registration.endpoint)).toEqual([
      endpoint,
    ]);
    expect(
      (await runtime.notificationService.list(context, workspace.id, { limit: 50 }))
        .data,
    ).toHaveLength(1);
  });
});
