import type { FieldDefinition } from "@morrowlist/domain";

/**
 * Persistence port for a workspace's typed custom fields (GAP-24). Implemented by
 * `@morrowlist/database`.
 */
export interface FieldDefinitionRepository {
  /** Serialize definition creation within a workspace until the transaction ends. */
  lock(workspaceId: string): Promise<void>;
  findById(workspaceId: string, fieldId: string): Promise<FieldDefinition | null>;
  findByKey(workspaceId: string, key: string): Promise<FieldDefinition | null>;
  /** Every definition in the workspace, in rank order then id. */
  listByWorkspace(workspaceId: string): Promise<readonly FieldDefinition[]>;
  /** How many live tasks carry a value for each field, keyed by field key. */
  valueCounts(workspaceId: string): Promise<Map<string, number>>;
  insert(definition: FieldDefinition): Promise<void>;
  update(definition: FieldDefinition): Promise<boolean>;
  /**
   * Remove one key from every task in the workspace, in one statement, and answer how
   * many rows changed. Runs inside the caller's transaction alongside the delete, so a
   * definition and its values can never be half-gone (GAP-24).
   */
  clearValues(workspaceId: string, key: string): Promise<number>;
  delete(workspaceId: string, fieldId: string): Promise<void>;
}
