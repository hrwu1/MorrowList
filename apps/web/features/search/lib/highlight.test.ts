import { describe, expect, it } from "vitest";

import { excerpt, segments } from "./highlight";

describe("segments", () => {
  it("splits a text into matched and unmatched runs", () => {
    expect(
      segments("Budget review budget", [
        { start: 0, end: 6 },
        { start: 14, end: 20 },
      ]),
    ).toEqual([
      { text: "Budget", match: true },
      { text: " review ", match: false },
      { text: "budget", match: true },
    ]);
  });

  it("ignores ranges outside the text or overlapping a previous one", () => {
    expect(
      segments("abc", [
        { start: 1, end: 2 },
        { start: 1, end: 3 },
        { start: 5, end: 9 },
      ]),
    ).toEqual([
      { text: "a", match: false },
      { text: "b", match: true },
      { text: "c", match: true },
    ]);
  });

  it("never interprets the text as markup", () => {
    expect(segments("<b>x</b>", [{ start: 3, end: 4 }])).toEqual([
      { text: "<b>", match: false },
      { text: "x", match: true },
      { text: "</b>", match: false },
    ]);
  });
});

describe("excerpt", () => {
  it("windows around the first match and shifts the ranges", () => {
    const text = `${"a".repeat(100)} budget ${"b".repeat(100)}`;
    const result = excerpt(text, [{ start: 101, end: 107 }], 10);

    expect(result.text).toBe("…aaaaaaaaa budget bbbbbbbbb…");
    expect(result.text.slice(result.ranges[0]?.start, result.ranges[0]?.end)).toBe(
      "budget",
    );
  });

  it("shows the opening when nothing matched", () => {
    expect(excerpt("Plain description that runs on", [], 10)).toEqual({
      text: "Plain description th…",
      ranges: [],
    });
  });

  it("drops highlights when whitespace collapsing moved the offsets", () => {
    expect(excerpt("a\n\n  budget", [{ start: 5, end: 11 }]).ranges).toEqual([]);
  });
});
