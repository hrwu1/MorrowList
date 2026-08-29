import { describe, expect, it } from "vitest";

import { isUuid, uuidv7, uuidv7At, uuidv7Timestamp } from "./uuid.js";

describe("uuidv7", () => {
  it("produces a well-formed version 7 UUID", () => {
    const id = uuidv7();

    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe("7");
    expect("89ab").toContain(id[19] as string);
  });

  it("stays ordered across successive calls", () => {
    const ids = Array.from({ length: 1000 }, () => uuidv7());

    expect(new Set(ids).size).toBe(1000);
    expect([...ids].sort()).toEqual(ids);
  });
});

describe("uuidv7At", () => {
  it("encodes the supplied generation time exactly", () => {
    const now = Date.UTC(2026, 7, 29, 12, 0, 0);
    const id = uuidv7At(now);

    expect(uuidv7Timestamp(id)?.getTime()).toBe(now);
  });

  it("sorts lexicographically by generation time", () => {
    const ids = [
      uuidv7At(Date.UTC(2026, 0, 1)),
      uuidv7At(Date.UTC(2026, 5, 1)),
      uuidv7At(Date.UTC(2026, 11, 1)),
    ];

    expect([...ids].sort()).toEqual(ids);
  });

  it("stays strictly increasing within a single millisecond", () => {
    const now = Date.UTC(2026, 7, 29, 13, 0, 0);
    const ids = Array.from({ length: 5000 }, () => uuidv7At(now));

    expect(new Set(ids).size).toBe(5000);
    expect([...ids].sort()).toEqual(ids);
  });
});

describe("uuid helpers", () => {
  it("rejects non-UUID input", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(uuidv7Timestamp("not-a-uuid")).toBeNull();
  });

  it("returns null for a non-v7 UUID", () => {
    expect(uuidv7Timestamp("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBeNull();
  });
});
