import {
  DomainError,
  evaluateRule,
  fixedClock,
  systemClock,
  toLocalDate,
  uuidv7,
  type Clock,
} from "@morrowlist/domain";

import type {
  RuleCandidate,
  RuleRun,
  TransactionContext,
  UnitOfWork,
} from "../ports/index.js";
import { SCOPES, type ActorContext } from "../shared/actor-context.js";
import { recordEvent } from "../shared/event-recorder.js";
import { TaskService } from "../tasks/service.js";

import { validateRuleTargets } from "./service.js";

export const RULE_BATCH_SIZE = 100;
export class RuleEngine {
  private readonly clock: Clock;
  constructor(private readonly options: { unitOfWork: UnitOfWork; clock?: Clock }) {
    this.clock = options.clock ?? systemClock;
  }
  async tick(now = this.clock.now()): Promise<number> {
    const candidates = await this.options.unitOfWork.execute(async (tx) => [
      ...(await tx.rules.candidates(now, RULE_BATCH_SIZE)),
      ...(await tx.rules.dueCandidates(now, RULE_BATCH_SIZE)),
    ]);
    let succeeded = 0;
    for (const candidate of candidates)
      if (await this.handle(candidate, now)) succeeded++;
    return succeeded;
  }
  async handle(candidate: RuleCandidate, now = this.clock.now()): Promise<boolean> {
    const run: RuleRun = {
      id: uuidv7(),
      ruleId: candidate.rule.id,
      taskId: candidate.event.aggregateId,
      eventKey: candidate.eventKey,
      outboxEventId: candidate.synthetic ? null : candidate.event.id,
      status: "skipped",
      error: null,
      ranAt: now,
    };
    try {
      return await this.options.unitOfWork.execute(async (tx) => {
        const rule = await tx.rules.findById(
          candidate.rule.workspaceId,
          candidate.rule.id,
        );
        if (
          !rule ||
          !rule.enabled ||
          rule.updatedAt.getTime() !== candidate.rule.updatedAt.getTime()
        )
          return false;
        if (!(await tx.rules.claim(run))) return false;
        const task = await tx.tasks.findById(rule.workspaceId, run.taskId);
        const workspace = await tx.workspaces.findById(rule.workspaceId);
        if (!task || !workspace) return false;
        const tags = await tx.tasks.tagsFor(rule.workspaceId, [task.id]);
        const actions = evaluateRule(
          rule,
          candidate.event,
          { ...task, tagIds: (tags.get(task.id) ?? []).map((tag) => tag.id) },
          toLocalDate(now, workspace.timezone),
        );
        if (actions.length === 0) return false;
        await validateRuleTargets(tx, rule.workspaceId, rule);
        const context: ActorContext = {
          actorKind: "system",
          actorId: `rule:${rule.id}`,
          actorDisplayName: `Rule: ${rule.name}`,
          workspaceIds: [rule.workspaceId],
          scopes: new Set([SCOPES.tasksWrite, SCOPES.workspaceWrite]),
          requestId: candidate.event.correlationId,
          causationId: candidate.event.id,
        };
        // Public services share the claim's transaction; they do not open independent commits.
        const service = new TaskService({
          unitOfWork: { execute: (fn) => fn(tx) },
          clock: fixedClock(now),
          cursorSecret: "rules-internal-cursor",
        });
        let syntheticQueued = false;
        for (const action of actions) {
          switch (action.type) {
            case "add_to_day":
              await service.addToDay(context, rule.workspaceId, task.id);
              break;
            case "move_to":
              await service.move(context, rule.workspaceId, task.id, {
                projectId: action.projectId,
                ...(action.statusId !== undefined ? { statusId: action.statusId } : {}),
              });
              break;
            case "set_priority":
              await service.update(context, rule.workspaceId, task.id, {
                priority: action.priority,
              });
              break;
            case "add_tag":
              await service.addTag(context, rule.workspaceId, task.id, action.tagId);
              break;
            case "complete":
              await service.complete(context, rule.workspaceId, task.id);
              break;
            case "call_webhook": {
              if (candidate.synthetic && !syntheticQueued) {
                await tx.outbox.enqueue({
                  ...candidate.event,
                  actor: { kind: "system", id: context.actorId },
                  causationId: candidate.event.id,
                });
                syntheticQueued = true;
              }
              await this.queueWebhook(tx, candidate, action.subscriptionId, now);
              await recordEvent(tx, context, fixedClock(now), {
                workspaceId: rule.workspaceId,
                aggregateType: "task",
                aggregateId: task.id,
                eventType: "task.rule_webhook_queued",
                summary: `Queued webhook through rule ${rule.name}`,
                payload: {
                  taskId: task.id,
                  ruleId: rule.id,
                  subscriptionId: action.subscriptionId,
                },
              });
              break;
            }
          }
        }
        await tx.rules.finish({ ...run, status: "succeeded" });
        return true;
      });
    } catch (error) {
      // The failed transaction leaves no claim or partial actions. Persist only a safe error code.
      await this.options.unitOfWork.execute(async (tx) => {
        if (!(await tx.rules.findById(candidate.rule.workspaceId, candidate.rule.id)))
          return;
        await tx.rules.claim({
          ...run,
          status: "failed",
          error:
            error instanceof DomainError
              ? `${error.code}: ${error.message}`.slice(0, 300)
              : "Rule actions failed; all task changes were rolled back.",
        });
      });
      return false;
    }
  }
  private async queueWebhook(
    tx: TransactionContext,
    candidate: RuleCandidate,
    subscriptionId: string,
    now: Date,
  ) {
    await tx.webhookDeliveries.enqueueIfAbsent({
      id: uuidv7(),
      workspaceId: candidate.rule.workspaceId,
      subscriptionId,
      outboxEventId: candidate.event.id,
      eventType: candidate.event.eventType,
      status: "pending",
      attempt: 0,
      responseCode: null,
      error: null,
      nextAttemptAt: now,
      deliveredAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }
}
