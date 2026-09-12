import type { NotificationPreferences, TransactionContext } from "../ports/index.js";

import { defaultPreferences } from "./mappers.js";

/** Reading preferences never creates a row; every caller receives the same defaults. */
export async function loadNotificationPreferences(
  tx: TransactionContext,
  userId: string,
  workspaceId: string,
  now: Date,
): Promise<NotificationPreferences> {
  return (
    (await tx.notificationPreferences.find(userId, workspaceId)) ??
    defaultPreferences(userId, workspaceId, now)
  );
}
