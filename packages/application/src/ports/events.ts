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
  | "saved_view"
  | "field";

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
  /**
   * The whole workspace's history, same order and paging, optionally narrowed to some
   * aggregate types. The archive walks it (GAP-07); nothing else reads history this
   * broadly, which is why it is paged rather than returned whole.
   */
  listForWorkspace(
    workspaceId: string,
    cursor: Cursor,
    aggregateTypes?: readonly AggregateType[],
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
  /** Inspection support: one workspace's undelivered events (spec 18.2). */
  listUnpublished(
    workspaceId: string,
    limit?: number,
  ): Promise<readonly OutboxEventInput[]>;
  /**
   * The webhook dispatcher's fan-out queue (GAP-18): unpublished events across every
   * workspace whose `availableAt` has passed, oldest first. Reading rather than claiming
   * is deliberate — the fan-out itself is idempotent, so two dispatchers reading the same
   * row is harmless, and a row stays visible until its deliveries are all terminal.
   */
  listPending(now: Date, limit: number): Promise<readonly OutboxEventInput[]>;
  /** Mark events delivered (or not deliverable) so the dispatcher stops looking at them. */
  markPublished(ids: readonly string[], publishedAt: Date): Promise<void>;
}
