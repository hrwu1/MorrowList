import type { ActorKind } from "@morrowlist/domain";

/**
 * Activity and transactional outbox ports (spec 18.2, EVT-001). Both are written inside
 * the same transaction as the data change they describe; a failure rolls back all three.
 */

export type AggregateType = "task" | "project" | "status" | "tag" | "workspace";

export interface ActivityEventInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly aggregateType: AggregateType;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly actorKind: ActorKind;
  readonly actorId: string;
  readonly actorDisplayName: string | null;
  /** Human-readable and safe to display; never contains a secret. */
  readonly summary: string;
  readonly payload: Record<string, unknown>;
  readonly correlationId: string;
  readonly createdAt: Date;
}

/** A stored activity row. Identical in shape to the input today; named separately so a
 *  read-side field such as a resolved actor name can be added without touching writers. */
export type ActivityEvent = ActivityEventInput;

export interface ActivityRepository {
  append(event: ActivityEventInput): Promise<void>;
  listForAggregate(
    workspaceId: string,
    aggregateType: AggregateType,
    aggregateId: string,
    limit?: number,
  ): Promise<readonly ActivityEvent[]>;
}

export interface OutboxEventInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly schemaVersion: number;
  readonly eventType: string;
  readonly aggregateType: AggregateType;
  readonly aggregateId: string;
  readonly actor: { readonly kind: ActorKind; readonly id: string };
  readonly payload: Record<string, unknown>;
  readonly correlationId: string;
  readonly causationId?: string | undefined;
  readonly occurredAt: Date;
  readonly availableAt: Date;
}

export interface OutboxRepository {
  enqueue(event: OutboxEventInput): Promise<void>;
  /** Inspection support for the MVP; external delivery is deferred (spec 18.2). */
  listUnpublished(
    workspaceId: string,
    limit?: number,
  ): Promise<readonly OutboxEventInput[]>;
}
