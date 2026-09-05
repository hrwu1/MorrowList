import { TASK_EVENTS } from "@morrowlist/contracts";
import {
  boardPlacement,
  createTask,
  rankBetween,
  taskKey,
  type Clock,
  type CreateTaskInput,
  type Tag,
  type Task,
} from "@morrowlist/domain";

import { openInterval } from "../flow/intervals.js";
import { recomputeReminder } from "../notifications/scheduler.js";
import type { RankScope, TransactionContext, Workspace } from "../ports/index.js";
import { actorRef, type ActorContext } from "../shared/actor-context.js";
import { recordEvent } from "../shared/event-recorder.js";

/**
 * The one way a task comes into existence (spec 19.2).
 *
 * Capture, the spawn of a repeating task's next occurrence (GAP-12), and an import
 * (GAP-07) all go through here, so every task lands the same way: a workspace number
 * from the counter, a rank after everything in its scope, a reminder derived from its
 * due instant, an open flow interval when it is on a board, and one `task.created`
 * activity plus outbox row — all inside the caller's transaction.
 *
 * It lives outside `TaskService` because `ImportService` needs it in its own transaction
 * and a service method would open a second one.
 */

/** Where a task came from, when it was not typed in by hand. */
export interface TaskOrigin {
  /** The completed occurrence that spawned this one (GAP-12). */
  readonly spawnedFrom?: string;
  /** The source row an import created it from (GAP-07). */
  readonly importedFrom?: { readonly source: string; readonly id: string | null };
  /** Tags to attach in the same transaction as the row. */
  readonly tags?: readonly Tag[];
}

export interface InsertTaskOptions {
  readonly tx: TransactionContext;
  readonly context: ActorContext;
  readonly clock: Clock;
  readonly workspace: Workspace;
  readonly fields: Omit<CreateTaskInput, "workspaceId" | "taskNumber" | "rank">;
  readonly origin?: TaskOrigin | null;
}

export async function insertNewTask(options: InsertTaskOptions): Promise<Task> {
  const { tx, context, clock, workspace, fields } = options;
  const origin = options.origin ?? null;

  const scope: RankScope = {
    workspaceId: workspace.id,
    projectId: fields.project?.id ?? null,
    statusId: fields.project?.status.id ?? null,
  };
  // New tasks land at the end of their scope so capture never reorders existing work.
  const lastRank = await tx.tasks.lastRankIn(scope);

  const task = createTask(
    {
      ...fields,
      workspaceId: workspace.id,
      taskNumber: await tx.taskCounters.allocate(workspace.id),
      rank: rankBetween(lastRank, null),
    },
    { actor: actorRef(context), clock },
  );

  await tx.tasks.insert(task);
  // The reminder schedule is derived in the same transaction as the row, for a
  // captured task and for the next occurrence a completion spawns alike (GAP-13).
  await recomputeReminder(tx, task, workspace.timezone, clock.now());
  for (const tag of origin?.tags ?? []) {
    await tx.tasks.addTag(task.id, tag.id, clock.now());
  }
  // A task on a board starts its first stay now, a spawned occurrence included.
  const placement = boardPlacement(task);
  if (placement) await openInterval(tx, task, placement, fields.project?.status);

  const key = taskKey(workspace.taskKeyPrefix, task.taskNumber);
  await recordEvent(tx, context, clock, {
    workspaceId: task.workspaceId,
    aggregateType: "task",
    aggregateId: task.id,
    eventType: TASK_EVENTS.created,
    summary: origin?.spawnedFrom
      ? `Created task ${key} as the next occurrence of a repeating task`
      : origin?.importedFrom
        ? `Created task ${key} from a ${origin.importedFrom.source} import`
        : `Created task ${key}`,
    payload: {
      taskId: task.id,
      taskNumber: task.taskNumber,
      projectId: task.projectId,
      statusId: task.statusId,
      priority: task.priority,
      parentTaskId: task.parentTaskId,
      seriesId: task.seriesId,
      ...(origin?.spawnedFrom ? { spawnedFrom: origin.spawnedFrom } : {}),
      ...(origin?.importedFrom ? { importedFrom: origin.importedFrom } : {}),
    },
  });
  return task;
}
