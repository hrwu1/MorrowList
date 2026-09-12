import type { FieldDefinitionRepository } from "@morrowlist/application";
import { and, asc, eq, sql } from "drizzle-orm";

import type { Database } from "../client.js";
import { fieldDefinitions, tasks } from "../schema/index.js";

import { toFieldDefinition, toFieldDefinitionRow } from "./mappers.js";

/** Drizzle implementation of the typed custom-field port (GAP-24). */
export function createFieldDefinitionRepository(
  db: Database,
): FieldDefinitionRepository {
  return {
    async lock(workspaceId) {
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`fields:` + workspaceId}, 0))`,
      );
    },
    async findById(workspaceId, fieldId) {
      const [row] = await db
        .select()
        .from(fieldDefinitions)
        .where(
          and(
            eq(fieldDefinitions.workspaceId, workspaceId),
            eq(fieldDefinitions.id, fieldId),
          ),
        )
        .limit(1);
      return row ? toFieldDefinition(row) : null;
    },

    async findByKey(workspaceId, key) {
      const [row] = await db
        .select()
        .from(fieldDefinitions)
        .where(
          and(
            eq(fieldDefinitions.workspaceId, workspaceId),
            eq(fieldDefinitions.key, key),
          ),
        )
        .limit(1);
      return row ? toFieldDefinition(row) : null;
    },

    async listByWorkspace(workspaceId) {
      // rank is COLLATE "C" (migration 0013), so this order is by code point and matches
      // the in-memory double.
      const rows = await db
        .select()
        .from(fieldDefinitions)
        .where(eq(fieldDefinitions.workspaceId, workspaceId))
        .orderBy(asc(fieldDefinitions.rank), asc(fieldDefinitions.id));
      return rows.map(toFieldDefinition);
    },

    async valueCounts(workspaceId) {
      // One grouped scan over the keys present in the workspace's live tasks, rather
      // than one count per definition (spec 29.3).
      const result = await db.execute<{ field_key: string; total: string }>(sql`
        select field_key, count(*)::text as total
        from ${tasks}, lateral jsonb_object_keys(${tasks.fields}) as field_key
        where ${tasks.workspaceId} = ${workspaceId}::uuid
          and ${tasks.deletedAt} is null
        group by field_key
      `);
      return new Map(result.rows.map((row) => [row.field_key, Number(row.total)]));
    },

    async insert(definition) {
      await db.insert(fieldDefinitions).values(toFieldDefinitionRow(definition));
    },

    async update(definition) {
      const result = await db
        .update(fieldDefinitions)
        .set(toFieldDefinitionRow(definition))
        .where(
          and(
            eq(fieldDefinitions.id, definition.id),
            eq(fieldDefinitions.workspaceId, definition.workspaceId),
          ),
        )
        .returning({ id: fieldDefinitions.id });
      return result.length === 1;
    },

    async clearValues(workspaceId, key) {
      // Trashed tasks are included: a restored task must not come back carrying a value
      // whose definition is gone. `?` uses tasks_fields_idx, so only rows that hold the
      // key are rewritten.
      const result = await db
        .update(tasks)
        .set({ fields: sql`${tasks.fields} - ${key}::text` })
        .where(
          and(eq(tasks.workspaceId, workspaceId), sql`${tasks.fields} ? ${key}::text`),
        )
        .returning({ id: tasks.id });
      return result.length;
    },

    async delete(workspaceId, fieldId) {
      await db
        .delete(fieldDefinitions)
        .where(
          and(
            eq(fieldDefinitions.workspaceId, workspaceId),
            eq(fieldDefinitions.id, fieldId),
          ),
        );
    },
  };
}
