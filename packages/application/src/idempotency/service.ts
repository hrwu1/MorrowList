import { DomainError, systemClock, type Clock } from "@morrowlist/domain";

import type { UnitOfWork } from "../ports/index.js";
import { assertWorkspaceAccess, type ActorContext } from "../shared/actor-context.js";

export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Replay and the command share a transaction, including nested use-case executions. */
export class IdempotencyService {
  private readonly clock: Clock;

  constructor(private readonly options: { unitOfWork: UnitOfWork; clock?: Clock }) {
    this.clock = options.clock ?? systemClock;
  }

  async execute(
    context: ActorContext,
    input: {
      workspaceId: string | null;
      scopeHash: string;
      keyHash: string;
      fingerprint: string;
    },
    operation: () => Promise<string>,
  ): Promise<string> {
    if (input.workspaceId !== null) assertWorkspaceAccess(context, input.workspaceId);
    else if (!context.userId)
      throw new DomainError("AUTH_FORBIDDEN", "A user is required for this operation.");
    return this.options.unitOfWork.execute(async (tx) => {
      await tx.idempotency.lock(input.scopeHash, input.keyHash);
      const now = this.clock.now();
      const previous = await tx.idempotency.find(input.scopeHash, input.keyHash);
      if (previous && previous.expiresAt > now) {
        if (previous.fingerprint !== input.fingerprint) {
          throw new DomainError(
            "IDEMPOTENCY_KEY_REUSED",
            "This idempotency key was already used with a different request.",
          );
        }
        return previous.response;
      }
      const response = await operation();
      await tx.idempotency.save({
        ...input,
        response,
        createdAt: now,
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS),
      });
      // Refresh our own expired record before cleanup so concurrent pruners cannot
      // acquire its row lock before this request does.
      await tx.idempotency.pruneExpired(now);
      return response;
    });
  }
}
