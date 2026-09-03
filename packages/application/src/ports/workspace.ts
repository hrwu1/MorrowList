export interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly taskKeyPrefix: string;
  readonly timezone: string;
  /** Workspace-wide "in progress" limit across projects; null means none (GAP-20). */
  readonly inProgressLimit: number | null;
  readonly createdByUserId: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export interface WorkspaceMembership {
  readonly workspaceId: string;
  readonly userId: string;
  readonly role: WorkspaceRole;
  readonly joinedAt: Date;
}

export interface WorkspaceRepository {
  findById(workspaceId: string): Promise<Workspace | null>;
  findBySlug(slug: string): Promise<Workspace | null>;
  listForUser(
    userId: string,
  ): Promise<readonly (Workspace & { role: WorkspaceRole })[]>;
  insert(workspace: Workspace): Promise<void>;
  update(workspace: Workspace, previousVersion: number): Promise<boolean>;
  addMember(membership: WorkspaceMembership): Promise<void>;
  findMembership(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMembership | null>;
}
