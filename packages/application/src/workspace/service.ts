import type {
  MeResponse,
  UpdateWorkspaceRequest,
  WorkspaceDto,
} from "@morrowlist/contracts";
import { WORKSPACE_EVENTS } from "@morrowlist/contracts";
import {
  DomainError,
  normalizeInProgressLimit,
  systemClock,
  toTimezone,
  type Clock,
} from "@morrowlist/domain";

import type { TransactionContext, UnitOfWork, Workspace } from "../ports/index.js";
import {
  SCOPES,
  assertScope,
  assertWorkspaceAccess,
  type ActorContext,
} from "../shared/actor-context.js";
import { recordEvent } from "../shared/event-recorder.js";
import { assertVersion, versionConflict } from "../shared/version.js";

export interface WorkspaceServiceOptions {
  readonly unitOfWork: UnitOfWork;
  readonly clock?: Clock;
}

export type WorkspaceSummaryDto = MeResponse["data"]["workspaces"][number];

/**
 * Workspace settings (spec 20.3 `PATCH /workspaces/{id}`, GAP-20). The cross-project
 * "in progress" limit lives here because it belongs to the person, not to any one
 * board; `listForUser` reports the current count beside it so a shell can show
 * "3 of 3 in progress" without a second request.
 */
export class WorkspaceService {
  private readonly unitOfWork: UnitOfWork;
  private readonly clock: Clock;

  constructor(options: WorkspaceServiceOptions) {
    this.unitOfWork = options.unitOfWork;
    this.clock = options.clock ?? systemClock;
  }

  /** The caller's workspaces with their role and how much work is currently started. */
  async listForUser(context: ActorContext): Promise<WorkspaceSummaryDto[]> {
    const userId = context.userId;
    if (!userId) {
      throw new DomainError("AUTH_FORBIDDEN", "This credential is not tied to a user.");
    }

    return this.unitOfWork.execute(async (tx) => {
      const workspaces = await tx.workspaces.listForUser(userId);
      const summaries: WorkspaceSummaryDto[] = [];
      for (const workspace of workspaces) {
        const inProgress = await tx.tasks.listInProgress(workspace.id);
        summaries.push({
          ...toWorkspaceDto(workspace),
          role: workspace.role,
          inProgressCount: inProgress.length,
        });
      }
      return summaries;
    });
  }

  /** Edit name, key prefix, timezone, or the in-progress limit; the slug stays put. */
  async update(
    context: ActorContext,
    workspaceId: string,
    request: UpdateWorkspaceRequest,
  ): Promise<WorkspaceDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.workspaceWrite);

    return this.unitOfWork.execute(async (tx) => {
      const previous = await tx.workspaces.findById(workspaceId);
      if (!previous) {
        throw new DomainError("WORKSPACE_NOT_FOUND", "Workspace not found.", {
          workspaceId,
        });
      }
      await assertMayEdit(tx, context, workspaceId);
      assertVersion(previous, request.expectedVersion, "workspace");

      const next: Workspace = {
        ...previous,
        name: request.name === undefined ? previous.name : request.name.trim(),
        taskKeyPrefix:
          request.taskKeyPrefix === undefined
            ? previous.taskKeyPrefix
            : request.taskKeyPrefix.trim(),
        timezone:
          request.timezone === undefined
            ? previous.timezone
            : toTimezone(request.timezone),
        inProgressLimit:
          request.inProgressLimit === undefined
            ? previous.inProgressLimit
            : normalizeInProgressLimit(request.inProgressLimit),
        version: previous.version + 1,
        updatedAt: this.clock.now(),
      };
      const changes = workspaceChanges(next, previous);
      if (Object.keys(changes).length === 0) {
        // Nothing material changed: no version bump, no event.
        return toWorkspaceDto(previous);
      }

      const persisted = await tx.workspaces.update(next, previous.version);
      if (!persisted) throw versionConflict(previous, "workspace");

      await recordEvent(tx, context, this.clock, {
        workspaceId,
        aggregateType: "workspace",
        aggregateId: workspaceId,
        eventType: WORKSPACE_EVENTS.updated,
        summary: `Updated workspace ${next.name}`,
        payload: { workspaceId, changes },
      });
      return toWorkspaceDto(next);
    });
  }
}

/** Team roles are hidden for now (ADR-010), but a member or viewer still may not edit. */
async function assertMayEdit(
  tx: TransactionContext,
  context: ActorContext,
  workspaceId: string,
): Promise<void> {
  if (!context.userId) return;
  const membership = await tx.workspaces.findMembership(workspaceId, context.userId);
  if (membership && membership.role !== "owner" && membership.role !== "admin") {
    throw new DomainError(
      "AUTH_FORBIDDEN",
      "Only a workspace owner or admin can change its settings.",
      { workspaceId, role: membership.role },
    );
  }
}

export function toWorkspaceDto(workspace: Workspace): WorkspaceDto {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    taskKeyPrefix: workspace.taskKeyPrefix,
    timezone: workspace.timezone,
    inProgressLimit: workspace.inProgressLimit,
    version: workspace.version,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
  };
}

const WORKSPACE_FIELDS = [
  "name",
  "taskKeyPrefix",
  "timezone",
  "inProgressLimit",
] as const satisfies readonly (keyof Workspace)[];

function workspaceChanges(
  next: Workspace,
  previous: Workspace,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of WORKSPACE_FIELDS) {
    if (next[field] !== previous[field]) {
      changes[field] = { from: previous[field], to: next[field] };
    }
  }
  return changes;
}
