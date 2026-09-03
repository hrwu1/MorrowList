import type { TagDto } from "@morrowlist/contracts";
import { describe, expect, it } from "vitest";

import { findTagByName, sortTags, visibleTags } from "./tags";

function tag(name: string, id = name): TagDto {
  return {
    id,
    workspaceId: "01a04e0f-2e8a-7000-ae0a-989d784c0288",
    name,
    colorToken: "neutral",
    description: null,
    createdAt: "2026-09-03T09:00:00.000Z",
    updatedAt: "2026-09-03T09:00:00.000Z",
  };
}

describe("sortTags", () => {
  it("orders case-insensitively by name, then by id", () => {
    const sorted = sortTags([
      tag("zulu"),
      tag("Alpha"),
      tag("alpha", "2"),
      tag("Mike"),
    ]);

    expect(sorted.map((t) => [t.name, t.id])).toEqual([
      ["alpha", "2"],
      ["Alpha", "Alpha"],
      ["Mike", "Mike"],
      ["zulu", "zulu"],
    ]);
  });
});

describe("visibleTags", () => {
  it("shows every tag when there are three or fewer", () => {
    const tags = [tag("a"), tag("b"), tag("c")];
    expect(visibleTags(tags)).toEqual({ shown: tags, hidden: [] });
  });

  it("shows three and folds the rest for five tags", () => {
    // Completion criterion: five tags show three chips and "+2".
    const tags = ["a", "b", "c", "d", "e"].map((name) => tag(name));
    const { shown, hidden } = visibleTags(tags);

    expect(shown.map((t) => t.name)).toEqual(["a", "b", "c"]);
    expect(hidden.map((t) => t.name)).toEqual(["d", "e"]);
  });
});

describe("findTagByName", () => {
  it("ignores case and extra whitespace", () => {
    const tags = [tag("Deep Work")];
    expect(findTagByName(tags, "  deep   work ")).toBe(tags[0]);
    expect(findTagByName(tags, "shallow")).toBeUndefined();
  });
});
