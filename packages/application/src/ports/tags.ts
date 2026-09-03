import type { Tag } from "@morrowlist/domain";

/** Persistence port for workspace tags (spec 12.1). Implemented by `@morrowlist/database`. */
export interface TagRepository {
  findById(workspaceId: string, tagId: string): Promise<Tag | null>;
  /** Case-insensitive lookup by the `tagLookupKey` of a name. */
  findByNormalizedName(
    workspaceId: string,
    normalizedName: string,
  ): Promise<Tag | null>;
  /** Every tag in the workspace, ordered by normalized name then id. */
  listByWorkspace(workspaceId: string): Promise<readonly Tag[]>;
  /** How many live (not deleted) tasks carry each tag, keyed by tag id. */
  taskCounts(workspaceId: string): Promise<Map<string, number>>;
  insert(tag: Tag): Promise<void>;
  update(tag: Tag): Promise<boolean>;
  /** Removes the tag and its task associations; tasks are never touched (spec 12.1). */
  delete(workspaceId: string, tagId: string): Promise<void>;
}
