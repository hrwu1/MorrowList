import type { ActorKind } from "@morrowlist/domain";

import type { Cursor, Page } from "./tasks.js";

/**
 * Activity and transactional outbox ports (spec 18.2, EVT-001). Both are written inside
 * the same transaction as the data change they describe; a failure rolls back all three.
 */

export type AggregateType =
  | "task"
  | "project"
  | "status"
  | "tag"
  | "workspace"
  | "saved_view";

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
  /**
   * One aggregate's history, newest first, keyset-paginated on `(createdAt, id)` so a
   * page boundary can neither skip nor repeat a row when two events share a timestamp
   * (spec 29.3). `cursor.after` is the id of the last row of the previous page.
   */
  listForAggregate(
    workspaceId: string,
    aggregateType: AggregateType,
    aggregateId: string,
    cursor: Cursor,
  ): Promise<Page<ActivityEvent>>;
  /** Events on a project itself and on the tasks currently in it, same order and paging. */
  listForProject(
    workspaceId: string,
    projectId: string,
    cursor: Cursor,
  ): Promise<Page<ActivityEvent>>;
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
