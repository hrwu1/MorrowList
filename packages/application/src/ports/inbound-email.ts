import type { InboundEmail, InboundEmailResult } from "@morrowlist/contracts";

export interface InboundAddress {
  readonly id: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly tokenHash: string;
  readonly createdAt: Date;
  readonly revokedAt: Date | null;
}
export interface InboundAddressRepository {
  /** Serializes rotation and delivery in the same workspace. */
  lock(workspaceId: string): Promise<void>;
  findCurrent(workspaceId: string, userId: string): Promise<InboundAddress | null>;
  findByTokenHash(tokenHash: string): Promise<InboundAddress | null>;
  insert(address: InboundAddress): Promise<void>;
  revoke(workspaceId: string, userId: string, now: Date): Promise<void>;
  findReceipt(addressId: string, messageKey: string): Promise<string | null>;
  insertReceipt(addressId: string, messageKey: string, taskId: string): Promise<void>;
}
/** Webhook adapters and the optional IMAP bridge deliver through this one port. */
export interface InboundEmailPort {
  receive(
    provider: string,
    email: InboundEmail,
    requestId: string,
  ): Promise<InboundEmailResult>;
}
