/** A replay result is opaque ciphertext; repository records never contain credentials. */
export interface IdempotencyRecord {
  readonly scopeHash: string;
  readonly keyHash: string;
  readonly workspaceId: string | null;
  readonly fingerprint: string;
  readonly response: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface IdempotencyRepository {
  /** Serialize matching requests until their surrounding transaction completes. */
  lock(scopeHash: string, keyHash: string): Promise<void>;
  find(scopeHash: string, keyHash: string): Promise<IdempotencyRecord | null>;
  save(record: IdempotencyRecord): Promise<void>;
  /** Bounded cleanup; must not block on records another request is using. */
  pruneExpired(now: Date): Promise<void>;
}
