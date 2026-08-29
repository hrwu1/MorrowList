import { WORKSPACE_EVENTS } from "@morrowlist/contracts";
import { systemClock, uuidv7, type Clock } from "@morrowlist/domain";

import type { UnitOfWork, Workspace } from "../ports/index.js";
import type { ActorContext } from "../shared/actor-context.js";
import { recordEvent } from "../shared/event-recorder.js";

/**
 * Transactional user bootstrap (AUTH-003): a newly verified user receives exactly one
 * personal workspace, an owner membership, and a task counter. The whole thing runs in
 * one transaction and is idempotent, so a retried auth callback creates no duplicates.
 */

export interface BootstrapUserInput {
  readonly userId: string;
  readonly email: string;
  readonly displayName?: string | null;
  /** IANA timezone confirmed during onboarding (spec 13.1). */
  readonly timezone: string;
  readonly workspaceName?: string;
  readonly taskKeyPrefix?: string;
}

export interface BootstrapUserResult {
  readonly workspace: Workspace;
  /** False when the workspace already existed, i.e. the callback was retried. */
  readonly created: boolean;
}

export interface BootstrapOptions {
  readonly unitOfWork: UnitOfWork;
  readonly clock?: Clock;
}

export async function bootstrapUser(
  options: BootstrapOptions,
  input: BootstrapUserInput,
): Promise<BootstrapUserResult> {
  const clock = options.clock ?? systemClock;

  return options.unitOfWork.execute(async (tx) => {
    const existing = await tx.workspaces.listForUser(input.userId);
    const owned = existing.find((workspace) => workspace.role === "owner");
    if (owned) {
      return { workspace: owned, created: false };
    }

    const now = clock.now();
    const name = input.workspaceName ?? defaultWorkspaceName(input);
    const workspace: Workspace = {
      id: uuidv7(),
      name,
      slug: await uniqueSlug(tx, slugify(name)),
      taskKeyPrefix: input.taskKeyPrefix ?? defaultPrefix(name),
      timezone: input.timezone,
      createdByUserId: input.userId,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    await tx.workspaces.insert(workspace);
    await tx.workspaces.addMember({
      workspaceId: workspace.id,
      userId: input.userId,
      role: "owner",
      joinedAt: now,
    });
    // Allocating once here materialises the counter row so the first task creation does
    // not race two concurrent inserts for the same workspace.
    await tx.taskCounters.allocate(workspace.id);

    const context: ActorContext = {
      actorKind: "user",
      actorId: input.userId,
      userId: input.userId,
      workspaceIds: [workspace.id],
      scopes: new Set(),
      requestId: `bootstrap_${workspace.id}`,
    };
    await recordEvent(tx, context, clock, {
      workspaceId: workspace.id,
      aggregateType: "workspace",
      aggregateId: workspace.id,
      eventType: WORKSPACE_EVENTS.created,
      summary: "Created personal workspace",
      payload: { workspaceId: workspace.id, createdByUserId: input.userId },
    });

    return { workspace, created: true };
  });
}

function defaultWorkspaceName(input: BootstrapUserInput): string {
  const label = input.displayName?.trim() || input.email.split("@")[0] || "Personal";
  return `${label}'s Workspace`;
}

/** Task key prefix: up to four uppercase letters derived from the workspace name. */
export function defaultPrefix(name: string): string {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, "");
  return letters.slice(0, 4) || "ML";
}

export function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "workspace"
  );
}

async function uniqueSlug(
  tx: { workspaces: { findBySlug(slug: string): Promise<Workspace | null> } },
  base: string,
): Promise<string> {
  if (!(await tx.workspaces.findBySlug(base))) return base;
  for (let suffix = 2; suffix < 100; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!(await tx.workspaces.findBySlug(candidate))) return candidate;
  }
  return `${base}-${uuidv7().slice(0, 8)}`;
}
