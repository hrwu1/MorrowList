import type { WebhookDeliveryDto, WebhookSubscriptionDto } from "@morrowlist/contracts";
import { describe, expect, it } from "vitest";

import {
  deliveryDetail,
  deliveryTone,
  describeDelivery,
  describeEndpoint,
  parseEventTypes,
} from "./webhook-view";

function delivery(overrides: Partial<WebhookDeliveryDto> = {}): WebhookDeliveryDto {
  return {
    id: "01a04e0f-0000-7000-8000-000000000001",
    subscriptionId: "01a04e0f-0000-7000-8000-000000000002",
    eventId: "01a04e0f-0000-7000-8000-000000000003",
    eventType: "task.created",
    status: "delivered",
    attempt: 1,
    responseCode: 200,
    error: null,
    nextAttemptAt: null,
    deliveredAt: "2026-09-05T09:00:00.000Z",
    createdAt: "2026-09-05T09:00:00.000Z",
    ...overrides,
  };
}

function endpoint(
  overrides: Partial<WebhookSubscriptionDto> = {},
): WebhookSubscriptionDto {
  return {
    id: "01a04e0f-0000-7000-8000-000000000002",
    workspaceId: "01a04e0f-0000-7000-8000-000000000004",
    url: "https://hooks.example/morrow",
    eventTypes: ["*"],
    description: null,
    active: true,
    secretPrefix: "whsec_abcdefg",
    createdAt: "2026-09-05T09:00:00.000Z",
    updatedAt: "2026-09-05T09:00:00.000Z",
    ...overrides,
  };
}

describe("describeDelivery", () => {
  it("says what happened rather than printing a status word", () => {
    expect(describeDelivery(delivery())).toBe("Delivered (200)");
    expect(describeDelivery(delivery({ status: "pending", attempt: 0 }))).toBe("Queued");
    expect(describeDelivery(delivery({ status: "pending", attempt: 2 }))).toBe(
      "Attempt 2 failed, retrying",
    );
    expect(describeDelivery(delivery({ status: "failed", attempt: 4 }))).toBe(
      "Gave up after 4 attempts",
    );
    expect(describeDelivery(delivery({ status: "failed", attempt: 1 }))).toBe(
      "Gave up after 1 attempt",
    );
  });
});

describe("deliveryTone and deliveryDetail", () => {
  it("maps each status to a tone and shows the reason it failed", () => {
    expect(deliveryTone(delivery())).toBe("success");
    expect(deliveryTone(delivery({ status: "pending" }))).toBe("pending");
    expect(deliveryTone(delivery({ status: "failed" }))).toBe("error");

    expect(deliveryDetail(delivery())).toBe("HTTP 200");
    expect(
      deliveryDetail(delivery({ error: "connect ECONNREFUSED", responseCode: null })),
    ).toBe("connect ECONNREFUSED");
    expect(deliveryDetail(delivery({ error: null, responseCode: null }))).toBe("—");
  });
});

describe("describeEndpoint", () => {
  it("spells out the wildcard and lists explicit types", () => {
    expect(describeEndpoint(endpoint())).toBe("Active · every event");
    expect(
      describeEndpoint(endpoint({ active: false, eventTypes: ["task.created"] })),
    ).toBe("Paused · task.created");
  });
});

describe("parseEventTypes", () => {
  it("accepts the same comma-separated form as the CLI", () => {
    expect(parseEventTypes(" task.created , task.completed ")).toEqual([
      "task.created",
      "task.completed",
    ]);
    expect(parseEventTypes("")).toEqual([]);
    expect(parseEventTypes(",,")).toEqual([]);
  });
});
