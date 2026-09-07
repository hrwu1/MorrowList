import type { InboundAddressRepository } from "@morrowlist/application";
import { and, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "../client.js";
import { inboundAddresses, inboundReceipts } from "../schema/index.js";

export function createInboundAddressRepository(db: Database): InboundAddressRepository {
  return {
    async lock(workspaceId) {
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`inbound:` + workspaceId}, 0))`,
      );
    },
    async findCurrent(workspaceId, userId) {
      const [row] = await db
        .select()
        .from(inboundAddresses)
        .where(
          and(
            eq(inboundAddresses.workspaceId, workspaceId),
            eq(inboundAddresses.userId, userId),
            isNull(inboundAddresses.revokedAt),
          ),
        )
        .limit(1);
      return row ?? null;
    },
    async findByTokenHash(tokenHash) {
      const [row] = await db
        .select()
        .from(inboundAddresses)
        .where(
          and(
            eq(inboundAddresses.tokenHash, tokenHash),
            isNull(inboundAddresses.revokedAt),
          ),
        )
        .limit(1);
      return row ?? null;
    },
    async insert(address) {
      await db.insert(inboundAddresses).values(address);
    },
    async revoke(workspaceId, userId, now) {
      await db
        .update(inboundAddresses)
        .set({ revokedAt: now })
        .where(
          and(
            eq(inboundAddresses.workspaceId, workspaceId),
            eq(inboundAddresses.userId, userId),
            isNull(inboundAddresses.revokedAt),
          ),
        );
    },
    async findReceipt(addressId, messageKey) {
      const [row] = await db
        .select()
        .from(inboundReceipts)
        .where(
          and(
            eq(inboundReceipts.addressId, addressId),
            eq(inboundReceipts.messageKey, messageKey),
          ),
        )
        .limit(1);
      return row?.taskId ?? null;
    },
    async insertReceipt(addressId, messageKey, taskId) {
      await db.insert(inboundReceipts).values({ addressId, messageKey, taskId });
    },
  };
}
