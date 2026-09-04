import type { UserDirectory } from "@morrowlist/application";
import type { Database } from "@morrowlist/database";
import { eq } from "drizzle-orm";

import { authUsers } from "./schema.js";

/**
 * The `UserDirectory` port over the provider's user table (GAP-13). Delivery needs an
 * email address for a MorrowList user id; this is the one place outside Better Auth that
 * reads the table, so the provider boundary of spec 18.3 stays intact.
 */
export function createUserDirectory(db: Database): UserDirectory {
  return {
    async findById(userId) {
      const [row] = await db
        .select({ id: authUsers.id, email: authUsers.email, name: authUsers.name })
        .from(authUsers)
        .where(eq(authUsers.id, userId))
        .limit(1);
      return row ? { id: row.id, email: row.email, name: row.name || null } : null;
    },
  };
}
