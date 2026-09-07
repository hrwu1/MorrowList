import { describe, expect, it } from "vitest";

import {
  capturePath,
  captureReturnTo,
  readSharedCapture,
  sharedTaskRequest,
  captureBookmarklet,
} from "./share";
describe("share transport", () => {
  it("preserves title, selected text and URL through login encoding", () => {
    const data = {
      title: "A & B",
      text: "Notes\nSecond line",
      url: "https://example.com/?q=a&b=2",
    };
    expect(
      readSharedCapture(new URLSearchParams(capturePath(data).split("?")[1])),
    ).toEqual(data);
    expect(sharedTaskRequest(data)).toEqual({
      title: "A & B",
      descriptionMd: "Notes\nSecond line\n\nhttps://example.com/?q=a&b=2",
    });
    expect(captureReturnTo(capturePath(data))).toBe(capturePath(data));
  });
  it("rejects active URLs, overlong fields and nonlocal login redirects", () => {
    expect(() =>
      readSharedCapture(new URLSearchParams({ url: "javascript:alert(1)" })),
    ).toThrow();
    expect(() =>
      readSharedCapture(new URLSearchParams({ text: "a".repeat(8001) })),
    ).toThrow();
    for (const path of [
      "https://evil.example",
      "//evil.example",
      "/capture/../evil",
      "/capture?x=\n",
    ])
      expect(captureReturnTo(path)).toBe("/inbox");
  });
  it("builds an origin-bound bookmarklet without credentials", () => {
    expect(captureBookmarklet("https://morrow.example")).toContain(
      '"https://morrow.example/capture"',
    );
    expect(captureBookmarklet("https://morrow.example")).toContain(
      "encodeURIComponent(location.href)",
    );
  });
});
