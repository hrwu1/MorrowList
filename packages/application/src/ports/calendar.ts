export interface CalendarFeedToken {
  readonly userId: string;
  readonly workspaceId: string;
  readonly tokenHash: string;
  readonly createdAt: Date;
  readonly revokedAt: Date | null;
}
export interface CalendarFeedTokenRepository {
  find(userId: string, workspaceId: string): Promise<CalendarFeedToken | null>;
  findByHash(tokenHash: string): Promise<CalendarFeedToken | null>;
  /** Atomic upsert; a concurrent rotation leaves exactly one valid token. */
  replace(token: CalendarFeedToken): Promise<void>;
  revoke(userId: string, workspaceId: string, now: Date): Promise<boolean>;
}
