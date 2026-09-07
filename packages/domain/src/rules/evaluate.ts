import type { Priority } from "../task/values.js";

export type RuleTrigger =
  | { type: "task.created" | "task.moved" | "task.completed" | "due.today" }
  | { type: "task.updated"; field?: string | undefined }
  | { type: "task.tag_added"; tagId?: string | undefined };
export type RuleCondition =
  | { type: "project_is"; projectId: string | null }
  | { type: "priority_is"; priority: Priority }
  | { type: "tag_has"; tagId: string }
  | { type: "due_within"; days: number };
export type RuleAction =
  | { type: "add_to_day" | "complete" }
  | { type: "move_to"; projectId: string | null; statusId?: string | null | undefined }
  | { type: "set_priority"; priority: Priority }
  | { type: "add_tag"; tagId: string }
  | { type: "call_webhook"; subscriptionId: string };
export interface RuleDefinition {
  readonly enabled: boolean;
  readonly trigger: RuleTrigger;
  readonly conditions: readonly RuleCondition[];
  readonly actions: readonly RuleAction[];
}
export interface RuleEvent {
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly causationId?: string | undefined;
}
export interface RuleTask {
  readonly projectId: string | null;
  readonly priority: Priority;
  readonly dueDate: string | null;
  readonly deletedAt: Date | null;
  readonly completedAt: Date | null;
  readonly tagIds: readonly string[];
}
/** Pure, deterministic, AND-only catalogue. Rule descendants never trigger any rule. */
export function evaluateRule(
  rule: RuleDefinition,
  event: RuleEvent,
  task: RuleTask,
  today: string,
): readonly RuleAction[] {
  if (
    !rule.enabled ||
    event.causationId ||
    task.deletedAt ||
    rule.trigger.type !== event.eventType
  )
    return [];
  if (rule.trigger.type === "task.updated" && rule.trigger.field) {
    const changes = event.payload.changes;
    if (!changes || typeof changes !== "object" || !(rule.trigger.field in changes))
      return [];
  }
  if (
    rule.trigger.type === "task.tag_added" &&
    rule.trigger.tagId &&
    event.payload.tagId !== rule.trigger.tagId
  )
    return [];
  if (rule.trigger.type === "due.today" && (task.dueDate !== today || task.completedAt))
    return [];
  const matches = rule.conditions.every((condition) => {
    switch (condition.type) {
      case "project_is":
        return task.projectId === condition.projectId;
      case "priority_is":
        return task.priority === condition.priority;
      case "tag_has":
        return task.tagIds.includes(condition.tagId);
      case "due_within": {
        if (!task.dueDate) return false;
        const days = (Date.parse(task.dueDate) - Date.parse(today)) / 86_400_000;
        return days >= 0 && days <= condition.days;
      }
    }
  });
  return matches ? rule.actions : [];
}
