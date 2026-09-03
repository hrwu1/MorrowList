import { DomainError, type WorkflowStatus } from "@morrowlist/domain";

import type { Project, TransactionContext, Workspace } from "../ports/index.js";

/**
 * Lookups shared by the project and workflow use cases. Every one resolves through the
 * workspace, so a credential for workspace A can never see or edit workspace B's
 * projects or columns (spec 22.5); the answer is "not found" either way.
 */

export async function requireWorkspace(
  tx: TransactionContext,
  workspaceId: string,
): Promise<Workspace> {
  const workspace = await tx.workspaces.findById(workspaceId);
  if (!workspace) {
    throw new DomainError("WORKSPACE_NOT_FOUND", "Workspace not found.", {
      workspaceId,
    });
  }
  return workspace;
}

export async function requireProject(
  tx: TransactionContext,
  workspaceId: string,
  projectId: string,
): Promise<Project> {
  const project = await tx.projects.findById(workspaceId, projectId);
  if (!project) {
    throw new DomainError("PROJECT_NOT_FOUND", "Project not found.", { projectId });
  }
  return project;
}

export async function requireActiveProject(
  tx: TransactionContext,
  workspaceId: string,
  projectId: string,
): Promise<Project> {
  const project = await requireProject(tx, workspaceId, projectId);
  if (project.archivedAt !== null) {
    throw new DomainError("PROJECT_NOT_FOUND", "Project not found.", { projectId });
  }
  return project;
}

export interface StatusLookup {
  readonly project: Project;
  readonly status: WorkflowStatus;
  /** Every status of the project, archived included, in rank order. */
  readonly statuses: readonly WorkflowStatus[];
}

/** A status is addressed by id alone, so its project decides which workspace it is in. */
export async function requireStatus(
  tx: TransactionContext,
  workspaceId: string,
  statusId: string,
): Promise<StatusLookup> {
  const status = await tx.statuses.findById(statusId);
  const project = status
    ? await tx.projects.findById(workspaceId, status.projectId)
    : null;
  if (!status || !project || project.archivedAt !== null) {
    throw new DomainError("STATUS_NOT_FOUND", "Status not found.", { statusId });
  }
  const statuses = await tx.statuses.listByProject(project.id, {
    includeArchived: true,
  });
  return { project, status, statuses };
}

/** Optimistic concurrency for projects and statuses (spec 24.2). */
export function assertVersion(
  entity: { readonly id: string; readonly version: number },
  expectedVersion: number | undefined,
  what: "project" | "status",
): void {
  if (expectedVersion === undefined || expectedVersion === entity.version) return;
  throw new DomainError(
    "VERSION_CONFLICT",
    `The ${what} changed after you loaded it.`,
    {
      [`${what}Id`]: entity.id,
      expectedVersion,
      actualVersion: entity.version,
    },
  );
}

export function versionConflict(
  entity: { readonly id: string; readonly version: number },
  what: "project" | "status",
): DomainError {
  return new DomainError(
    "VERSION_CONFLICT",
    `The ${what} changed after you loaded it.`,
    { [`${what}Id`]: entity.id, expectedVersion: entity.version },
  );
}
