/**
 * Read-only lookup of a user's identity for delivery (GAP-13). Implemented by
 * `@morrowlist/auth`, which owns the provider tables (spec 18.3); no feature package
 * queries them directly.
 */
export interface UserDirectory {
  findById(
    userId: string,
  ): Promise<{ id: string; email: string; name: string | null } | null>;
}
