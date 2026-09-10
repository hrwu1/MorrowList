import { describe, expect, it } from "vitest";

import { applicationServerKey, pushState } from "./push";

describe("pushState", () => {
  const inputs = {
    configured: true,
    supported: true,
    permission: "default" as NotificationPermission | null,
    subscribed: false,
  };

  it("offers the control when the server and the browser can both do it", () => {
    expect(pushState(inputs)).toEqual({
      blocker: null,
      subscribed: false,
      hint: "You will be asked for permission when you turn this on.",
    });
  });

  it("says the device is registered once it is", () => {
    expect(pushState({ ...inputs, permission: "granted", subscribed: true })).toEqual({
      blocker: null,
      subscribed: true,
      hint: "This device is registered.",
    });
  });

  it("blames the server first, because that is the half an administrator can fix", () => {
    // Unconfigured *and* unsupported: the deployment is the answer the user can act on.
    expect(pushState({ ...inputs, configured: false, supported: false }).blocker).toBe(
      "unconfigured",
    );
  });

  it("reports an unsupported browser and a refused permission separately", () => {
    expect(pushState({ ...inputs, supported: false }).blocker).toBe("unsupported");
    expect(pushState({ ...inputs, permission: "denied" }).blocker).toBe("denied");
    // Only the browser's own settings can undo a refusal, so the hint has to say so.
    expect(pushState({ ...inputs, permission: "denied" }).hint).toMatch(
      /browser settings/,
    );
  });
});

describe("applicationServerKey", () => {
  it("decodes the base64url key the server publishes into its 65 raw bytes", () => {
    // A real uncompressed P-256 point: 0x04 followed by two 32-byte coordinates.
    const raw = new Uint8Array(65);
    raw[0] = 4;
    for (let index = 1; index < 65; index++) raw[index] = index;
    const base64url = Buffer.from(raw).toString("base64url");

    const decoded = applicationServerKey(base64url);

    expect(decoded).toHaveLength(65);
    expect([...decoded]).toEqual([...raw]);
  });

  it("handles a key whose base64url needs padding restored", () => {
    for (const length of [1, 2, 3, 4, 5]) {
      const raw = Buffer.alloc(length, 7);
      expect([...applicationServerKey(raw.toString("base64url"))]).toEqual([...raw]);
    }
  });
});
