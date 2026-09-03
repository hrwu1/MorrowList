import type {
  ActivityEvent,
  ActivityRepository,
  Cursor,
  OutboxRepository,
  Page,
} from "@morrowlist/application";
import { and, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";

import type { Database } from "../client.js";
import { activityEvents, outboxEvents, tasks } from "../schema/index.js";

/** Activity and outbox writers (EVT-001). Both are append-only for application roles. */

export function createActivityRepository(db: Database): ActivityRepository {
  /**
   * Newest first with keyset paging on `(created_at, id)`. The anchor row is re-read by
   * id, as the task list does, so the cursor carries a position and nothing else.
   */
  async function page(
    predicate: SQL | undefined,
    cursor: Cursor,
  ): Promise<Page<ActivityEvent>> {
    const conditions = [predicate];
    if (cursor.after) {
      const [anchor] = await db
        .select({ id: activityEvents.id, createdAt: activityEvents.createdAt })
        .from(activityEvents)
        .where(eq(activityEvents.id, cursor.after))
        .limit(1);
      if (anchor) {
        conditions.push(
          sql`(${activityEvents.createdAt}, ${activityEvents.id}) < (${anchor.createdAt.toISOString()}::timestamptz, ${anchor.id}::uuid)`,
        );
      }
    }

    // One extra row decides `hasMore` without a count query.
    const rows = await db
      .select()
      .from(activityEvents)
      .where(and(...conditions))
      .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
      .limit(cursor.limit + 1);

    return {
      items: rows.slice(0, cursor.limit).map((row) => ({
        ...row,
        payload: row.payload as Record<string, unknown>,
      })),
      hasMore: rows.length > cursor.limit,
      nextCursor: null,
    };
  }

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

    async listForAggregate(workspaceId, aggregateType, aggregateId, cursor) {
      return page(
        and(
          eq(activityEvents.workspaceId, workspaceId),
          eq(activityEvents.aggregateType, aggregateType),
          eq(activityEvents.aggregateId, aggregateId),
        ),
        cursor,
      );
    },

    async listForProject(workspaceId, projectId, cursor) {
      // Trashed tasks keep their project, so their history stays part of the project's.
      const projectTaskIds = db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.projectId, projectId)));

      return page(
        and(
          eq(activityEvents.workspaceId, workspaceId),
          or(
            and(
              eq(activityEvents.aggregateType, "project"),
              eq(activityEvents.aggregateId, projectId),
            ),
            and(
              eq(activityEvents.aggregateType, "task"),
              inArray(activityEvents.aggregateId, projectTaskIds),
            ),
          ),
        ),
        cursor,
      );
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
