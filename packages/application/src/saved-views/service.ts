import type {
  CreateSavedViewRequest,
  ReorderSavedViewRequest,
  SavedViewDto,
  SavedViewListResponse,
  UpdateSavedViewRequest,
} from "@morrowlist/contracts";
import { SAVED_VIEW_EVENTS } from "@morrowlist/contracts";
import {
  DomainError,
  ValidationError,
  rankBetween,
  systemClock,
  uuidv7,
  type Clock,
} from "@morrowlist/domain";

import type { SavedView, TransactionContext, UnitOfWork } from "../ports/index.js";
import {
  SCOPES,
  assertScope,
  assertWorkspaceAccess,
  type ActorContext,
} from "../shared/actor-context.js";
import { recordEvent } from "../shared/event-recorder.js";

import { toSavedViewDto } from "./mappers.js";

export interface SavedViewServiceOptions {
  readonly unitOfWork: UnitOfWork;
  readonly clock?: Clock;
}

/**
 * Personal saved views (spec 9.8, GAP-02). A view belongs to the session user: another
 * member of the same workspace cannot read, change, or even confirm it exists, and a
 * credential with no user behind it cannot own one. Names are unique per owner
 * case-insensitively. Every mutation records an activity row and an outbox event in
 * the same transaction.
 */
export class SavedViewService {
  private readonly unitOfWork: UnitOfWork;
  private readonly clock: Clock;

  constructor(options: SavedViewServiceOptions) {
    this.unitOfWork = options.unitOfWork;
    this.clock = options.clock ?? systemClock;
  }

