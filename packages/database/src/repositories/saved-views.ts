import type { SavedViewRepository } from "@morrowlist/application";
import { and, asc, eq } from "drizzle-orm";

import type { Database } from "../client.js";
import { savedViews } from "../schema/index.js";

import { toSavedView, toSavedViewRow } from "./mappers.js";

/** Drizzle implementation of the saved-view port (GAP-02). */
export function createSavedViewRepository(db: Database): SavedViewRepository {
  return {
    async findById(workspaceId, viewId) {
      const [row] = await db
        .select()
        .from(savedViews)
        .where(and(eq(savedViews.workspaceId, workspaceId), eq(savedViews.id, viewId)))
        .limit(1);
      return row ? toSavedView(row) : null;
    },

    async listForOwner(workspaceId, ownerUserId) {
      // rank is COLLATE "C" (migration 0004), so this order is by code point and
      // matches the in-memory double.
      const rows = await db
        .select()
        .from(savedViews)
        .where(
          and(
            eq(savedViews.workspaceId, workspaceId),
            eq(savedViews.ownerUserId, ownerUserId),
          ),
        )
        .orderBy(asc(savedViews.rank), asc(savedViews.id));
      return rows.map(toSavedView);
    },

    async insert(view) {
      await db.insert(savedViews).values(toSavedViewRow(view));
    },

    async update(view) {
      const result = await db
        .update(savedViews)
        .set(toSavedViewRow(view))
        .where(
          and(eq(savedViews.id, view.id), eq(savedViews.workspaceId, view.workspaceId)),
        )
        .returning({ id: savedViews.id });
      return result.length === 1;
    },

    async delete(workspaceId, viewId) {
      await db
        .delete(savedViews)
        .where(and(eq(savedViews.workspaceId, workspaceId), eq(savedViews.id, viewId)));
    },
  };
}
