import { describe, expect, it } from "vitest";

import { createFetchWebhookSender, describeTransportFailure } from "./webhooks.js";

describe("describeTransportFailure", () => {
  it('unwraps the cause Node\'s fetch hides behind "fetch failed"', () => {
    const failure = new Error("fetch failed", {
      cause: new Error("connect ECONNREFUSED 127.0.0.1:4319"),
    });
    expect(describeTransportFailure(failure)).toBe(
      "fetch failed: connect ECONNREFUSED 127.0.0.1:4319",
    );
  });

  it("names a timeout as a timeout rather than as an abort", () => {
    const aborted = new Error("This operation was aborted");
    aborted.name = "AbortError";
    expect(describeTransportFailure(aborted)).toBe("no response within 10 seconds");
  });

  it("passes a plain message and a non-Error through", () => {
    expect(describeTransportFailure(new Error("socket hang up"))).toBe(
      "socket hang up",
    );
    expect(describeTransportFailure("odd")).toBe("odd");
  });
});

describe("createFetchWebhookSender", () => {
  it("bounds an unresponsive injected transport with the configured timeout", async () => {
    const sender = createFetchWebhookSender({
      timeoutMs: 5,
      fetch: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), {
            once: true,
          });
        }),
    });
    const response = await sender.send({
      url: "https://receiver.example/slow",
      signingKey: "a".repeat(64),
      body: "{}",
      deliveryId: "delivery-1",
      eventId: null,
      eventType: "task.created",
      attempt: 1,
      timestampSeconds: 1_800_000_000,
    });
    expect(response).toEqual({
      status: null,
      error: "no response within 0.005 seconds",
    });
  });

  it("signs the request and reports a refusal as a failed attempt", async () => {
    const seen: { url: string; headers: Headers; body: string }[] = [];
    const sender = createFetchWebhookSender({
      fetch: async (url, init) => {
        seen.push({
          url: String(url),
          headers: new Headers(init?.headers),
          body: String(init?.body),
        });
        return new Response(null, { status: 410 });
      },
    });

    const response = await sender.send({
      url: "https://receiver.example/hook",
      signingKey: "a".repeat(64),
      body: '{"hello":"world"}',
      deliveryId: "01996c5e-0000-7000-8000-00000000000b",
      eventId: "01996c5d-0000-7000-8000-00000000000a",
      eventType: "task.created",
      attempt: 2,
      timestampSeconds: 1_800_000_000,
    });

    expect(response).toEqual({ status: 410, error: "endpoint responded 410" });
    expect(seen[0]?.headers.get("Morrow-Attempt")).toBe("2");
    expect(seen[0]?.headers.get("Morrow-Signature")).toMatch(/^t=1800000000,v1=/);
  });
});
