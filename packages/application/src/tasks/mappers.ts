import type {
  ListTasksQuery,
  SubtaskProgress,
  TaskDto,
  TaskRelationDto,
} from "@morrowlist/contracts";
import {
  dateOrderWarnings,
  isBlocked,
  isCompleted,
  isDeleted,
  taskKey,
  type FieldFilter,
  type PlainDate,
  type Tag,
  type Task,
} from "@morrowlist/domain";

import type {
  RelationEdge,
  TaskFilter,
  TransactionContext,
  Workspace,
} from "../ports/index.js";
import { toTagDto } from "../tags/mappers.js";

/**
 * The list query as the repository's filter. One mapping, so the task list, a saved
 * view, and the CSV export (GAP-07) can never disagree about what a filter selects.
 */
export function toTaskFilter(
  query: Partial<ListTasksQuery> & { readonly workspaceId: string },
  today: PlainDate,
  // Resolved separately because binding a field filter to its definition needs the
  // transaction (GAP-24); the raw `query.fields` cannot be used directly.
  fields?: readonly FieldFilter[] | undefined,
): TaskFilter {
  return {
    workspaceId: query.workspaceId,
    projectId: query.projectId,
    statusId: query.statusId,
    parentTaskId: query.parentTaskId,
    priority: query.priority,
    tagId: query.tagId,
    seriesId: query.seriesId,
    inboxOnly: query.inbox,
    isCompleted: query.isCompleted,
    isBlocked: query.isBlocked,
    deletedOnly: query.deleted,
    includeSubtasks: query.includeSubtasks,
    due: query.due,
    deferred: query.deferred,
    deadline: query.deadline,
    fields,
    today,
    sort: query.sort,
    order: query.order,
  };
}

/**
 * Every projection a task DTO carries, read for a whole page at once: day plans,
 * subtask progress, tags, and the relations touching the page. Shared by every list
 * that returns `TaskDto`s (task lists, search) so no projection can drift.
 */
export async function loadTaskDtos(
  tx: TransactionContext,
  workspace: Workspace,
  tasks: readonly Task[],
  today: PlainDate,
): Promise<TaskDto[]> {
  const ids = tasks.map((task) => task.id);
  const [plans, progress, tags, edges] = await Promise.all([
    tx.dayPlans.listForTasks(ids, today),
    tx.tasks.childSummary(workspace.id, ids),
    tx.tasks.tagsFor(workspace.id, ids),
    tx.tasks.relationsFor(workspace.id, ids),
  ]);
  return tasks.map((task) =>
    toTaskDto(
      task,
      workspace.taskKeyPrefix,
      plans.get(task.id) ?? [],
      progress.get(task.id) ?? null,
      tags.get(task.id) ?? [],
      edges,
    ),
  );
}

/**
 * Domain-to-contract mapping (spec 17.3 step 8). Keeping this in one place means a
 * transport change cannot quietly alter what the domain exposes.
 *
 * `subtaskProgress` is a projection over the task's children (spec 8.3), so the caller
 * supplies it from one `childSummary` query for the whole page rather than per task.
 * `edges` are the relations touching the page (spec 8.4), from one `relationsFor` query;
 * only those touching this task are mapped, and an endpoint in the Trash hides its edge.
 */
export function toTaskDto(
  task: Task,
  taskKeyPrefix: string,
  dayPlans: readonly string[] = [],
  subtaskProgress: SubtaskProgress | null = null,
  tags: readonly Tag[] = [],
  edges: readonly RelationEdge[] = [],
  flow?: { readonly inStatusSince: Date | null; readonly ageDays: number | null },
): TaskDto {
  const relations: TaskRelationDto[] = [];
  const predecessors: Task[] = [];
  for (const edge of edges) {
    if (edge.relation.type === "blocks" && edge.target.id === task.id) {
      predecessors.push(edge.source);
    }
    const other =
      edge.source.id === task.id
        ? edge.target
        : edge.target.id === task.id
          ? edge.source
          : null;
    if (!other || isDeleted(other)) continue;
    relations.push({
      id: edge.relation.id,
      type: edge.relation.type,
      sourceTaskId: edge.relation.sourceTaskId,
      targetTaskId: edge.relation.targetTaskId,
      task: {
        id: other.id,
        key: taskKey(taskKeyPrefix, other.taskNumber),
        title: other.title,
        isCompleted: isCompleted(other),
      },
      createdAt: edge.relation.createdAt.toISOString(),
    });
  }

  return {
    id: task.id,
    key: taskKey(taskKeyPrefix, task.taskNumber),
    workspaceId: task.workspaceId,
    taskNumber: task.taskNumber,
    projectId: task.projectId,
    statusId: task.statusId,
    title: task.title,
    descriptionMd: task.descriptionMd,
    priority: task.priority,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    dueTimezone: task.dueTimezone,
    deferUntil: task.deferUntil,
    deadline: task.deadline,
    deadlineTime: task.deadlineTime,
    dateWarnings: dateOrderWarnings(task),
    reminderOffsetMinutes: task.reminderOffsetMinutes,
    parentTaskId: task.parentTaskId,
    recurrence: task.recurrence
      ? {
          ...task.recurrence,
          weekdays: task.recurrence.weekdays ? [...task.recurrence.weekdays] : null,
        }
      : null,
    seriesId: task.seriesId,
    // A slot on the canonical task, so the projection reads it straight off the row
    // and no page needs an extra query for it (GAP-24, ADR-001).
    fields: { ...task.fields },
    rank: task.rank,
    isCompleted: isCompleted(task),
    completedAt: task.completedAt?.toISOString() ?? null,
    version: task.version,
    tags: tags.map(toTagDto),
    createdBy: { kind: task.createdBy.kind, id: task.createdBy.id },
    lastActor: { kind: task.lastActor.kind, id: task.lastActor.id },
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    deletedAt: task.deletedAt?.toISOString() ?? null,
    dayPlans: [...dayPlans],
    subtaskProgress,
    relations,
    blocked:
      task.blockedReason !== null && task.blockedSince !== null
        ? { reason: task.blockedReason, since: task.blockedSince.toISOString() }
        : null,
    isBlocked: isBlocked(task, predecessors),
    ...(flow
      ? {
          inStatusSince: flow.inStatusSince?.toISOString() ?? null,
          ageDays: flow.ageDays,
        }
      : {}),
  };
}
