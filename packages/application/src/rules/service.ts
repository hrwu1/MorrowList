import { RULE_ONLY_WEBHOOK_EVENT } from "@morrowlist/contracts";
import {
  createRuleRequestSchema,
  type CreateRuleRequest,
  type RuleDto,
  type RuleTestResult,
  type UpdateRuleRequest,
} from "@morrowlist/contracts";
import {
  DomainError,
  evaluateRule,
  systemClock,
  toLocalDate,
  uuidv7,
  type Clock,
} from "@morrowlist/domain";

import type { Rule, TransactionContext, UnitOfWork } from "../ports/index.js";
import {
  assertScope,
  assertWorkspaceAccess,
  SCOPES,
  type ActorContext,
} from "../shared/actor-context.js";
import { recordEvent } from "../shared/event-recorder.js";

export const toRuleDto = (rule: Rule): RuleDto => ({
  ...rule,
  createdAt: rule.createdAt.toISOString(),
  updatedAt: rule.updatedAt.toISOString(),
});
export async function requireRule(
  tx: TransactionContext,
  workspaceId: string,
  id: string,
): Promise<Rule> {
  const rule = await tx.rules.findById(workspaceId, id);
  if (!rule) throw new DomainError("RULE_NOT_FOUND", "Automation rule not found.");
  return rule;
}
export class RuleService {
  private readonly clock: Clock;
  constructor(private readonly options: { unitOfWork: UnitOfWork; clock?: Clock }) {
    this.clock = options.clock ?? systemClock;
  }
  private authorize(context: ActorContext, workspaceId: string, write = false) {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.workspaceWrite);
    if (write) assertScope(context, SCOPES.tasksWrite);
  }
  async list(context: ActorContext, workspaceId: string) {
    this.authorize(context, workspaceId);
    return this.options.unitOfWork.execute(async (tx) => ({
      data: (await tx.rules.list(workspaceId)).map(toRuleDto),
    }));
  }
  async create(context: ActorContext, workspaceId: string, request: CreateRuleRequest) {
    this.authorize(context, workspaceId, true);
    const body = createRuleRequestSchema.parse(request);
    return this.options.unitOfWork.execute(async (tx) => {
      if (body.enabled) await validateRuleTargets(tx, workspaceId, body);
      const now = this.clock.now();
      const rule: Rule = {
        ...body,
        id: uuidv7(),
        workspaceId,
        createdAt: now,
        updatedAt: now,
      };
      await tx.rules.insert(rule);
      await this.record(tx, context, rule, "created");
      return toRuleDto(rule);
    });
  }
  async update(
    context: ActorContext,
    workspaceId: string,
    id: string,
    request: UpdateRuleRequest,
  ) {
    this.authorize(context, workspaceId, true);
    return this.options.unitOfWork.execute(async (tx) => {
      const current = await requireRule(tx, workspaceId, id);
      const body = createRuleRequestSchema.parse({
        name: current.name,
        trigger: current.trigger,
        conditions: current.conditions,
        actions: current.actions,
        enabled: current.enabled,
        ...request,
      });
      if (body.enabled) await validateRuleTargets(tx, workspaceId, body);
      const rule = { ...current, ...body, updatedAt: this.clock.now() };
      await tx.rules.update(rule);
      await this.record(tx, context, rule, "updated");
      return toRuleDto(rule);
    });
  }
  async delete(context: ActorContext, workspaceId: string, id: string) {
    this.authorize(context, workspaceId, true);
    await this.options.unitOfWork.execute(async (tx) => {
      const rule = await requireRule(tx, workspaceId, id);
      await tx.rules.delete(workspaceId, id);
      await this.record(tx, context, rule, "deleted");
    });
  }
  async runs(context: ActorContext, workspaceId: string, id: string, limit = 50) {
    this.authorize(context, workspaceId);
    return this.options.unitOfWork.execute(async (tx) => {
      await requireRule(tx, workspaceId, id);
      return {
        data: (await tx.rules.runs(id, Math.min(200, Math.max(1, limit)))).map(
          (run) => ({ ...run, ranAt: run.ranAt.toISOString() }),
        ),
      };
    });
  }
  async test(
    context: ActorContext,
    workspaceId: string,
    id: string,
    taskId: string,
  ): Promise<RuleTestResult> {
    this.authorize(context, workspaceId);
    assertScope(context, SCOPES.tasksRead);
    return this.options.unitOfWork.execute(async (tx) => {
      const rule = await requireRule(tx, workspaceId, id);
      const task = await tx.tasks.findById(workspaceId, taskId);
      const workspace = await tx.workspaces.findById(workspaceId);
      if (!task || task.deletedAt || !workspace)
        throw new DomainError("TASK_NOT_FOUND", "Task not found.");
      const tags = await tx.tasks.tagsFor(workspaceId, [task.id]);
      const payload: Record<string, unknown> = {};
      if (rule.trigger.type === "task.updated" && rule.trigger.field)
        payload.changes = { [rule.trigger.field]: {} };
      if (rule.trigger.type === "task.tag_added")
        payload.tagId = rule.trigger.tagId ?? tags.get(task.id)?.[0]?.id;
      const actions = evaluateRule(
        rule,
        { eventType: rule.trigger.type, payload },
        { ...task, tagIds: (tags.get(task.id) ?? []).map((tag) => tag.id) },
        toLocalDate(this.clock.now(), workspace.timezone),
      );
      return {
        matches: actions.length > 0,
        actions: [...actions] as RuleTestResult["actions"],
        explanation:
          "Simulates this rule's trigger against the task's current values. No task changes or webhook deliveries are made.",
      };
    });
  }
  private record(
    tx: TransactionContext,
    context: ActorContext,
    rule: Rule,
    operation: string,
  ) {
    return recordEvent(tx, context, this.clock, {
      workspaceId: rule.workspaceId,
      aggregateType: "workspace",
      aggregateId: rule.workspaceId,
      eventType: `workspace.rule_${operation}`,
      summary: `${operation === "created" ? "Created" : operation === "updated" ? "Updated" : "Deleted"} automation rule ${rule.name}`,
      payload: { ruleId: rule.id, name: rule.name, enabled: rule.enabled },
    });
  }
}
/** Validate every referenced resource in the same workspace before persisting or executing. */
export async function validateRuleTargets(
  tx: TransactionContext,
  workspaceId: string,
  rule: CreateRuleRequest,
) {
  const fail = () => {
    throw new DomainError(
      "VALIDATION_FAILED",
      "A rule target is missing, archived, or belongs to another workspace.",
    );
  };
  const tag = async (id: string) => {
    if (!(await tx.tags.findById(workspaceId, id))) fail();
  };
  const project = async (id: string | null) => {
    if (id) {
      const value = await tx.projects.findById(workspaceId, id);
      if (!value || value.archivedAt) fail();
    }
  };
  if (rule.trigger.type === "task.tag_added" && rule.trigger.tagId)
    await tag(rule.trigger.tagId);
  for (const condition of rule.conditions) {
    if (condition.type === "tag_has") await tag(condition.tagId);
    if (condition.type === "project_is") await project(condition.projectId);
  }
  for (const action of rule.actions) {
    if (action.type === "add_tag") await tag(action.tagId);
    if (action.type === "move_to") {
      await project(action.projectId);
      if (action.statusId) {
        const status = await tx.statuses.findById(action.statusId);
        if (!status || status.archivedAt || status.projectId !== action.projectId)
          fail();
      }
    }
    if (action.type === "call_webhook") {
      const subscription = await tx.webhookSubscriptions.findById(
        workspaceId,
        action.subscriptionId,
      );
      if (!subscription || !subscription.active) fail();
      if (
        subscription &&
        (subscription.eventTypes.length !== 1 ||
          subscription.eventTypes[0] !== RULE_ONLY_WEBHOOK_EVENT)
      ) {
        throw new DomainError(
          "VALIDATION_FAILED",
          "Choose an active webhook configured for Rules only so the rule controls delivery.",
        );
      }
    }
  }
}
