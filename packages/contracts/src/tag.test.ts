import { describe, expect, it } from "vitest";

import { createTagRequestSchema, updateTagRequestSchema } from "./tag.js";

describe("createTagRequestSchema", () => {
  it("accepts a name on its own and trims it", () => {
    const parsed = createTagRequestSchema.parse({ name: "  Deep Work " });

    expect(parsed.name).toBe("Deep Work");
    expect(parsed.colorToken).toBeUndefined();
  });

  it("rejects a blank name and an unknown colour", () => {
    expect(createTagRequestSchema.safeParse({ name: "  " }).success).toBe(false);
    expect(
      createTagRequestSchema.safeParse({ name: "x", colorToken: "magenta" }).success,
    ).toBe(false);
  });
});

describe("updateTagRequestSchema", () => {
  it("distinguishes an omitted description from an explicit null", () => {
    const omitted = updateTagRequestSchema.parse({ name: "New" });
    expect("description" in omitted).toBe(false);

    const cleared = updateTagRequestSchema.parse({ description: null });
    expect(cleared.description).toBeNull();
  });

  it("rejects an empty patch", () => {
    expect(updateTagRequestSchema.safeParse({}).success).toBe(false);
  });
});
