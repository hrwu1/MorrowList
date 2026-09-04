import { describe, expect, it } from "vitest";

import { describeInProgress } from "./wip";

describe("describeInProgress", () => {
  it("counts without a limit and reads 'n of limit' with one", () => {
    expect(describeInProgress(2, null)).toEqual({
      label: "2 in progress",
      tone: "none",
    });
    expect(describeInProgress(1, 3)).toEqual({
      label: "1 of 3 in progress",
      tone: "under",
    });
  });

  it("changes tone at and over the limit", () => {
    expect(describeInProgress(3, 3).tone).toBe("at");
    expect(describeInProgress(4, 3)).toEqual({
      label: "4 of 3 in progress",
      tone: "over",
    });
  });
});
