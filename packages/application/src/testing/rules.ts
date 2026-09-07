import { toLocalDate, uuidv7 } from "@morrowlist/domain";

import type { RuleCandidate, RuleRepository } from "../ports/rules.js";

import type { InMemoryData } from "./in-memory.js";
export function ruleRepository(data: InMemoryData): RuleRepository {
  return {
    async list(workspaceId) {
      return [...data.rules.values()]
        .filter((r) => r.workspaceId === workspaceId)
        .sort((a, b) => a.id.localeCompare(b.id));
    },
    async findById(workspaceId, id) {
      const rule = data.rules.get(id);
      return rule?.workspaceId === workspaceId ? rule : null;
    },
    async insert(rule) {
      data.rules.set(rule.id, rule);
    },
    async update(rule) {
      data.rules.set(rule.id, rule);
    },
    async delete(workspaceId, id) {
      if (data.rules.get(id)?.workspaceId === workspaceId) {
        data.rules.delete(id);
        for (const [key, run] of data.ruleRuns)
          if (run.ruleId === id) data.ruleRuns.delete(key);
      }
    },
    async candidates(now, limit) {
      const candidates: RuleCandidate[] = [];
      for (const event of [...data.outbox].sort(
        (a, b) =>
          a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id),
      )) {
        if (
          event.aggregateType !== "task" ||
          event.causationId ||
          event.availableAt > now
        )
          continue;
        for (const rule of data.rules.values()) {
          if (
            rule.enabled &&
            rule.workspaceId === event.workspaceId &&
            rule.trigger.type === event.eventType &&
            rule.updatedAt <= event.occurredAt &&
            !data.ruleRuns.has(`${rule.id}:${event.id}`)
          )
            candidates.push({ rule, event, eventKey: event.id, synthetic: false });
        }
      }
      return candidates.slice(0, limit);
    },
    async dueCandidates(now, limit) {
      const candidates: RuleCandidate[] = [];
      for (const rule of data.rules.values()) {
        const workspace = data.workspaces.get(rule.workspaceId);
        if (!rule.enabled || rule.trigger.type !== "due.today" || !workspace) continue;
        const date = toLocalDate(now, workspace.timezone);
        for (const task of data.tasks.values()) {
          const eventKey = `due:${task.id}:${date}`;
          if (
            task.workspaceId !== rule.workspaceId ||
            task.dueDate !== date ||
            task.deletedAt ||
            task.completedAt ||
            data.ruleRuns.has(`${rule.id}:${eventKey}`)
          )
            continue;
          candidates.push({
            rule,
            eventKey,
            synthetic: true,
            event: {
              id: uuidv7(),
              workspaceId: rule.workspaceId,
              schemaVersion: 1,
              eventType: "due.today",
              aggregateType: "task",
              aggregateId: task.id,
              actor: { kind: "system", id: "rules-daily-tick" },
              payload: { taskId: task.id, date },
              correlationId: `due:${date}`,
              occurredAt: now,
              availableAt: now,
            },
          });
        }
      }
      return candidates.slice(0, limit);
    },
    async claim(run) {
      const key = `${run.ruleId}:${run.eventKey}`;
      if (data.ruleRuns.has(key)) return false;
      data.ruleRuns.set(key, run);
      return true;
    },
    async finish(run) {
      data.ruleRuns.set(`${run.ruleId}:${run.eventKey}`, run);
    },
    async runs(ruleId, limit) {
      return [...data.ruleRuns.values()]
        .filter((r) => r.ruleId === ruleId)
        .sort(
          (a, b) => b.ranAt.getTime() - a.ranAt.getTime() || b.id.localeCompare(a.id),
        )
        .slice(0, limit);
    },
  };
}
