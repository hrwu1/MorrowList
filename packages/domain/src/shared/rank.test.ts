import { describe, expect, it } from "vitest";

import {
  INITIAL_RANK,
  InvalidRankError,
  isValidRank,
  rankBetween,
  ranksBetween,
} from "./rank.js";

describe("rankBetween", () => {
  it("returns the initial rank for an empty scope", () => {
    expect(rankBetween(null, null)).toBe(INITIAL_RANK);
  });

  it("produces a key strictly between its neighbours", () => {
    const first = rankBetween(null, null);
    const third = rankBetween(first, null);
    const second = rankBetween(first, third);

    expect(first < second).toBe(true);
    expect(second < third).toBe(true);
  });

  it("orders keys appended at the end", () => {
    const keys: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 200; i++) {
      cursor = rankBetween(cursor, null);
      keys.push(cursor);
    }

    expect([...keys].sort()).toEqual(keys);
  });

  it("keeps appended keys short rather than growing per insert", () => {
    let cursor: string | null = null;
    for (let i = 0; i < 1000; i++) {
      cursor = rankBetween(cursor, null);
    }

    // A naive midpoint scheme would reach hundreds of characters here.
    expect((cursor as unknown as string).length).toBeLessThanOrEqual(10);
  });

  it("orders keys prepended at the start", () => {
    const keys: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 200; i++) {
      cursor = rankBetween(null, cursor);
      keys.unshift(cursor);
    }

    expect([...keys].sort()).toEqual(keys);
  });

  it("survives repeated insertion into the same gap", () => {
    let lower = rankBetween(null, null);
    const upper = rankBetween(lower, null);

    for (let i = 0; i < 100; i++) {
      const next = rankBetween(lower, upper);
      expect(lower < next).toBe(true);
      expect(next < upper).toBe(true);
      lower = next;
    }
  });

  it("stays under the 64 character column budget for deep nesting", () => {
    let lower = rankBetween(null, null);
    const upper = rankBetween(lower, null);
    let longest = 0;

    for (let i = 0; i < 200; i++) {
      lower = rankBetween(lower, upper);
      longest = Math.max(longest, lower.length);
    }

    expect(longest).toBeLessThanOrEqual(64);
  });

  it("rejects reversed bounds", () => {
    const first = rankBetween(null, null);
    const second = rankBetween(first, null);

    expect(() => rankBetween(second, first)).toThrow(InvalidRankError);
  });

  it("rejects equal bounds", () => {
    const key = rankBetween(null, null);

    expect(() => rankBetween(key, key)).toThrow(InvalidRankError);
  });

  it("rejects malformed keys", () => {
    expect(() => rankBetween("!!", null)).toThrow(InvalidRankError);
    expect(() => rankBetween("", null)).toThrow(InvalidRankError);
    expect(isValidRank("a0")).toBe(true);
    expect(isValidRank("a00")).toBe(false);
  });

  it("sorts by ASCII code point across digit classes", () => {
    // Guards the COLLATE "C" requirement: digits < uppercase < lowercase.
    const keys = ["a0", "a9", "aA", "aZ", "aa", "az"];

    expect([...keys].sort()).toEqual(keys);
  });
});

describe("ranksBetween", () => {
  it("returns nothing for a count of zero", () => {
    expect(ranksBetween(null, null, 0)).toEqual([]);
  });

  it("returns ordered keys inside the bounds", () => {
    const lower = rankBetween(null, null);
    const upper = rankBetween(lower, null);
    const keys = ranksBetween(lower, upper, 25);

    expect(keys).toHaveLength(25);
    expect([...keys].sort()).toEqual(keys);
    expect(lower < (keys[0] as string)).toBe(true);
    expect((keys.at(-1) as string) < upper).toBe(true);
  });

  it("returns ordered keys for an unbounded scope", () => {
    const keys = ranksBetween(null, null, 50);

    expect(keys).toHaveLength(50);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(50);
  });

  it("returns ordered keys before an upper bound", () => {
    const upper = rankBetween(null, null);
    const keys = ranksBetween(null, upper, 10);

    expect([...keys].sort()).toEqual(keys);
    expect((keys.at(-1) as string) < upper).toBe(true);
  });
});
