import type { SubtaskProgress, TaskDto, TaskRelationDto } from "@morrowlist/contracts";
import {
  isBlocked,
  isCompleted,
  isDeleted,
  taskKey,
  type Tag,
  type Task,
} from "@morrowlist/domain";

import type { RelationEdge } from "../ports/index.js";
import { toTagDto } from "../tags/mappers.js";

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
): TaskDto {
  const relations = edges.flatMap((edge): TaskRelationDto[] => {
    const other =
      edge.source.id === task.id
        ? edge.target
        : edge.target.id === task.id
          ? edge.source
          : null;
    if (!other || isDeleted(other)) return [];
    return [
      {
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
      },
    ];
  });
  const predecessors = edges
    .filter((edge) => edge.relation.type === "blocks" && edge.target.id === task.id)
    .map((edge) => edge.source);

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
    parentTaskId: task.parentTaskId,
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
  };
}
