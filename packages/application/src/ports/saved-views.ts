import type { SavedViewFilters, SavedViewLayout } from "@morrowlist/contracts";

/**
 * A personal saved view (spec 9.8, GAP-02): a named filter set owned by one user. It is
 * a projection over the canonical task model (ADR-001), never a container of tasks.
 */
export interface SavedView {
  readonly id: string;
  readonly workspaceId: string;
  readonly ownerUserId: string;
  readonly name: string;
  readonly filters: SavedViewFilters;
  readonly layout: SavedViewLayout;
  /** Sidebar order among the owner's views; same rank algorithm as tasks (spec 24.1). */
  readonly rank: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SavedViewRepository {
  findById(workspaceId: string, viewId: string): Promise<SavedView | null>;
  /** The owner's views in sidebar order: by rank, then id. */
  listForOwner(workspaceId: string, ownerUserId: string): Promise<readonly SavedView[]>;
  insert(view: SavedView): Promise<void>;
  update(view: SavedView): Promise<boolean>;
  delete(workspaceId: string, viewId: string): Promise<void>;
}
