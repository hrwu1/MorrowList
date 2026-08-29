import type {
  ActivityRepository,
  OutboxRepository,
} from "@morrowlist/application";
import { and, desc, eq, isNull } from "drizzle-orm";

import type { Database } from "../client.js";
import { activityEvents, outboxEvents } from "../schema/index.js";

/** Activity and outbox writers (EVT-001). Both are append-only for application roles. */

export function createActivityRepository(db: Database): ActivityRepository {
  return {
    async append(event) {
      await db.insert(activityEvents).values({
        id: event.id,
        workspaceId: event.workspaceId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        actorKind: event.actorKind,
        actorId: event.actorId,
        actorDisplayName: event.actorDisplayName,
        summary: event.summary,
        payload: event.payload,
        correlationId: event.correlationId,
        createdAt: event.createdAt,
      });
    },

    async listForAggregate(workspaceId, aggregateType, aggregateId, limit = 50) {
      const rows = await db
        .select()
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.workspaceId, workspaceId),
            eq(activityEvents.aggregateType, aggregateType),
            eq(activityEvents.aggregateId, aggregateId),
          ),
        )
        .orderBy(desc(activityEvents.createdAt))
        .limit(limit);

      return rows.map((row) => ({
        ...row,
        payload: row.payload as Record<string, unknown>,
      }));
    },
  };
}

export function createOutboxRepository(db: Database): OutboxRepository {
  return {
    async enqueue(event) {
      await db.insert(outboxEvents).values({
        id: event.id,
        workspaceId: event.workspaceId,
        schemaVersion: event.schemaVersion,
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        actor: event.actor,
        payload: event.payload,
        correlationId: event.correlationId,
        causationId: event.causationId ?? null,
        occurredAt: event.occurredAt,
        availableAt: event.availableAt,
      });
    },

    async listUnpublished(workspaceId, limit = 100) {
      const rows = await db
        .select()
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.workspaceId, workspaceId),
            isNull(outboxEvents.publishedAt),
          ),
        )
        .orderBy(outboxEvents.availableAt, outboxEvents.id)
        .limit(limit);

      return rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspaceId,
        schemaVersion: row.schemaVersion,
        eventType: row.eventType,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        actor: row.actor as { kind: never; id: string },
        payload: row.payload as Record<string, unknown>,
        correlationId: row.correlationId,
        causationId: row.causationId ?? undefined,
        occurredAt: row.occurredAt,
        availableAt: row.availableAt,
      }));
    },
  };
}
