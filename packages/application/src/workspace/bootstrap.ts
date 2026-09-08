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
      inProgressLimit: null,
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
    // Materialise the counter without consuming a number: the workspace's first task
    // must be number 1, not 2.
    await tx.taskCounters.ensure(workspace.id);

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

/** Task key prefix: the workspace name's letters, as written, up to the 24 allowed. */
export function defaultPrefix(name: string): string {
  // A default name is "<label>'s Workspace" (see `defaultWorkspaceName`), and repeating
  // that suffix in every key reads badly, so only the label becomes the prefix. The
  // apostrophe is required: a name that merely ends in "s Workspace" keeps all of it.
  const label = name.replace(/['’]s\s+Workspace$/i, "");
  // The prefix is displayed as written, so keep the name's own casing rather than
  // shouting an abbreviation of it. Non-letters go because the key separator is `-`.
  const letters = label.replace(/[^A-Za-z]/g, "");
  return letters.slice(0, 24) || "ML";
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
