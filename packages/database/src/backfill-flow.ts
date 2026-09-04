import { uuidv7, type StatusCategory } from "@morrowlist/domain";
import { and, asc, eq, inArray } from "drizzle-orm";

import type { Database } from "./client.js";
import {
  activityEvents,
  taskStatusIntervals,
  workflowStatuses,
} from "./schema/index.js";

/**
 * One-off backfill of the flow read model (GAP-17) from the activity log, for tasks that
 * existed before intervals were written alongside every status change.
 *
 * It replays, per task, the events that place a task on a board or take it off one, and
 * reads the payloads exactly as they were recorded: `task.created` carries the initial
 * `projectId` and `statusId`; a move, completion or reopen carries `changes.statusId` and
 * `changes.projectId` as `{ from, to }`; trash and restore carry `changes.deletedAt`. A
 * completion or reopen that changes neither is a column whose category crossed the Done
 * boundary under the task (GAP-05): the live writer ends the stay and starts a new one,
 * and so does the replay. A stay's category is the column's category at the time it was
 * entered, read from `workflow_status.updated` events, not the column's category today.
 * Tasks that already have intervals are left alone, so re-running is safe.
 */

/**
 * The `TASK_EVENTS` names from `@morrowlist/contracts`, spelled out because this package
 * does not depend on the contracts package; stored event names never change.
 */
const TASK_EVENTS = {
  created: "task.created",
  moved: "task.moved",
  completed: "task.completed",
  reopened: "task.reopened",
  deleted: "task.deleted",
  restored: "task.restored",
} as const;

const REPLAYED_EVENTS = Object.values(TASK_EVENTS);
const STATUS_UPDATED_EVENT = "workflow_status.updated";

interface Change {
  readonly to?: unknown;
}

interface ReplayedPayload {
  readonly projectId?: unknown;
  readonly statusId?: unknown;
  readonly changes?: Record<string, Change | undefined>;
}

const CATEGORIES: readonly StatusCategory[] = [
  "backlog",
  "ready",
  "in_progress",
  "blocked",
  "review",
  "done",
];

function categoryOf(value: unknown): StatusCategory | null {
  return CATEGORIES.find((category) => category === value) ?? null;
}

interface Placement {
  readonly projectId: string;
  readonly statusId: string;
}

type IntervalRow = typeof taskStatusIntervals.$inferInsert;

export interface BackfillResult {
  readonly tasks: number;
  readonly intervals: number;
}

