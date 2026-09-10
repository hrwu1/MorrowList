import { describe, expect, it } from "vitest";

import {
  FALLBACK_NOTIFICATION,
  notificationTarget,
  readPushNotification,
} from "./push-payload";

const SCOPE = "https://morrow.example/";

describe("readPushNotification", () => {
  it("reads the payload the server sends", () => {
    expect(
      readPushNotification({
        title: "Reminder: Draft the brief",
        body: "ML-000001 is due 2026-09-15 at 09:30 (Europe/Berlin).",
        url: "/tasks/ML-000001",
        tag: "reminder:01a04e0f",
      }),
    ).toEqual({
      title: "Reminder: Draft the brief",
      body: "ML-000001 is due 2026-09-15 at 09:30 (Europe/Berlin).",
      url: "/tasks/ML-000001",
      tag: "reminder:01a04e0f",
    });
  });

  it("falls back member by member rather than dropping the whole notification", () => {
    // A browser with permission shows its own "updated in the background" notice when the
    // worker shows nothing, so showing something is always better than showing nothing.
    expect(readPushNotification({ title: "Reminder: X" })).toEqual({
      ...FALLBACK_NOTIFICATION,
      title: "Reminder: X",
    });
    expect(readPushNotification({ title: "", body: 42 })).toEqual(
      FALLBACK_NOTIFICATION,
    );
  });

  it("falls back on anything that is not an object", () => {
    for (const value of [null, undefined, "text", 7, []]) {
      expect(readPushNotification(value)).toEqual(FALLBACK_NOTIFICATION);
    }
  });
});

describe("notificationTarget", () => {
  it("resolves a relative URL against the worker's scope", () => {
    expect(notificationTarget("/tasks/ML-000001", SCOPE)).toBe(
      "https://morrow.example/tasks/ML-000001",
    );
    expect(notificationTarget("/today", SCOPE)).toBe("https://morrow.example/today");
  });

  it("keeps an absolute URL on this origin", () => {
    expect(notificationTarget("https://morrow.example/upcoming", SCOPE)).toBe(
      "https://morrow.example/upcoming",
    );
  });

  it("refuses to navigate anywhere but this origin", () => {
    // The payload is the server's, but it reaches the worker through a third-party push
    // service, so a click may never leave the app.
    for (const hostile of [
      "https://evil.example/phish",
      "javascript:alert(1)",
      "//evil.example/phish",
    ]) {
      expect(notificationTarget(hostile, SCOPE)).toBe("https://morrow.example/today");
    }
  });

  it("falls back on a URL that cannot be parsed at all", () => {
    expect(notificationTarget("http://[", SCOPE)).toBe("https://morrow.example/today");
  });
});
