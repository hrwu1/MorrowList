import type { TaskDto } from "@morrowlist/contracts";
import { describe, expect, it } from "vitest";

import {
  EMPTY_SELECTION,
  extendTo,
  isSelected,
  retain,
  selectAll,
  selectedTasks,
  selectionLabel,
  toggle,
} from "./selection";

const ORDER = ["a", "b", "c", "d", "e"];

describe("toggling rows", () => {
  it("adds, removes, and always moves the anchor to the last row touched", () => {
    const one = toggle(EMPTY_SELECTION, "b");
    expect(one).toEqual({ ids: ["b"], anchorId: "b" });

    const two = toggle(one, "d");
    expect(two.ids).toEqual(["b", "d"]);
    expect(isSelected(two, "d")).toBe(true);

    // Deselecting still moves the anchor, so a Shift-click extends from where the user is.
    const back = toggle(two, "b");
    expect(back).toEqual({ ids: ["d"], anchorId: "b" });
  });
});

describe("Shift-click ranges", () => {
  it("selects everything between the anchor and the clicked row, in either direction", () => {
    const anchored = toggle(EMPTY_SELECTION, "b");
    expect(extendTo(anchored, "d", ORDER).ids).toEqual(["b", "c", "d"]);
    // Upwards reads the same range.
    expect(extendTo(toggle(EMPTY_SELECTION, "d"), "b", ORDER).ids).toEqual([
      "d",
      "b",
      "c",
    ]);
  });

  it("keeps selections made elsewhere and never repeats a row", () => {
    const start = extendTo(toggle(EMPTY_SELECTION, "a"), "b", ORDER);
    const extended = extendTo({ ...start, anchorId: "d" }, "e", ORDER);
    expect(extended.ids).toEqual(["a", "b", "d", "e"]);
  });

  it("falls back to a plain click with no anchor or an unknown row", () => {
    expect(extendTo(EMPTY_SELECTION, "c", ORDER)).toEqual({
      ids: ["c"],
      anchorId: "c",
    });
    expect(extendTo(toggle(EMPTY_SELECTION, "b"), "zz", ORDER).ids).toEqual([
      "b",
      "zz",
    ]);
  });
});

describe("select all and pruning", () => {
  it("takes everything shown, and clears when everything is already taken", () => {
    const all = selectAll(EMPTY_SELECTION, ORDER);
    expect(all.ids).toEqual(ORDER);
    expect(selectAll(all, ORDER).ids).toEqual([]);
    // A partial selection grows to everything rather than clearing.
    expect(selectAll(toggle(EMPTY_SELECTION, "c"), ORDER).ids).toEqual(ORDER);
  });

  it("forgets rows that have left the list", () => {
    // A bulk complete takes rows out of the list it ran on; the toolbar must not keep
    // offering to act on them.
    const selection = selectAll(EMPTY_SELECTION, ORDER);
    const pruned = retain(selection, ["a", "c"]);
    expect(pruned).toEqual({ ids: ["a", "c"], anchorId: null });
    // Unchanged selections are returned as-is, so a re-render is not forced.
    expect(retain(pruned, ["a", "c"])).toBe(pruned);
  });
});

describe("reading a selection", () => {
  const tasks = ORDER.map((id) => ({ id, title: id }) as TaskDto);

  it("returns tasks in list order rather than pick order", () => {
    const picked = toggle(toggle(EMPTY_SELECTION, "d"), "a");
    expect(selectedTasks(picked, tasks).map((task) => task.id)).toEqual(["a", "d"]);
  });

  it("announces the count in words a screen reader can read out", () => {
    expect(selectionLabel(1)).toBe("1 task selected");
    expect(selectionLabel(3)).toBe("3 tasks selected");
  });
});