  async list(
    context: ActorContext,
    workspaceId: string,
  ): Promise<SavedViewListResponse> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.viewsRead);
    const owner = requireOwner(context);

    return this.unitOfWork.execute(async (tx) => {
      await this.requireWorkspace(tx, workspaceId);
      const views = await tx.savedViews.listForOwner(workspaceId, owner);
      return { data: views.map(toSavedViewDto) };
    });
  }

  async create(
    context: ActorContext,
    workspaceId: string,
    request: CreateSavedViewRequest,
  ): Promise<SavedViewDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.viewsWrite);
    const owner = requireOwner(context);

    return this.unitOfWork.execute(async (tx) => {
      await this.requireWorkspace(tx, workspaceId);
      const name = normalizeName(request.name);
      const siblings = await tx.savedViews.listForOwner(workspaceId, owner);
      assertNameFree(siblings, name, null);

      const now = this.clock.now();
      const view: SavedView = {
        id: uuidv7(),
        workspaceId,
        ownerUserId: owner,
        name,
        filters: request.filters,
        layout: request.layout,
        // New views go to the end of the sidebar so saving never reorders existing ones.
        rank: rankBetween(siblings.at(-1)?.rank ?? null, null),
        createdAt: now,
        updatedAt: now,
      };

      await tx.savedViews.insert(view);
      await recordEvent(tx, context, this.clock, {
        workspaceId,
        aggregateType: "saved_view",
        aggregateId: view.id,
        eventType: SAVED_VIEW_EVENTS.created,
        summary: `Saved view ${view.name}`,
        payload: {
          viewId: view.id,
          name: view.name,
          layout: view.layout,
          filters: view.filters,
        },
      });
      return toSavedViewDto(view);
    });
  }

  async update(
    context: ActorContext,
    workspaceId: string,
    viewId: string,
    request: UpdateSavedViewRequest,
  ): Promise<SavedViewDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.viewsWrite);
    const owner = requireOwner(context);

    return this.unitOfWork.execute(async (tx) => {
      await this.requireWorkspace(tx, workspaceId);
      const previous = await this.requireOwned(tx, workspaceId, owner, viewId);

      const name =
        request.name === undefined ? previous.name : normalizeName(request.name);
      if (
        name.toLocaleLowerCase("en-US") !== previous.name.toLocaleLowerCase("en-US")
      ) {
        const siblings = await tx.savedViews.listForOwner(workspaceId, owner);
        assertNameFree(siblings, name, previous.id);
      }

      const next: SavedView = {
        ...previous,
        name,
        filters: request.filters ?? previous.filters,
        layout: request.layout ?? previous.layout,
      };
      const changes = viewChanges(next, previous);
      if (Object.keys(changes).length === 0) return toSavedViewDto(previous);

      const updated: SavedView = { ...next, updatedAt: this.clock.now() };
      await tx.savedViews.update(updated);
      await recordEvent(tx, context, this.clock, {
        workspaceId,
        aggregateType: "saved_view",
        aggregateId: viewId,
        eventType: SAVED_VIEW_EVENTS.updated,
        summary: `Updated view ${updated.name}`,
        payload: {
          viewId,
          name: updated.name,
          layout: updated.layout,
          filters: updated.filters,
          changes,
        },
      });
      return toSavedViewDto(updated);
    });
  }

  /** Place a view between two of the owner's views in the sidebar (spec 24.2). */
  async reorder(
    context: ActorContext,
    workspaceId: string,
    viewId: string,
    request: ReorderSavedViewRequest,
  ): Promise<SavedViewDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.viewsWrite);
    const owner = requireOwner(context);

    return this.unitOfWork.execute(async (tx) => {
      await this.requireWorkspace(tx, workspaceId);
      const view = await this.requireOwned(tx, workspaceId, owner, viewId);
      const siblings = await tx.savedViews.listForOwner(workspaceId, owner);
      const neighbour = (id: string | null | undefined, field: string) => {
        if (!id) return null;
        const found = siblings.find((candidate) => candidate.id === id);
        if (!found || found.id === viewId) {
          throw new ValidationError("The neighbouring view is not one of yours.", {
            field,
            viewId: id,
          });
        }
        return found;
      };
      const before = neighbour(request.beforeViewId, "beforeViewId");
      const after = neighbour(request.afterViewId, "afterViewId");

      const rank = rankBetween(before?.rank ?? null, after?.rank ?? null);
      const updated: SavedView = { ...view, rank, updatedAt: this.clock.now() };
      await tx.savedViews.update(updated);
      await recordEvent(tx, context, this.clock, {
        workspaceId,
        aggregateType: "saved_view",
        aggregateId: viewId,
        eventType: SAVED_VIEW_EVENTS.updated,
        summary: `Reordered view ${updated.name}`,
        payload: {
          viewId,
          name: updated.name,
          layout: updated.layout,
          filters: updated.filters,
          changes: { rank: { from: view.rank, to: rank } },
        },
      });
      return toSavedViewDto(updated);
    });
  }

  async delete(
    context: ActorContext,
    workspaceId: string,
    viewId: string,
  ): Promise<void> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.viewsWrite);
    const owner = requireOwner(context);

    return this.unitOfWork.execute(async (tx) => {
      await this.requireWorkspace(tx, workspaceId);
      const view = await this.requireOwned(tx, workspaceId, owner, viewId);

      await tx.savedViews.delete(workspaceId, viewId);
      await recordEvent(tx, context, this.clock, {
        workspaceId,
        aggregateType: "saved_view",
        aggregateId: viewId,
        eventType: SAVED_VIEW_EVENTS.deleted,
        summary: `Deleted view ${view.name}`,
        payload: {
          viewId,
          name: view.name,
          layout: view.layout,
          filters: view.filters,
        },
      });
    });
  }

  /**
   * Owner isolation: a view that exists but belongs to someone else is reported as
   * missing, so the response never confirms another user's view (spec 22.5).
   */
  private async requireOwned(
    tx: TransactionContext,
    workspaceId: string,
    owner: string,
    viewId: string,
  ): Promise<SavedView> {
    const view = await tx.savedViews.findById(workspaceId, viewId);
    if (!view || view.ownerUserId !== owner) {
      throw new DomainError("SAVED_VIEW_NOT_FOUND", "Saved view not found.", {
        viewId,
      });
    }
    return view;
  }

  private async requireWorkspace(tx: TransactionContext, workspaceId: string) {
    const workspace = await tx.workspaces.findById(workspaceId);
    if (!workspace) {
      throw new DomainError("WORKSPACE_NOT_FOUND", "Workspace not found.", {
        workspaceId,
      });
    }
    return workspace;
  }
}

/** Views are personal: only an actor with a user behind it can own one. */
function requireOwner(context: ActorContext): string {
  if (!context.userId) {
    throw new DomainError(
      "AUTH_FORBIDDEN",
      "Saved views belong to a signed-in user; this credential has none.",
    );
  }
  return context.userId;
}

function normalizeName(raw: string): string {
  const name = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  if (name.length === 0) {
    throw new ValidationError("View name is required.", { field: "name" });
  }
  return name;
}

function assertNameFree(
  siblings: readonly SavedView[],
  name: string,
  exceptViewId: string | null,
): void {
  const key = name.toLocaleLowerCase("en-US");
  const existing = siblings.find(
    (view) => view.id !== exceptViewId && view.name.toLocaleLowerCase("en-US") === key,
  );
  if (existing) {
    throw new DomainError(
      "SAVED_VIEW_NAME_CONFLICT",
      `You already have a view named "${existing.name}"; names are case-insensitive.`,
      { field: "name", viewId: existing.id, name: existing.name },
    );
  }
}

function viewChanges(
  next: SavedView,
  previous: SavedView,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (next.name !== previous.name) {
    changes.name = { from: previous.name, to: next.name };
  }
  if (next.layout !== previous.layout) {
    changes.layout = { from: previous.layout, to: next.layout };
  }
  if (JSON.stringify(next.filters) !== JSON.stringify(previous.filters)) {
    changes.filters = { from: previous.filters, to: next.filters };
  }
  return changes;
}
