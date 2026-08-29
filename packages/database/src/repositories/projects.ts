import type {
  ProjectRepository,
  WorkflowStatusRepository,
} from "@morrowlist/application";
import type { WorkflowStatus } from "@morrowlist/domain";
import { and, asc, eq, isNull } from "drizzle-orm";

import type { Database } from "../client.js";
import { projects, workflowStatuses } from "../schema/index.js";

import { toProject, toWorkflowStatus } from "./mappers.js";

export function createProjectRepository(db: Database): ProjectRepository {
  return {
    async findById(workspaceId, projectId) {
      const [row] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId)))
        .limit(1);
      return row ? toProject(row) : null;
    },

    async listByWorkspace(workspaceId, options) {
      const conditions = [eq(projects.workspaceId, workspaceId)];
      if (!options?.includeArchived) conditions.push(isNull(projects.archivedAt));

      const rows = await db
        .select()
        .from(projects)
        .where(and(...conditions))
        .orderBy(asc(projects.name));
      return rows.map(toProject);
    },

    async insert(project) {
      await db.insert(projects).values({
        id: project.id,
        workspaceId: project.workspaceId,
        name: project.name,
        slug: project.slug,
        descriptionMd: project.descriptionMd,
        colorToken: project.colorToken,
        icon: project.icon,
        version: project.version,
        archivedAt: project.archivedAt,
        // Projects created during bootstrap and seeding are attributed to the system.
        createdByActorKind: "system",
        createdByActorId: "system",
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      });
    },

    async update(project, previousVersion) {
      const result = await db
        .update(projects)
        .set({
          name: project.name,
          slug: project.slug,
          descriptionMd: project.descriptionMd,
          colorToken: project.colorToken,
          icon: project.icon,
          archivedAt: project.archivedAt,
          version: project.version,
          updatedAt: project.updatedAt,
        })
        .where(
          and(eq(projects.id, project.id), eq(projects.version, previousVersion)),
        )
        .returning({ id: projects.id });
      return result.length === 1;
    },
  };
}

export function createWorkflowStatusRepository(
  db: Database,
): WorkflowStatusRepository {
  const toRow = (status: WorkflowStatus, now: Date) => ({
    id: status.id,
    projectId: status.projectId,
    name: status.name,
    category: status.category,
    rank: status.rank,
    colorToken: status.colorToken,
    wipLimit: status.wipLimit,
    isDefault: status.isDefault,
    version: status.version,
    archivedAt: status.archivedAt,
    createdAt: now,
    updatedAt: now,
  });

  return {
    async findById(statusId) {
      const [row] = await db
        .select()
        .from(workflowStatuses)
        .where(eq(workflowStatuses.id, statusId))
        .limit(1);
      return row ? toWorkflowStatus(row) : null;
    },

    async listByProject(projectId, options) {
      const conditions = [eq(workflowStatuses.projectId, projectId)];
      if (!options?.includeArchived) {
        conditions.push(isNull(workflowStatuses.archivedAt));
      }

      const rows = await db
        .select()
        .from(workflowStatuses)
        .where(and(...conditions))
        .orderBy(asc(workflowStatuses.rank));
      return rows.map(toWorkflowStatus);
    },

    async insertMany(statuses) {
      if (statuses.length === 0) return;
      const now = new Date();
      await db.insert(workflowStatuses).values(statuses.map((s) => toRow(s, now)));
    },

    async update(status, previousVersion) {
      const result = await db
        .update(workflowStatuses)
        .set({
          name: status.name,
          category: status.category,
          rank: status.rank,
          colorToken: status.colorToken,
          wipLimit: status.wipLimit,
          isDefault: status.isDefault,
          version: status.version,
          archivedAt: status.archivedAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workflowStatuses.id, status.id),
            eq(workflowStatuses.version, previousVersion),
          ),
        )
        .returning({ id: workflowStatuses.id });
      return result.length === 1;
    },
  };
}
