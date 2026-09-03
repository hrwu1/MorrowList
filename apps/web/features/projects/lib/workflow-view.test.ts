import type { WorkflowStatusDto } from "@morrowlist/contracts";
import { describe, expect, it } from "vitest";

import {
  categoryChangeConsequence,
  moveStatusInList,
  patchStatusInList,
  placementForIndex,
} from "./workflow-view";

const status = (
  id: string,
  rank: string,
  overrides: Partial<WorkflowStatusDto> = {},
): WorkflowStatusDto => ({
  id,
  projectId: "p",
  name: id,
  category: "ready",
  rank,
  colorToken: "blue",
  wipLimit: null,
  isDefault: false,
  isTerminal: false,
  policyMd: null,
  archivedAt: null,
  version: 1,
  ...overrides,
});

const list = [status("a", "a0"), status("b", "a1"), status("c", "a2")];

describe("placementForIndex", () => {
  it("names the neighbours around the target position, excluding the mover", () => {
    expect(placementForIndex(list, "c", 0)).toEqual({
      beforeStatusId: null,
      afterStatusId: "a",
    });
    expect(placementForIndex(list, "a", 1)).toEqual({
      beforeStatusId: "b",
      afterStatusId: "c",
    });
    expect(placementForIndex(list, "a", 9)).toEqual({
      beforeStatusId: "c",
      afterStatusId: null,
    });
  });
});

describe("moveStatusInList", () => {
  it("moves before the successor, after the predecessor, or to the end", () => {
    const ids = (statuses: WorkflowStatusDto[]) => statuses.map((s) => s.id);
    expect(
      ids(moveStatusInList(list, "c", { beforeStatusId: null, afterStatusId: "a" })),
    ).toEqual(["c", "a", "b"]);
    expect(
      ids(moveStatusInList(list, "a", { beforeStatusId: "b", afterStatusId: null })),
    ).toEqual(["b", "a", "c"]);
    expect(
      ids(moveStatusInList(list, "a", { beforeStatusId: null, afterStatusId: null })),
    ).toEqual(["b", "c", "a"]);
    expect(
      ids(moveStatusInList(list, "zz", { beforeStatusId: null, afterStatusId: null })),
    ).toEqual(["a", "b", "c"]);
  });
});

describe("patchStatusInList", () => {
  it("replaces in rank order, appends a new column, and drops an archived one", () => {
    const renamed = patchStatusInList(list, status("b", "a1", { name: "Beta" }));
    expect(renamed.map((s) => s.name)).toEqual(["a", "Beta", "c"]);

    const added = patchStatusInList(list, status("d", "a3"));
    expect(added.map((s) => s.id)).toEqual(["a", "b", "c", "d"]);

    const moved = patchStatusInList(list, status("c", "Zz"));
    expect(moved.map((s) => s.id)).toEqual(["c", "a", "b"]);

    const archived = patchStatusInList(
      list,
      status("b", "a1", { archivedAt: "2026-09-01T00:00:00.000Z" }),
    );
    expect(archived.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("demotes the previous default when another becomes the default", () => {
    const withDefault = [status("a", "a0", { isDefault: true }), status("b", "a1")];
    const patched = patchStatusInList(
      withDefault,
      status("b", "a1", { isDefault: true }),
    );
    expect(patched.map((s) => [s.id, s.isDefault])).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });
});

describe("categoryChangeConsequence", () => {
  it("only speaks up when the Done boundary is crossed", () => {
    expect(categoryChangeConsequence("ready", "review", 3)).toBeNull();
    expect(categoryChangeConsequence("done", "done", 3)).toBeNull();
    expect(categoryChangeConsequence("review", "done", 1)).toMatch(
      /completes the 1 task /,
    );
    expect(categoryChangeConsequence("done", "backlog", 2)).toMatch(
      /reopens the 2 tasks/,
    );
  });
});
