import type { WorkflowStatus } from "@morrowlist/domain";

export interface Project {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly slug: string;
  readonly descriptionMd: string | null;
  readonly colorToken: string;
  readonly icon: string | null;
  readonly archivedAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ProjectRepository {
  findById(workspaceId: string, projectId: string): Promise<Project | null>;
  listByWorkspace(
    workspaceId: string,
    options?: { includeArchived?: boolean },
  ): Promise<readonly Project[]>;
  insert(project: Project): Promise<void>;
  update(project: Project, previousVersion: number): Promise<boolean>;
}

export interface WorkflowStatusRepository {
  findById(statusId: string): Promise<WorkflowStatus | null>;
  listByProject(
    projectId: string,
    options?: { includeArchived?: boolean },
  ): Promise<readonly WorkflowStatus[]>;
  insertMany(statuses: readonly WorkflowStatus[]): Promise<void>;
  update(status: WorkflowStatus, previousVersion: number): Promise<boolean>;
}
