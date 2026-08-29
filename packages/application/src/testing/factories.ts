import {
  DEFAULT_WORKFLOW,
  INITIAL_RANK,
  rankBetween,
  uuidv7,
  type WorkflowStatus,
} from "@morrowlist/domain";

import type { Project, Workspace, WorkspaceMembership } from "../ports/index.js";
import type { ActorContext } from "../shared/actor-context.js";

import type { InMemoryData } from "./in-memory.js";

/** Builders for consistent test data (spec 28.4). Every field has a usable default. */

export const TEST_TIMEZONE = "Europe/Berlin";

export function buildWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  const now = overrides.createdAt ?? new Date("2026-08-29T08:00:00.000Z");
  return {
    id: overrides.id ?? uuidv7(),
    name: overrides.name ?? "Test Workspace",
    slug: overrides.slug ?? "test-workspace",
    taskKeyPrefix: overrides.taskKeyPrefix ?? "ML",
    timezone: overrides.timezone ?? TEST_TIMEZONE,
    createdByUserId: overrides.createdByUserId ?? uuidv7(),
    version: overrides.version ?? 1,
    createdAt: now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

export function buildProject(
  workspaceId: string,
  overrides: Partial<Project> = {},
): Project {
  const now = overrides.createdAt ?? new Date("2026-08-29T08:00:00.000Z");
  return {
    id: overrides.id ?? uuidv7(),
    workspaceId,
    name: overrides.name ?? "Test Project",
    slug: overrides.slug ?? "test-project",
    descriptionMd: overrides.descriptionMd ?? null,
    colorToken: overrides.colorToken ?? "blue",
    icon: overrides.icon ?? null,
    archivedAt: overrides.archivedAt ?? null,
    version: overrides.version ?? 1,
    createdAt: now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

/** The six default statuses a new project receives (spec 11.2). */
export function buildDefaultWorkflow(projectId: string): WorkflowStatus[] {
  let rank: string | null = null;
  return DEFAULT_WORKFLOW.map((template) => {
    rank = rank === null ? INITIAL_RANK : rankBetween(rank, null);
    return {
      id: uuidv7(),
      projectId,
      name: template.name,
      category: template.category,
      rank,
      colorToken: template.colorToken,
      wipLimit: null,
      isDefault: template.isDefault,
      archivedAt: null,
      version: 1,
    } satisfies WorkflowStatus;
  });
}

export function buildActorContext(overrides: Partial<ActorContext> = {}): ActorContext {
  const userId = overrides.userId ?? overrides.actorId ?? uuidv7();
  return {
    actorKind: overrides.actorKind ?? "user",
    actorId: overrides.actorId ?? userId,
    userId,
    actorDisplayName: overrides.actorDisplayName ?? "Test User",
    workspaceIds: overrides.workspaceIds ?? [],
    scopes: overrides.scopes ?? new Set(),
    requestId: overrides.requestId ?? "req_test",
  };
}

export interface SeededWorkspace {
  readonly workspace: Workspace;
  readonly userId: string;
  readonly context: ActorContext;
  readonly project: Project;
  readonly statuses: WorkflowStatus[];
}

/** Seed a workspace, an owner membership, a project, and its default workflow. */
export function seedWorkspace(
  data: InMemoryData,
  overrides: { workspace?: Partial<Workspace>; userId?: string } = {},
): SeededWorkspace {
  const userId = overrides.userId ?? uuidv7();
  const workspace = buildWorkspace({
    createdByUserId: userId,
    ...overrides.workspace,
  });
  const project = buildProject(workspace.id);
  const statuses = buildDefaultWorkflow(project.id);

  data.workspaces.set(workspace.id, workspace);
  data.memberships.push({
    workspaceId: workspace.id,
    userId,
    role: "owner",
    joinedAt: workspace.createdAt,
  } satisfies WorkspaceMembership);
  data.counters.set(workspace.id, 1);
  data.projects.set(project.id, project);
  for (const status of statuses) data.statuses.set(status.id, status);

  return {
    workspace,
    userId,
    project,
    statuses,
    context: buildActorContext({ userId, workspaceIds: [workspace.id] }),
  };
}

export function statusByCategory(
  statuses: readonly WorkflowStatus[],
  category: WorkflowStatus["category"],
): WorkflowStatus {
  const status = statuses.find((candidate) => candidate.category === category);
  if (!status) throw new Error(`no ${category} status in the seeded workflow`);
  return status;
}
