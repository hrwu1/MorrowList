import { describe, expect, it } from "vitest";

import { evaluateRule, type RuleDefinition, type RuleTask } from "./evaluate.js";
const task: RuleTask = {
  projectId: "project",
  priority: "high",
  dueDate: "2026-09-07",
  deletedAt: null,
  completedAt: null,
  tagIds: ["urgent"],
};
const rule: RuleDefinition = {
  enabled: true,
  trigger: { type: "task.tag_added", tagId: "urgent" },
  conditions: [{ type: "priority_is", priority: "high" }],
  actions: [{ type: "set_priority", priority: "urgent" }],
};
describe("fixed rule evaluator", () => {
  it("matches event and all conditions", () => {
    expect(
      evaluateRule(
        rule,
        { eventType: "task.tag_added", payload: { tagId: "urgent" } },
        task,
        "2026-09-07",
      ),
    ).toEqual(rule.actions);
  });
  it("rejects wrong tags, disabled rules and all caused descendants", () => {
    for (const event of [
      { eventType: "task.tag_added", payload: { tagId: "other" } },
      {
        eventType: "task.tag_added",
        payload: { tagId: "urgent" },
        causationId: "other-rule-event",
      },
    ])
      expect(evaluateRule(rule, event, task, "2026-09-07")).toEqual([]);
    expect(
      evaluateRule(
        { ...rule, enabled: false },
        { eventType: "task.tag_added", payload: { tagId: "urgent" } },
        task,
        "2026-09-07",
      ),
    ).toEqual([]);
  });
  it("filters updated fields and AND conditions", () => {
    const updated: RuleDefinition = {
      ...rule,
      trigger: { type: "task.updated", field: "priority" },
      conditions: [
        { type: "project_is", projectId: "project" },
        { type: "tag_has", tagId: "urgent" },
        { type: "due_within", days: 1 },
      ],
    };
    expect(
      evaluateRule(
        updated,
        { eventType: "task.updated", payload: { changes: { priority: {} } } },
        task,
        "2026-09-06",
      ),
    ).toHaveLength(1);
    expect(
      evaluateRule(
        updated,
        { eventType: "task.updated", payload: { changes: { title: {} } } },
        task,
        "2026-09-06",
      ),
    ).toEqual([]);
    expect(
      evaluateRule(
        updated,
        { eventType: "task.updated", payload: { changes: { priority: {} } } },
        task,
        "2026-09-08",
      ),
    ).toEqual([]);
  });
  it("daily trigger skips completed/deleted tasks and requires today", () => {
    const daily: RuleDefinition = {
      ...rule,
      trigger: { type: "due.today" },
      conditions: [],
    };
    expect(
      evaluateRule(daily, { eventType: "due.today", payload: {} }, task, "2026-09-07"),
    ).toHaveLength(1);
    for (const next of [
      { ...task, completedAt: new Date() },
      { ...task, deletedAt: new Date() },
      { ...task, dueDate: null },
    ])
      expect(
        evaluateRule(
          daily,
          { eventType: "due.today", payload: {} },
          next,
          "2026-09-07",
        ),
      ).toEqual([]);
  });
});
