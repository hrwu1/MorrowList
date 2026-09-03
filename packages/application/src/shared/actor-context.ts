import { DomainError, type ActorKind, type ActorRef } from "@morrowlist/domain";

/**
 * Ambient context for one command or query (spec 17.4). Built by the transport from an
 * authenticated session or API key; the application layer never reads HTTP itself.
 */
export interface ActorContext {
  readonly actorKind: ActorKind;
  readonly actorId: string;
  readonly userId?: string;
  readonly actorDisplayName?: string;
  readonly workspaceIds: readonly string[];
  readonly scopes: ReadonlySet<string>;
  readonly requestId: string;
}

export function actorRef(context: ActorContext): ActorRef {
  return { kind: context.actorKind, id: context.actorId };
}

/**
 * Tenant isolation (spec 22.5). Every command and query resolves its workspace through
 * this guard, so a credential scoped to workspace A cannot read or write workspace B.
 */
export function assertWorkspaceAccess(
  context: ActorContext,
  workspaceId: string,
): void {
  if (!context.workspaceIds.includes(workspaceId)) {
    // Reported as not-found rather than forbidden so the response does not confirm that
    // an unreachable workspace exists (spec 22.5, M1 acceptance scenario).
    throw new DomainError("WORKSPACE_NOT_FOUND", "Workspace not found.", {
      workspaceId,
    });
  }
}

export function assertScope(context: ActorContext, scope: string): void {
  // A session-authenticated user holds every scope their membership allows; API keys are
  // restricted to the scopes granted at creation time (spec 22.4).
  if (context.actorKind === "user") return;
  if (!context.scopes.has(scope)) {
    throw new DomainError(
      "AUTH_FORBIDDEN",
      "This credential lacks the required scope.",
      {
        requiredScope: scope,
      },
    );
  }
}

export const SCOPES = {
  tasksRead: "tasks:read",
  tasksWrite: "tasks:write",
  projectsRead: "projects:read",
  projectsWrite: "projects:write",
  activityRead: "activity:read",
  tagsRead: "tags:read",
  tagsWrite: "tags:write",
  workspaceWrite: "workspace:write",
} as const;
