import type { CalDavObject, CalDavObjectRepository } from "@morrowlist/application";
import { and, eq } from "drizzle-orm";

import type { Database } from "../client.js";
import { caldavObjects as objects } from "../schema/caldav.js";

type Row = typeof objects.$inferSelect;

const toObject = (row: Row): CalDavObject => ({
  workspaceId: row.workspaceId,
  taskId: row.taskId,
  resource: row.resource as CalDavObject["resource"],
  path: row.path,
  uid: row.uid,
  properties: Array.isArray(row.properties) ? row.properties : [],
  updatedAt: row.updatedAt,
});

export function createCalDavObjectRepository(db: Database): CalDavObjectRepository {
  return {
    async findByPath(workspaceId, path) {
      const rows = await db
        .select()
        .from(objects)
        .where(and(eq(objects.workspaceId, workspaceId), eq(objects.path, path)))
        .limit(1);
      return rows[0] ? toObject(rows[0]) : null;
    },
    async findByUid(workspaceId, uid) {
      const rows = await db
        .select()
        .from(objects)
        .where(and(eq(objects.workspaceId, workspaceId), eq(objects.uid, uid)))
        .limit(1);
      return rows[0] ? toObject(rows[0]) : null;
    },
    async listByWorkspace(workspaceId) {
      const rows = await db
        .select()
        .from(objects)
        .where(eq(objects.workspaceId, workspaceId));
      return rows.map(toObject);
    },
    async listByTask(workspaceId, taskId) {
      const rows = await db
        .select()
        .from(objects)
        .where(and(eq(objects.workspaceId, workspaceId), eq(objects.taskId, taskId)));
      return rows.map(toObject);
    },
    async upsert(object) {
      await db
        .insert(objects)
        .values({ ...object, properties: [...object.properties] })
        .onConflictDoUpdate({
          target: [objects.workspaceId, objects.taskId, objects.resource],
          set: {
            path: object.path,
            uid: object.uid,
            properties: [...object.properties],
            updatedAt: object.updatedAt,
          },
        });
    },
    async delete(workspaceId, taskId, resource) {
      await db
        .delete(objects)
        .where(
          and(
            eq(objects.workspaceId, workspaceId),
            eq(objects.taskId, taskId),
            eq(objects.resource, resource),
          ),
        );
    },
  };
}
