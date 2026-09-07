import type { RuleCandidate, RuleRepository } from "@morrowlist/application";
import { toLocalDate, uuidv7 } from "@morrowlist/domain";
import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";

import type { Database } from "../client.js";
import { outboxEvents, ruleRuns, rules, tasks, workspaces } from "../schema/index.js";

import { toOutboxEvent } from "./events.js";

export function createRuleRepository(db: Database): RuleRepository {
  return {
    async list(workspaceId) {
      return db
        .select()
        .from(rules)
        .where(eq(rules.workspaceId, workspaceId))
        .orderBy(rules.id);
    },
    async findById(workspaceId, id) {
      return (
        (
          await db
            .select()
            .from(rules)
            .where(and(eq(rules.workspaceId, workspaceId), eq(rules.id, id)))
        )[0] ?? null
      );
    },
    async insert(rule) {
      await db.insert(rules).values(rule);
    },
    async update(rule) {
      await db
        .update(rules)
        .set(rule)
        .where(and(eq(rules.workspaceId, rule.workspaceId), eq(rules.id, rule.id)));
    },
    async delete(workspaceId, id) {
      await db
        .delete(rules)
        .where(and(eq(rules.workspaceId, workspaceId), eq(rules.id, id)));
    },
    async candidates(now, limit) {
      const rows = await db
        .select({ rule: rules, event: outboxEvents })
        .from(rules)
        .innerJoin(
          outboxEvents,
          and(
            eq(outboxEvents.workspaceId, rules.workspaceId),
            sql`${outboxEvents.eventType} = ${rules.trigger}->>'type'`,
            sql`${outboxEvents.occurredAt} >= ${rules.updatedAt}`,
          ),
        )
        .leftJoin(
          ruleRuns,
          and(
            eq(ruleRuns.ruleId, rules.id),
            sql`${ruleRuns.eventKey} = ${outboxEvents.id}::text`,
          ),
        )
        .where(
          and(
            eq(rules.enabled, true),
            eq(outboxEvents.aggregateType, "task"),
            isNull(outboxEvents.causationId),
            lte(outboxEvents.availableAt, now),
            isNull(ruleRuns.id),
          ),
        )
        .orderBy(outboxEvents.occurredAt, outboxEvents.id, rules.id)
        .limit(limit);
      return rows.map(({ rule, event }) => ({
        rule,
        event: toOutboxEvent(event),
        eventKey: event.id,
        synthetic: false,
      }));
    },
    async dueCandidates(now, limit) {
      const date = sql`to_char(${now.toISOString()}::timestamptz AT TIME ZONE ${workspaces.timezone}, 'YYYY-MM-DD')`;
      const key = sql`'due:' || ${tasks.id}::text || ':' || ${date}`;
      const rows = await db
        .select({ rule: rules, task: tasks, timezone: workspaces.timezone })
        .from(rules)
        .innerJoin(workspaces, eq(workspaces.id, rules.workspaceId))
        .innerJoin(tasks, eq(tasks.workspaceId, rules.workspaceId))
        .leftJoin(
          ruleRuns,
          and(eq(ruleRuns.ruleId, rules.id), sql`${ruleRuns.eventKey} = ${key}`),
        )
        .where(
          and(
            eq(rules.enabled, true),
            sql`${rules.trigger}->>'type' = 'due.today'`,
            sql`${tasks.dueDate}::text = ${date}`,
            isNull(tasks.deletedAt),
            isNull(tasks.completedAt),
            isNull(ruleRuns.id),
          ),
        )
        .orderBy(rules.id, tasks.id)
        .limit(limit);
      return rows.map(
        ({ rule, task, timezone }): RuleCandidate => ({
          rule,
          synthetic: true,
          eventKey: `due:${task.id}:${toLocalDate(now, timezone)}`,
          event: {
            id: uuidv7(),
            workspaceId: rule.workspaceId,
            schemaVersion: 1,
            eventType: "due.today",
            aggregateType: "task",
            aggregateId: task.id,
            actor: { kind: "system", id: "rules-daily-tick" },
            payload: { taskId: task.id, date: toLocalDate(now, timezone) },
            correlationId: `due:${toLocalDate(now, timezone)}`,
            occurredAt: now,
            availableAt: now,
          },
        }),
      );
    },
    async claim(run) {
      return (
        (
          await db
            .insert(ruleRuns)
            .values(run)
            .onConflictDoNothing({ target: [ruleRuns.ruleId, ruleRuns.eventKey] })
            .returning({ id: ruleRuns.id })
        ).length > 0
      );
    },
    async finish(run) {
      await db.update(ruleRuns).set(run).where(eq(ruleRuns.id, run.id));
    },
    async runs(ruleId, limit) {
      return db
        .select()
        .from(ruleRuns)
        .where(eq(ruleRuns.ruleId, ruleId))
        .orderBy(desc(ruleRuns.ranAt), desc(ruleRuns.id))
        .limit(limit);
    },
  };
}