export async function backfillStatusIntervals(
  db: Database,
  options: { readonly log?: (message: string) => void } = {},
): Promise<BackfillResult> {
  const log = options.log ?? (() => {});

  const statuses = new Map<string, StatusCategory>(
    (
      await db
        .select({ id: workflowStatuses.id, category: workflowStatuses.category })
        .from(workflowStatuses)
    ).map((status) => [status.id, status.category]),
  );
  const categoryAt = await categoryHistory(db, statuses);
  const covered = new Set(
    (
      await db
        .selectDistinct({ taskId: taskStatusIntervals.taskId })
        .from(taskStatusIntervals)
    ).map((row) => row.taskId),
  );

  const events = await db
    .select({
      taskId: activityEvents.aggregateId,
      workspaceId: activityEvents.workspaceId,
      eventType: activityEvents.eventType,
      payload: activityEvents.payload,
      createdAt: activityEvents.createdAt,
    })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.aggregateType, "task"),
        inArray(activityEvents.eventType, REPLAYED_EVENTS),
      ),
    )
    .orderBy(
      asc(activityEvents.aggregateId),
      asc(activityEvents.createdAt),
      asc(activityEvents.id),
    );

  const rows: IntervalRow[] = [];
  let tasks = 0;
  let current = null as {
    taskId: string;
    placement: Placement | null;
    open: IntervalRow | null;
  } | null;

  const close = (at: Date) => {
    if (current?.open) {
      current.open.leftAt = at;
      current.open = null;
    }
  };
  const open = (workspaceId: string, placement: Placement, at: Date) => {
    if (!current) return;
    const category = categoryAt(placement.statusId, at);
    // A status that no longer exists cannot be categorised; its stay is skipped.
    if (!category) return;
    current.open = {
      id: uuidv7(),
      taskId: current.taskId,
      workspaceId,
      projectId: placement.projectId,
      statusId: placement.statusId,
      category,
      enteredAt: at,
      leftAt: null,
    };
    rows.push(current.open);
  };

  for (const event of events) {
    if (covered.has(event.taskId)) continue;
    if (current?.taskId !== event.taskId) {
      current = { taskId: event.taskId, placement: null, open: null };
      tasks += 1;
    }
    const payload = event.payload as ReplayedPayload;
    const at = event.createdAt;

    if (event.eventType === TASK_EVENTS.created) {
      current.placement = placementOf(payload.projectId, payload.statusId);
      if (current.placement) open(event.workspaceId, current.placement, at);
      continue;
    }
    if (event.eventType === TASK_EVENTS.deleted) {
      close(at);
      continue;
    }
    if (event.eventType === TASK_EVENTS.restored) {
      if (current.placement) open(event.workspaceId, current.placement, at);
      continue;
    }

    const changes = payload.changes ?? {};
    const relocated = "statusId" in changes || "projectId" in changes;
    const reentered =
      !relocated &&
      (event.eventType === TASK_EVENTS.completed ||
        event.eventType === TASK_EVENTS.reopened) &&
      current.placement !== null;
    if (!relocated && !reentered) continue;
    const next = relocated
      ? placementOf(
          "projectId" in changes ? changes.projectId?.to : current.placement?.projectId,
          "statusId" in changes ? changes.statusId?.to : current.placement?.statusId,
        )
      : current.placement;
    close(at);
    current.placement = next;
    if (next) open(event.workspaceId, next, at);
  }

  for (let offset = 0; offset < rows.length; offset += 500) {
    await db.insert(taskStatusIntervals).values(rows.slice(offset, offset + 500));
  }
  log(`backfilled ${rows.length} intervals for ${tasks} tasks`);
  return { tasks, intervals: rows.length };
}

/**
 * A column's category as of an instant. Category edits are replayed forward from the
 * `from` of the earliest one, so a stay that began before an edit keeps the category the
 * column had then, exactly as the live writer recorded it.
 */
async function categoryHistory(
  db: Database,
  current: ReadonlyMap<string, StatusCategory>,
): Promise<(statusId: string, at: Date) => StatusCategory | null> {
  const edits = await db
    .select({
      statusId: activityEvents.aggregateId,
      payload: activityEvents.payload,
      createdAt: activityEvents.createdAt,
    })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.aggregateType, "status"),
        eq(activityEvents.eventType, STATUS_UPDATED_EVENT),
      ),
    )
    .orderBy(asc(activityEvents.createdAt), asc(activityEvents.id));

  const timelines = new Map<
    string,
    { initial: StatusCategory; changes: { at: Date; to: StatusCategory }[] }
  >();
  for (const edit of edits) {
    const change = (edit.payload as ReplayedPayload).changes?.category as
      | { from?: unknown; to?: unknown }
      | undefined;
    const from = categoryOf(change?.from);
    const to = categoryOf(change?.to);
    if (!from || !to) continue;
    const timeline = timelines.get(edit.statusId) ?? { initial: from, changes: [] };
    timeline.changes.push({ at: edit.createdAt, to });
    timelines.set(edit.statusId, timeline);
  }

  return (statusId, at) => {
    const timeline = timelines.get(statusId);
    if (!timeline) return current.get(statusId) ?? null;
    let category = timeline.initial;
    for (const change of timeline.changes) {
      if (change.at.getTime() > at.getTime()) break;
      category = change.to;
    }
    return category;
  };
}

function placementOf(projectId: unknown, statusId: unknown): Placement | null {
  return typeof projectId === "string" && typeof statusId === "string"
    ? { projectId, statusId }
    : null;
}
