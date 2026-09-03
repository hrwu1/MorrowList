import type { ProjectDto, WorkflowStatusDto } from "@morrowlist/contracts";
import { isTerminal, type WorkflowStatus } from "@morrowlist/domain";

import type { Project } from "../ports/index.js";

export function toProjectDto(project: Project): ProjectDto {
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    slug: project.slug,
    descriptionMd: project.descriptionMd,
    colorToken: project.colorToken,
    icon: project.icon,
    archivedAt: project.archivedAt?.toISOString() ?? null,
    version: project.version,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export function toWorkflowStatusDto(status: WorkflowStatus): WorkflowStatusDto {
  return {
    id: status.id,
    projectId: status.projectId,
    name: status.name,
    category: status.category,
    rank: status.rank,
    colorToken: status.colorToken,
    wipLimit: status.wipLimit,
    isDefault: status.isDefault,
    isTerminal: isTerminal(status),
    policyMd: status.policyMd,
    archivedAt: status.archivedAt?.toISOString() ?? null,
    version: status.version,
  };
}
