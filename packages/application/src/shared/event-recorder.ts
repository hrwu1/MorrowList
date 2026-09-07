import { EVENT_SCHEMA_VERSION } from "@morrowlist/contracts";
import { uuidv7, type Clock } from "@morrowlist/domain";

import type { AggregateType, TransactionContext } from "../ports/index.js";

import type { ActorContext } from "./actor-context.js";

/**
 * Activity and outbox writer (EVT-001, spec 17.3 step 7).
 *
 * Every material mutation records one activity row and one outbox row inside the caller's
 * transaction. Because both writes use the same `TransactionContext`, a later failure in
 * the command rolls back the data change and both event rows together.
 */
export interface RecordEventInput {
  readonly workspaceId: string;
  readonly aggregateType: AggregateType;
  readonly aggregateId: string;
  readonly eventType: string;
  /** Safe to display to the user; must not embed secrets (spec 26.2). */
  readonly summary: string;
  readonly payload: Record<string, unknown>;
}

export async function recordEvent(
  tx: TransactionContext,
  context: ActorContext,
  clock: Clock,
  input: RecordEventInput,
): Promise<void> {
  const occurredAt = clock.now();

  await tx.activity.append({
    id: uuidv7(),
    workspaceId: input.workspaceId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    eventType: input.eventType,
    actorKind: context.actorKind,
    actorId: context.actorId,
    actorDisplayName: context.actorDisplayName ?? null,
    summary: input.summary,
    payload: input.payload,
    correlationId: context.requestId,
    createdAt: occurredAt,
  });

  await tx.outbox.enqueue({
    id: uuidv7(),
    workspaceId: input.workspaceId,
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventType: input.eventType,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    actor: { kind: context.actorKind, id: context.actorId },
    payload: input.payload,
    correlationId: context.requestId,
    causationId: context.causationId,
    occurredAt,
    // Available immediately; a future dispatcher may delay individual events.
    availableAt: occurredAt,
  });
}
