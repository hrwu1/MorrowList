import {
  DomainError,
  materialChanges,
  type Clock,
  type Task,
} from "@morrowlist/domain";

import { syncIntervals } from "../flow/intervals.js";
import { recomputeReminder } from "../notifications/scheduler.js";
import type { TransactionContext, Workspace } from "../ports/index.js";
import type { ActorContext } from "../shared/actor-context.js";
import { recordEvent } from "../shared/event-recorder.js";

/** Shared commit pipeline for interactive, batch, automation and imported transitions. */
export async function persistTaskTransition(options: {
  readonly tx: TransactionContext;
  readonly context: ActorContext;
  readonly clock: Clock;
  readonly workspace: Workspace;
  readonly previous: Task;
  readonly next: Task;
  readonly eventType: string;
  readonly summary: string;
  readonly payload?: Record<string, unknown>;
}): Promise<void> {
  const { tx, context, clock, workspace, previous, next } = options;
  if (next === previous) return;
  if (!(await tx.tasks.update(next, previous.version))) {
    const current = await tx.tasks.findById(workspace.id, previous.id);
    throw new DomainError(
      "TASK_VERSION_CONFLICT",
      "The task changed after you loaded it.",
      {
        taskId: previous.id,
        expectedVersion: previous.version,
        actualVersion: current?.version ?? null,
      },
    );
  }
  await syncIntervals(tx, previous, next);
  await recordEvent(tx, context, clock, {
    workspaceId: workspace.id,
    aggregateType: "task",
    aggregateId: next.id,
    eventType: options.eventType,
    summary: options.summary,
    payload: options.payload ?? {
      taskId: next.id,
      changes: materialChanges(next, previous),
    },
  });
  await recomputeReminder(tx, next, workspace.timezone, clock.now());
}
