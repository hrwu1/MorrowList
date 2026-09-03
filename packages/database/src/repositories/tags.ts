import type { TagRepository } from "@morrowlist/application";
import { and, asc, count, eq, isNull } from "drizzle-orm";

import type { Database } from "../client.js";
import { tags, taskTags, tasks } from "../schema/index.js";

import { toTag, toTagRow } from "./mappers.js";

/** Drizzle implementation of the tag port (TASK-008). */
export function createTagRepository(db: Database): TagRepository {
  return {
    async findById(workspaceId, tagId) {
      const [row] = await db
        .select()
        .from(tags)
        .where(and(eq(tags.workspaceId, workspaceId), eq(tags.id, tagId)))
        .limit(1);
      return row ? toTag(row) : null;
    },

    async findByNormalizedName(workspaceId, normalizedName) {
      const [row] = await db
        .select()
        .from(tags)
        .where(
          and(
            eq(tags.workspaceId, workspaceId),
            eq(tags.normalizedName, normalizedName),
          ),
        )
        .limit(1);
      return row ? toTag(row) : null;
    },

    async listByWorkspace(workspaceId) {
      // normalized_name is COLLATE "C" (migration 0003), so this order is by code point
      // and matches the in-memory double.
      const rows = await db
        .select()
        .from(tags)
        .where(eq(tags.workspaceId, workspaceId))
        .orderBy(asc(tags.normalizedName), asc(tags.id));
      return rows.map(toTag);
    },

    async taskCounts(workspaceId) {
      const rows = await db
        .select({ tagId: taskTags.tagId, total: count() })
        .from(taskTags)
        .innerJoin(tasks, eq(tasks.id, taskTags.taskId))
        .where(and(eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt)))
        .groupBy(taskTags.tagId);
      return new Map(rows.map((row) => [row.tagId, Number(row.total)]));
    },

    async insert(tag) {
      await db.insert(tags).values(toTagRow(tag));
    },

    async update(tag) {
      const result = await db
        .update(tags)
        .set(toTagRow(tag))
        .where(and(eq(tags.id, tag.id), eq(tags.workspaceId, tag.workspaceId)))
        .returning({ id: tags.id });
      return result.length === 1;
    },

    async delete(workspaceId, tagId) {
      // task_tags rows go with it through the cascading foreign key (migration 0003).
      await db
        .delete(tags)
        .where(and(eq(tags.workspaceId, workspaceId), eq(tags.id, tagId)));
    },
  };
}
