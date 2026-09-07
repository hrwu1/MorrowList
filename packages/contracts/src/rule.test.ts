import { describe, expect, it } from "vitest";

import { createRuleRequestSchema, updateRuleRequestSchema } from "./rule.js";
describe("rule contract", () => {
  it("defaults creation only, while patch preserves omitted fields", () => {
    expect(
      createRuleRequestSchema.parse({
        name: "test",
        trigger: { type: "due.today" },
        actions: [{ type: "add_to_day" }],
      }),
    ).toMatchObject({ enabled: true, conditions: [] });
    expect(updateRuleRequestSchema.parse({ name: "new" })).toEqual({ name: "new" });
  });
  it("rejects arbitrary code, unbounded actions and unknown trigger fields", () => {
    const base = {
      name: "test",
      trigger: { type: "task.created" },
      actions: [{ type: "complete" }],
    };
    expect(
      createRuleRequestSchema.safeParse({
        ...base,
        actions: Array.from({ length: 11 }, () => ({ type: "complete" })),
      }).success,
    ).toBe(false);
    expect(
      createRuleRequestSchema.safeParse({
        ...base,
        trigger: { type: "task.created", code: "run" },
      }).success,
    ).toBe(false);
    expect(
      createRuleRequestSchema.safeParse({
        ...base,
        conditions: [{ type: "due_within", days: -1 }],
      }).success,
    ).toBe(false);
  });
});
