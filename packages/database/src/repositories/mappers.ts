import type { Project, Workspace } from "@morrowlist/application";
import type { ActorKind, Task, WorkflowStatus } from "@morrowlist/domain";

import type {
  projects,
  tasks,
  workflowStatuses,
  workspaces,
} from "../schema/index.js";

/**
 * Row-to-entity mapping. Kept in one place so a column rename cannot silently change the
 * shape the application layer sees.
 */

type TaskRow = typeof tasks.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type StatusRow = typeof workflowStatuses.$inferSelect;
type WorkspaceRow = typeof workspaces.$inferSelect;

export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    taskNumber: Number(row.taskNumber),
    projectId: row.projectId,
    statusId: row.statusId,
    title: row.title,
    descriptionMd: row.descriptionMd,
    priority: row.priority,
    dueDate: row.dueDate as Task["dueDate"],
    // PostgreSQL returns `time` as HH:mm:ss; the domain models a wall-clock HH:mm.
    dueTime: (row.dueTime ? row.dueTime.slice(0, 5) : null) as Task["dueTime"],
    dueTimezone: row.dueTimezone,
    parentTaskId: row.parentTaskId,
    rank: row.rank,
    lastActiveStatusId: row.lastActiveStatusId,
    completedAt: row.completedAt,
    version: row.version,
    createdBy: { kind: row.createdByActorKind as ActorKind, id: row.createdByActorId },
    lastActor: { kind: row.lastActorKind as ActorKind, id: row.lastActorId },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    deletedBy:
      row.deletedByActorKind && row.deletedByActorId
        ? { kind: row.deletedByActorKind as ActorKind, id: row.deletedByActorId }
        : null,
  };
}

export function toTaskRow(task: Task): TaskRow {
  return {
    id: task.id,
    workspaceId: task.workspaceId,
    taskNumber: task.taskNumber,
    projectId: task.projectId,
    statusId: task.statusId,
    title: task.title,
    descriptionMd: task.descriptionMd,
    priority: task.priority,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    dueTimezone: task.dueTimezone,
    parentTaskId: task.parentTaskId,
    rank: task.rank,
    lastActiveStatusId: task.lastActiveStatusId,
    completedAt: task.completedAt,
    version: task.version,
    createdByActorKind: task.createdBy.kind,
    createdByActorId: task.createdBy.id,
    lastActorKind: task.lastActor.kind,
    lastActorId: task.lastActor.id,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    deletedAt: task.deletedAt,
    deletedByActorKind: task.deletedBy?.kind ?? null,
    deletedByActorId: task.deletedBy?.id ?? null,
  };
}

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    slug: row.slug,
    descriptionMd: row.descriptionMd,
    colorToken: row.colorToken,
    icon: row.icon,
    archivedAt: row.archivedAt,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toWorkflowStatus(row: StatusRow): WorkflowStatus {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    category: row.category,
    rank: row.rank,
    colorToken: row.colorToken,
    wipLimit: row.wipLimit,
    isDefault: row.isDefault,
    archivedAt: row.archivedAt,
    version: row.version,
  };
}

export function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    taskKeyPrefix: row.taskKeyPrefix,
    timezone: row.timezone,
    createdByUserId: row.createdByUserId,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
