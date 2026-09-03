import { describe, expect, it } from "vitest";

import {
  TAG_COLOR_TOKENS,
  TAG_NAME_MAX_LENGTH,
  normalizeTagName,
  tagLookupKey,
  toTagColorToken,
} from "./tag.js";

describe("normalizeTagName", () => {
  it("trims and collapses internal whitespace while keeping the casing", () => {
    expect(normalizeTagName("  Deep \t\n Work  ")).toBe("Deep Work");
  });

  it("rejects a blank name", () => {
    expect(() => normalizeTagName("   ")).toThrow(/required/);
  });

  it("counts length in code points", () => {
    expect(normalizeTagName("🏷️".repeat(20))).toHaveLength("🏷️".repeat(20).length);
    expect(() => normalizeTagName("x".repeat(TAG_NAME_MAX_LENGTH + 1))).toThrow(
      /80 characters/,
    );
  });

  it("treats composed and decomposed spellings as the same name", () => {
    expect(normalizeTagName("Café")).toBe("Café");
  });
});

describe("tagLookupKey", () => {
  it("is case-insensitive and whitespace-insensitive", () => {
    expect(tagLookupKey("Deep Work")).toBe("deep work");
    expect(tagLookupKey("  deep   WORK ")).toBe("deep work");
    expect(tagLookupKey("DEEP WORK")).toBe(tagLookupKey("deep work"));
  });
});

describe("toTagColorToken", () => {
  it("accepts every palette token", () => {
    for (const token of TAG_COLOR_TOKENS) {
      expect(toTagColorToken(token)).toBe(token);
    }
  });

  it("rejects an unknown token with the allowed list", () => {
    expect(() => toTagColorToken("magenta")).toThrow(/palette/);
    try {
      toTagColorToken("magenta");
    } catch (error) {
      expect((error as { details: { allowed: unknown } }).details.allowed).toEqual(
        TAG_COLOR_TOKENS,
      );
    }
  });

  it("offers at least eight hues plus a neutral", () => {
    expect(TAG_COLOR_TOKENS).toContain("neutral");
    expect(TAG_COLOR_TOKENS.length).toBeGreaterThanOrEqual(9);
  });
});
