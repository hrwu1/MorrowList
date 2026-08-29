import type { WorkspaceRepository } from "@morrowlist/application";
import { and, eq } from "drizzle-orm";

import type { Database } from "../client.js";
import { workspaceMembers, workspaces } from "../schema/index.js";

import { toWorkspace } from "./mappers.js";

export function createWorkspaceRepository(db: Database): WorkspaceRepository {
  return {
    async findById(workspaceId) {
      const [row] = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);
      return row ? toWorkspace(row) : null;
    },

    async findBySlug(slug) {
      const [row] = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.slug, slug))
        .limit(1);
      return row ? toWorkspace(row) : null;
    },

    async listForUser(userId) {
      const rows = await db
        .select({ workspace: workspaces, role: workspaceMembers.role })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
        .where(eq(workspaceMembers.userId, userId));
      return rows.map((row) => ({ ...toWorkspace(row.workspace), role: row.role }));
    },

    async insert(workspace) {
      await db.insert(workspaces).values({
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        taskKeyPrefix: workspace.taskKeyPrefix,
        timezone: workspace.timezone,
        createdByUserId: workspace.createdByUserId,
        version: workspace.version,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      });
    },

    async update(workspace, previousVersion) {
      const result = await db
        .update(workspaces)
        .set({
          name: workspace.name,
          slug: workspace.slug,
          taskKeyPrefix: workspace.taskKeyPrefix,
          timezone: workspace.timezone,
          version: workspace.version,
          updatedAt: workspace.updatedAt,
        })
        .where(
          and(eq(workspaces.id, workspace.id), eq(workspaces.version, previousVersion)),
        )
        .returning({ id: workspaces.id });
      return result.length === 1;
    },

    async addMember(membership) {
      // Idempotent: a retried bootstrap must not fail on the existing owner row.
      await db
        .insert(workspaceMembers)
        .values({
          workspaceId: membership.workspaceId,
          userId: membership.userId,
          role: membership.role,
          joinedAt: membership.joinedAt,
        })
        .onConflictDoNothing();
    },

    async findMembership(workspaceId, userId) {
      const [row] = await db
        .select()
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, userId),
          ),
        )
        .limit(1);
      return row ?? null;
    },
  };
}
